import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeFabricatorChroma,
  normalizeFabricatorGrid,
  normalizeFabricatorPlacement,
  normalizeFabricatorPresetProfiles,
  normalizeFabricatorPresets,
} from "./normalization.mjs";
import { BODY_LIMITS, IMAGE_MIME_TYPES, assertMimeType, contentTypeOf } from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";

const FABRICATOR_KINDS = new Set(["eyes", "eyebrows", "mouths", "mouths-talk", "blush", "shadow", "manpu"]);
const EFFECT_KINDS = new Set(["blush", "shadow", "manpu"]);

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function createFabricatorService({
  root,
  manifestPath,
  presetsPath,
  presetProfilesPath,
  legacyManifestPath,
  host,
  port,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  serveFile,
}) {
  let mutationQueue = Promise.resolve();
  let assets = [];
  let presets = {};
  let presetProfiles = { version: 1, activeProfileId: "padrao", profiles: [] };

  function queueMutation(task) {
    const operation = mutationQueue.catch(() => undefined).then(task);
    mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function writeAssets() {
    return writeJsonAtomic(manifestPath, assets);
  }

  function writePresets() {
    return writeJsonAtomic(presetsPath, presets);
  }

  function writePresetProfiles() {
    return writeJsonAtomic(presetProfilesPath, presetProfiles);
  }

  async function loadAssets() {
    await mkdir(root, { recursive: true });
    const currentManifest = await readOptionalJson(manifestPath);
    const parsed = currentManifest ?? await readOptionalJson(legacyManifestPath);
    const knownAssets = Array.isArray(parsed)
      ? parsed.filter((asset) => asset && typeof asset.id === "string" && typeof asset.fileName === "string")
      : [];
    const knownFiles = new Set(knownAssets.map((asset) => asset.fileName));
    const recoveredAssets = [];

    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name) || knownFiles.has(entry.name)) continue;
      const id = entry.name.replace(/\.[^.]+$/, "");
      const info = await stat(join(root, entry.name));
      recoveredAssets.push({
        id,
        name: `Arquivo recuperado ${id.slice(0, 8)}`,
        kind: "eyes",
        contentType: entry.name.endsWith(".webp")
          ? "image/webp"
          : entry.name.endsWith(".jpg") || entry.name.endsWith(".jpeg")
            ? "image/jpeg"
            : "image/png",
        fileName: entry.name,
        createdAt: new Date(info.mtimeMs).toISOString(),
      });
    }

    assets = [...knownAssets, ...recoveredAssets];
    if (recoveredAssets.length || currentManifest === null) await writeAssets();
  }

  async function initialize() {
    await loadAssets();

    const parsedPresets = await readOptionalJson(presetsPath);
    presets = normalizeFabricatorPresets(parsedPresets);
    if (parsedPresets === null) await writePresets();

    const parsedProfiles = await readOptionalJson(presetProfilesPath);
    presetProfiles = normalizeFabricatorPresetProfiles(parsedProfiles, presets);
    if (parsedProfiles === null) await writePresetProfiles();
  }

  async function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/fabricador-modelos") {
      sendJson(response, request, 200, assets.map((asset) => ({
        ...asset,
        fileUrl: `http://${host}:${port}/files/fabricador-modelos/${asset.id}`,
      })).sort((left, right) =>
        String(right.createdAt || "").localeCompare(String(left.createdAt || ""))));
      return true;
    }

    if (request.method === "GET" && url.pathname === "/fabricador-modelos/presets") {
      sendJson(response, request, 200, presets);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/fabricador-modelos/preset-profiles") {
      sendJson(response, request, 200, presetProfiles);
      return true;
    }

    if (request.method === "PUT" && url.pathname === "/fabricador-modelos/preset-profiles") {
      const body = await requestJson(request);
      const normalized = normalizeFabricatorPresetProfiles(body, presets);
      await queueMutation(async () => {
        const previousProfiles = presetProfiles;
        const previousPresets = presets;
        try {
          presetProfiles = normalized;
          const standardProfile = normalized.profiles.find((profile) => profile.id === "padrao");
          if (standardProfile) presets = standardProfile.presets;
          await Promise.all([writePresetProfiles(), writePresets()]);
        } catch (error) {
          presetProfiles = previousProfiles;
          presets = previousPresets;
          throw error;
        }
      });
      sendJson(response, request, 200, presetProfiles);
      return true;
    }

    if (request.method === "PUT" && url.pathname === "/fabricador-modelos/presets") {
      const body = await requestJson(request);
      const normalized = normalizeFabricatorPresets(body);
      await queueMutation(async () => {
        const previous = presets;
        try {
          presets = normalized;
          await writePresets();
        } catch (error) {
          presets = previous;
          throw error;
        }
      });
      sendJson(response, request, 200, presets);
      return true;
    }

    const assetMatch = url.pathname.match(/^\/fabricador-modelos\/([a-zA-Z0-9_-]{1,120})$/);
    if (assetMatch && request.method === "POST") {
      const id = safeId(assetMatch[1]);
      const metadata = readMetadata(request);
      const contentType = contentTypeOf(request, metadata);
      assertMimeType(contentType, IMAGE_MIME_TYPES, "O arquivo do Fabricador precisa ser PNG, JPEG ou WebP.");
      const kind = FABRICATOR_KINDS.has(metadata.kind) ? metadata.kind : null;
      if (!kind) {
        throw Object.assign(new Error("O tipo do arquivo do Fabricador é inválido."), {
          status: 400,
          code: "INVALID_FABRICATOR_KIND",
        });
      }
      if (assets.some((asset) => asset.id === id)) {
        throw Object.assign(new Error("Já existe um asset com este identificador."), {
          status: 409,
          code: "FABRICATOR_ASSET_EXISTS",
        });
      }

      const body = await requestBody(request, BODY_LIMITS.image);
      const extension = contentType === "image/jpeg" ? ".jpg" : contentType === "image/webp" ? ".webp" : ".png";
      const fileName = `${id}${extension}`;
      const filePath = join(root, fileName);
      if (!inside(root, filePath)) throw new Error("Destino do Fabricador inválido");
      await mkdir(root, { recursive: true });

      await queueMutation(async () => {
        if (assets.some((entry) => entry.id === id)) {
          throw Object.assign(new Error("Já existe um asset com este identificador."), {
            status: 409,
            code: "FABRICATOR_ASSET_EXISTS",
          });
        }
        const previousAssets = assets;
        try {
          await writeFile(filePath, body);
          const grid = kind === "manpu" ? normalizeFabricatorGrid(metadata.grid) : null;
          assets = [
            ...assets,
            {
              id,
              name: String(metadata.name || "Folha sem nome").slice(0, 160),
              kind,
              contentType,
              fileName,
              createdAt: metadata.createdAt || new Date().toISOString(),
              chroma: normalizeFabricatorChroma(metadata.chroma),
              placement: normalizeFabricatorPlacement(metadata.placement),
              ...(grid ? { grid } : {}),
            },
          ];
          await writeAssets();
        } catch (error) {
          assets = previousAssets;
          await rm(filePath, { force: true }).catch(() => undefined);
          throw error;
        }
      });

      sendJson(response, request, 200, {
        ok: true,
        id,
        fileUrl: `http://${host}:${port}/files/fabricador-modelos/${id}`,
      });
      return true;
    }

    if (assetMatch && request.method === "PATCH") {
      const id = safeId(assetMatch[1]);
      const asset = assets.find((entry) => entry.id === id);
      if (!asset) {
        throw Object.assign(new Error("Arquivo do Fabricador não encontrado."), {
          status: 404,
          code: "FABRICATOR_ASSET_NOT_FOUND",
        });
      }
      const body = await requestJson(request);
      const chroma = body?.chroma === undefined ? undefined : normalizeFabricatorChroma(body.chroma);
      const placement = body?.placement === undefined ? undefined : normalizeFabricatorPlacement(body.placement);
      const grid = body?.grid === undefined ? undefined : normalizeFabricatorGrid(body.grid);
      if (body?.chroma !== undefined && !chroma) {
        throw Object.assign(new Error("Configuração de chroma inválida."), { status: 400, code: "INVALID_FABRICATOR_CHROMA" });
      }
      if (body?.placement !== undefined && !placement) {
        throw Object.assign(new Error("Posição do asset inválida."), { status: 400, code: "INVALID_FABRICATOR_PLACEMENT" });
      }
      if (body?.grid !== undefined && !grid) {
        throw Object.assign(new Error("Grade do asset inválida."), { status: 400, code: "INVALID_FABRICATOR_GRID" });
      }
      if (!chroma && !placement && !grid) {
        throw Object.assign(new Error("Nenhuma alteração válida para o asset."), { status: 400, code: "EMPTY_FABRICATOR_PATCH" });
      }

      await queueMutation(async () => {
        const previousAssets = assets;
        try {
          assets = assets.map((entry) => entry.id === id
            ? {
                ...entry,
                ...(chroma ? { chroma } : {}),
                ...(placement ? { placement } : {}),
                ...(grid ? { grid } : {}),
              }
            : entry);
          await writeAssets();
        } catch (error) {
          assets = previousAssets;
          throw error;
        }
      });

      sendJson(response, request, 200, {
        ok: true,
        id,
        ...(chroma ? { chroma } : {}),
        ...(placement ? { placement } : {}),
        ...(grid ? { grid } : {}),
      });
      return true;
    }

    if (assetMatch && request.method === "DELETE") {
      const id = safeId(assetMatch[1]);
      const asset = assets.find((entry) => entry.id === id);
      if (!asset) {
        throw Object.assign(new Error("Arquivo do Fabricador não encontrado."), {
          status: 404,
          code: "FABRICATOR_ASSET_NOT_FOUND",
        });
      }

      await queueMutation(async () => {
        const previousAssets = assets;
        const previousPresets = presets;
        const sourcePath = join(root, asset.fileName);
        const quarantinePath = join(root, `.delete-${id}-${Date.now()}`);
        let quarantined = false;

        try {
          try {
            await rename(sourcePath, quarantinePath);
            quarantined = true;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }

          assets = assets.filter((entry) => entry.id !== id);
          if (EFFECT_KINDS.has(asset.kind)) {
            presets = Object.fromEntries(Object.entries(presets).map(([key, preset]) => {
              if (preset?.effectAssets?.[asset.kind] !== id) return [key, preset];
              return [key, {
                ...preset,
                enabledEffects: { ...preset.enabledEffects, [asset.kind]: false },
                effectAssets: { ...preset.effectAssets, [asset.kind]: null },
              }];
            }));
          }

          await Promise.all([writeAssets(), writePresets()]);
          if (quarantined) await rm(quarantinePath, { force: true });
        } catch (error) {
          assets = previousAssets;
          presets = previousPresets;
          if (quarantined) await rename(quarantinePath, sourcePath).catch(() => undefined);
          await Promise.all([writeAssets(), writePresets()]).catch(() => undefined);
          throw error;
        }
      });

      sendJson(response, request, 200, { ok: true, id });
      return true;
    }

    const fileMatch = url.pathname.match(/^\/files\/fabricador-modelos\/([a-zA-Z0-9_-]{1,120})$/);
    if (fileMatch && request.method === "GET") {
      const id = safeId(fileMatch[1]);
      const asset = assets.find((entry) => entry.id === id);
      if (!asset) {
        throw Object.assign(new Error("Arquivo do Fabricador não encontrado."), {
          status: 404,
          code: "FABRICATOR_ASSET_NOT_FOUND",
        });
      }
      await serveFile(response, request, join(root, asset.fileName));
      return true;
    }

    return false;
  }

  return {
    initialize,
    handle,
    snapshot() {
      return {
        assets: structuredClone(assets),
        presets: structuredClone(presets),
        presetProfiles: structuredClone(presetProfiles),
      };
    },
  };
}
