import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

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

export async function createModelExportSession({ modelsRoot, stagingRoot, gender, modelId }) {
  const paths = modelExportPaths(modelsRoot, stagingRoot, gender, modelId);
  if (await exists(paths.finalFolder)) {
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
  if (await exists(paths.finalFolder)) {
    throw httpError("Esse número de modelo já existe.", 409, "MODEL_ALREADY_EXISTS");
  }
  await assertModelExportSession({ stagingRoot, gender, modelId });
  const stagedFiles = new Set((await readdir(paths.stagingFolder, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name));
  const missing = expectedFiles.filter((name) => !stagedFiles.has(name));
  if (missing.length) {
    throw httpError(`Exportação incompleta: faltam ${missing.length} arquivo(s).`, 400, "INCOMPLETE_MODEL_EXPORT");
  }
  await mkdir(paths.genderRoot, { recursive: true });
  await rename(paths.stagingFolder, paths.finalFolder);
  return { ...paths, files: expectedFiles.length };
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
