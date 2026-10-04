import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function httpError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function modelExportPaths(modelsRoot, stagingRoot, gender, modelId) {
  return {
    genderRoot: join(modelsRoot, gender),
    finalFolder: join(modelsRoot, gender, modelId),
    stagingGenderRoot: join(stagingRoot, gender),
    stagingFolder: join(stagingRoot, gender, modelId),
  };
}

export async function createModelExportSession({ modelsRoot, stagingRoot, gender, modelId, replaceExisting = false }) {
  const paths = modelExportPaths(modelsRoot, stagingRoot, gender, modelId);
  const finalExists = await exists(paths.finalFolder);
  if (replaceExisting && !finalExists) {
    throw httpError("O modelo escolhido não existe mais no catálogo.", 404, "MODEL_TO_REPLACE_NOT_FOUND");
  }
  if (!replaceExisting && finalExists) {
    throw httpError("Esse número de modelo já existe.", 409, "MODEL_ALREADY_EXISTS");
  }
  await mkdir(paths.stagingGenderRoot, { recursive: true });
  try {
    await mkdir(paths.stagingFolder);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw httpError("Esse número de modelo já está reservado por outra exportação.", 409, "MODEL_EXPORT_IN_PROGRESS");
    }
    throw error;
  }
  await writeFile(join(paths.stagingFolder, ".export-session.json"), JSON.stringify({ replaceExisting }));
  return paths;
}

export async function cancelModelExportSession({ stagingRoot, gender, modelId }) {
  const stagingFolder = join(stagingRoot, gender, modelId);
  await rm(stagingFolder, { recursive: true, force: true });
}

export async function assertModelExportSession({ stagingRoot, gender, modelId }) {
  const stagingFolder = join(stagingRoot, gender, modelId);
  if (!(await exists(stagingFolder))) {
    throw httpError("Sessão de exportação não encontrada.", 404, "MODEL_EXPORT_SESSION_NOT_FOUND");
  }
  return stagingFolder;
}

export async function commitModelExportSession({ modelsRoot, stagingRoot, gender, modelId, expectedFiles }) {
  const paths = modelExportPaths(modelsRoot, stagingRoot, gender, modelId);
  await assertModelExportSession({ stagingRoot, gender, modelId });
  const session = JSON.parse(await readFile(join(paths.stagingFolder, ".export-session.json"), "utf8"));
  const replaceExisting = session?.replaceExisting === true;
  const finalExists = await exists(paths.finalFolder);
  if (replaceExisting && !finalExists) {
    throw httpError("O modelo escolhido não existe mais no catálogo.", 404, "MODEL_TO_REPLACE_NOT_FOUND");
  }
  if (!replaceExisting && finalExists) {
    throw httpError("Esse número de modelo já existe.", 409, "MODEL_ALREADY_EXISTS");
  }
  const stagedFiles = new Set((await readdir(paths.stagingFolder, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name));
  const missing = expectedFiles.filter((name) => !stagedFiles.has(name));
  if (missing.length) {
    throw httpError(`Exportação incompleta: faltam ${missing.length} arquivo(s).`, 400, "INCOMPLETE_MODEL_EXPORT");
  }
  if (replaceExisting) {
    const manifestName = `${modelId}.json`;
    if (!expectedFiles.includes(manifestName)) throw httpError("A substituição não contém os metadados do perfil.", 400, "INCOMPLETE_MODEL_EXPORT");
    const incomingManifest = JSON.parse(await readFile(join(paths.stagingFolder, manifestName), "utf8"));
    const presetTag = incomingManifest?.presetTag;
    if (!presetTag || typeof presetTag.id !== "string" || typeof presetTag.name !== "string" || !/^#[0-9a-f]{6}$/i.test(presetTag.color ?? "")) {
      throw httpError("A tag do preset está ausente ou inválida.", 400, "INVALID_PRESET_TAG");
    }

    const imageFiles = expectedFiles.filter((name) => name.toLowerCase().endsWith(".png"));
    const configCandidates = ["model.json", "modelo.json", manifestName];
    let configName = "model.json";
    let originalConfig = null;
    for (const candidate of configCandidates) {
      try {
        originalConfig = await readFile(join(paths.finalFolder, candidate));
        configName = candidate;
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    let existingConfig = {};
    if (originalConfig) {
      try { existingConfig = JSON.parse(originalConfig.toString("utf8")); }
      catch { throw httpError("O manifesto atual do modelo está inválido; nenhuma imagem foi alterada.", 409, "INVALID_EXISTING_MODEL_MANIFEST"); }
    }

    const rollbackFolder = join(paths.stagingFolder, ".rollback");
    await mkdir(rollbackFolder, { recursive: true });
    const originalImages = new Set();
    for (const name of imageFiles) {
      const source = join(paths.finalFolder, name);
      if (await exists(source)) {
        await copyFile(source, join(rollbackFolder, name));
        originalImages.add(name);
      }
    }
    if (originalConfig) await writeFile(join(rollbackFolder, "manifest.backup"), originalConfig);
    await writeFile(join(rollbackFolder, "rollback-state.json"), JSON.stringify({ configName, hadConfig: Boolean(originalConfig), originalImages: [...originalImages] }));

    const configPath = join(paths.finalFolder, configName);
    const configTemporaryPath = `${configPath}.tmp-${randomUUID()}`;
    const updatedConfig = { ...existingConfig, presetTag };
    const changedImages = [];
    let configChanged = false;
    try {
      for (const name of imageFiles) {
        await rename(join(paths.stagingFolder, name), join(paths.finalFolder, name));
        changedImages.push(name);
      }
      await writeFile(configTemporaryPath, `${JSON.stringify(updatedConfig, null, 2)}\n`);
      await rename(configTemporaryPath, configPath);
      configChanged = true;
    } catch (error) {
      await rm(configTemporaryPath, { force: true }).catch(() => undefined);
      for (const name of changedImages.reverse()) {
        const destination = join(paths.finalFolder, name);
        if (originalImages.has(name)) {
          const restorePath = `${destination}.restore-${randomUUID()}`;
          await copyFile(join(rollbackFolder, name), restorePath);
          await rename(restorePath, destination);
        } else {
          await rm(destination, { force: true });
        }
      }
      if (configChanged) {
        if (originalConfig) {
          const restorePath = `${configPath}.restore-${randomUUID()}`;
          await copyFile(join(rollbackFolder, "manifest.backup"), restorePath);
          await rename(restorePath, configPath);
        } else {
          await rm(configPath, { force: true });
        }
      }
      throw error;
    }
    await rm(paths.stagingFolder, { recursive: true, force: true });
    return { ...paths, files: imageFiles.length, replaced: true };
  }

  await mkdir(paths.genderRoot, { recursive: true });
  await rm(join(paths.stagingFolder, ".export-session.json"), { force: true });
  await rename(paths.stagingFolder, paths.finalFolder);
  return { ...paths, files: expectedFiles.length, replaced: false };
}

export async function nextModelNumber({ modelsRoot, stagingRoot, gender }) {
  const readDirectories = async (root) => {
    try {
      return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  };
  const entries = [
    ...await readDirectories(join(modelsRoot, gender)),
    ...await readDirectories(join(stagingRoot, gender)),
  ];
  const numbers = entries.map((entry) => Number(entry.name.match(/^modelo-(\d+)$/i)?.[1] ?? 0));
  return Math.max(0, ...numbers) + 1;
}
