import { copyFile, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { normalizeVideoFile, probeVideoFile, videoMatchesExportProfile } from "../media/video-normalizer.mjs";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { safeExportFolderName } from "../storage/naming.mjs";

export const ROTEIRO_EXPORT_MANIFEST = ".nymi-script.json";
export const ROTEIRO_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"];

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function insideOrSame(parent, target) {
  return resolve(parent) === resolve(target) || inside(parent, target);
}

export function createRoteiroExportFilesystem({
  targets,
  roteirosVideosRoot,
  baseDadosRoot,
  baseDadosService,
}) {
  function exportTarget(value) {
    const target = String(value || "v4").trim().toLowerCase();
    const config = targets[target];
    if (!config) {
      throw Object.assign(new Error("Destino de exportação inválido."), {
        status: 400,
        code: "INVALID_EXPORT_TARGET",
      });
    }
    return config;
  }

  function projectRoot(scriptTitle, target = "v4") {
    return join(exportTarget(target).root, safeExportFolderName(scriptTitle, "Roteiro"));
  }

  function videoExportRoot(scriptTitle, target = "v4") {
    return join(projectRoot(scriptTitle, target), "assets", "tiktoks");
  }

  function characterExportRoot(scriptTitle, target = "v4") {
    return join(projectRoot(scriptTitle, target), "assets", "characters");
  }

  function backgroundExportRoot(scriptTitle, target = "v4") {
    return join(projectRoot(scriptTitle, target), "assets", "backgrounds");
  }

  function uiExportRoot(scriptTitle, target = "v4") {
    return join(projectRoot(scriptTitle, target), "assets", "ui");
  }

  async function writeExportManifest(folder, scriptId, scriptTitle, kind, target = "v4") {
    const manifestPath = join(folder, ROTEIRO_EXPORT_MANIFEST);
    if (!inside(folder, manifestPath)) throw new Error("Manifesto de exportação inválido");
    await writeJsonAtomic(manifestPath, {
      app: "NYMI_ROTEIRO_EXPORT_V1",
      scriptId,
      scriptTitle: String(scriptTitle || "Roteiro"),
      kind,
      editorTarget: exportTarget(target).id,
      updatedAt: new Date().toISOString(),
    });
  }

  async function projectHasScriptManifest(folder, scriptId) {
    const directManifest = await readOptionalJson(join(folder, ROTEIRO_EXPORT_MANIFEST));
    if (directManifest?.app === "NYMI_ROTEIRO_EXPORT_V1" && directManifest.scriptId === scriptId) return true;
    const nestedRoots = [
      join(folder, "assets", "tiktoks"),
      join(folder, "assets", "backgrounds"),
      join(folder, "assets", "characters"),
    ];
    for (const root of nestedRoots) {
      const manifest = await readOptionalJson(join(root, ROTEIRO_EXPORT_MANIFEST));
      if (manifest?.app === "NYMI_ROTEIRO_EXPORT_V1" && manifest.scriptId === scriptId) return true;
    }
    return false;
  }

  async function removeExportFolders(script, allowLegacyTitle) {
    const scriptId = safeId(script.id);
    const root = exportTarget("v4").root;
    const folder = projectRoot(script.title, "v4");
    if (!inside(root, folder) || resolve(root) === resolve(folder)) return [];
    try {
      await stat(folder);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const hasManifest = await projectHasScriptManifest(folder, scriptId);
    if (!hasManifest && !allowLegacyTitle) return [];
    await rm(folder, { recursive: true, force: true });
    return [folder];
  }

  async function listExportOrphans(knownScriptIds, knownScriptTitles = []) {
    const knownTitleFolders = new Set(knownScriptTitles.map((title) => safeExportFolderName(title, "Roteiro")));
    const orphans = [];
    const root = exportTarget("v4").root;
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return orphans;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = join(root, entry.name);
      const manifest = await readOptionalJson(join(folder, ROTEIRO_EXPORT_MANIFEST));
      if (manifest?.app === "NYMI_ROTEIRO_EXPORT_V1" && !knownScriptIds.has(manifest.scriptId)) {
        orphans.push({ kind: "script", folder, scriptId: manifest.scriptId });
      } else if (!manifest && !knownTitleFolders.has(entry.name)) {
        orphans.push({ kind: "script", folder, scriptId: "", untracked: true });
      }
    }
    return orphans;
  }

  async function removeExportOrphans(knownScriptIds, knownScriptTitles = []) {
    const orphans = await listExportOrphans(knownScriptIds, knownScriptTitles);
    for (const orphan of orphans) {
      const root = exportTarget("v4").root;
      if (!inside(root, orphan.folder) || resolve(root) === resolve(orphan.folder)) continue;
      await rm(orphan.folder, { recursive: true, force: true });
    }
    return { orphans, removed: orphans.map((item) => item.folder) };
  }

  async function findRoteiroVideoFile(scriptId, tiktokId) {
    const safeScriptId = safeId(scriptId);
    const safeTiktokId = safeId(tiktokId);
    const folder = join(roteirosVideosRoot, safeScriptId);
    for (const extension of ROTEIRO_VIDEO_EXTENSIONS) {
      const candidate = join(folder, `${safeTiktokId}${extension}`);
      if (!inside(roteirosVideosRoot, candidate)) throw new Error("Origem do vídeo inválida");
      try {
        await stat(candidate);
        return candidate;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    throw Object.assign(new Error("Vídeo não encontrado"), { code: "ENOENT" });
  }

  async function findVideoReferenceFile(video, scriptId, tiktokId) {
    const libraryId = video?.libraryVideoId;
    if (libraryId) {
      const libraryVideo = baseDadosService.getVideo(libraryId);
      if (!libraryVideo) {
        throw Object.assign(new Error("Vídeo compartilhado não encontrado na Base de dados."), { code: "ENOENT" });
      }
      const source = join(baseDadosRoot, "videos", libraryVideo.fileName);
      if (!inside(baseDadosRoot, source)) throw new Error("Origem do vídeo compartilhado inválida.");
      await stat(source);
      return source;
    }
    return findRoteiroVideoFile(scriptId, tiktokId);
  }

  async function exportVideoAsset(source, destination) {
    let probe;
    try {
      probe = await probeVideoFile(source);
    } catch {
      await copyFile(source, destination);
      return { mode: "copied", reason: "probe-unavailable" };
    }
    if (videoMatchesExportProfile(probe)) {
      await copyFile(source, destination);
      return { mode: "copied", reason: "already-compatible" };
    }
    const normalized = await normalizeVideoFile(source, destination, probe);
    await rm(destination, { force: true });
    await rename(normalized.outputPath, destination);
    return {
      mode: "converted",
      encoder: normalized.encoder,
      audioRecovered: normalized.audioRecovered,
      audioCopied: normalized.audioCopied,
      relaxedVideoSettings: normalized.relaxedVideoSettings,
    };
  }

  return {
    exportTarget,
    projectRoot,
    videoExportRoot,
    characterExportRoot,
    backgroundExportRoot,
    uiExportRoot,
    writeExportManifest,
    removeExportFolders,
    listExportOrphans,
    removeExportOrphans,
    findVideoReferenceFile,
    exportVideoAsset,
  };
}
