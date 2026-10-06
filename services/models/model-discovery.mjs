import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { baseExpressionKeys, collectModelExpressionKeys } from "../../app/domain/model-expression-keys.mjs";
import { normalizeModelColorMapMetadata } from "../../app/domain/model-color-map.mjs";

export const MODEL_CATALOG_METADATA_FILE = ".catalog.json";

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readModelConfig(folder, modelId) {
  const candidates = ["model.json", "modelo.json", `${modelId}.json`];
  for (const name of candidates) {
    const path = join(folder, name);
    const config = await readOptionalJson(path);
    if (config) return { config, path };
  }
  return { config: {}, path: join(folder, "model.json") };
}

export function normalizeModelPresetTag(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  const name = String(value.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const color = String(value.color ?? "");
  if (!id || !name || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return { id, name, color: color.toLowerCase() };
}

async function readModelCatalogVersion(folder, config) {
  const metadata = await readOptionalJson(join(folder, MODEL_CATALOG_METADATA_FILE));
  if (metadata?.catalogVersion === "v0" || metadata?.catalogVersion === "v1") return metadata.catalogVersion;
  return config?.catalogVersion === "v0" ? "v0" : "v1";
}

async function inferHeadOnlyLayout(folder, pngFiles) {
  const normalFile = pngFiles.find((name) => name.toLowerCase() === "normal.png");
  if (!normalFile) return null;
  try {
    const { data, info } = await sharp(join(folder, normalFile))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let maxX = -1;
    let minY = info.height;
    let maxY = -1;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] <= 12) continue;
      const pixel = (index - 3) / 4;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (maxX < minX || maxY < minY) return null;
    const isCanvasHeadOnly = info.width >= 1000
      && info.height >= 700
      && maxY - minY + 1 <= info.height * 0.55
      && maxY <= info.height * 0.65;
    if (!isCanvasHeadOnly) return null;
    return {
      type: "head-only",
      anchor: "neck-base",
      anchorX: Math.round(info.width / 2),
      anchorY: maxY,
    };
  } catch {
    return null;
  }
}

export function createModelDiscovery(modelsRoot) {
  return async function discoverModels() {
    const result = { feminino: [], masculino: [] };
    for (const gender of Object.keys(result)) {
      const genderRoot = join(modelsRoot, gender);
      const entries = (await readdir(genderRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
      for (const [index, entry] of entries.entries()) {
        const folder = join(genderRoot, entry.name);
        const files = await readdir(folder);
        const pngFiles = files.filter((name) => name.toLowerCase().endsWith(".png"));
        const expressionKeys = collectModelExpressionKeys(pngFiles);
        const { config, path: configPath } = await readModelConfig(folder, entry.name);
        const catalogVersion = await readModelCatalogVersion(folder, config);
        const availableBaseExpressions = baseExpressionKeys(expressionKeys);
        if (availableBaseExpressions.length === 0) continue;
        const configuredDefault = typeof config?.defaultExpression === "string"
          ? config.defaultExpression.trim()
          : "";
        const defaultExpressionKey = expressionKeys.includes(configuredDefault)
          ? configuredDefault
          : expressionKeys.includes("normal")
          ? "normal"
          : availableBaseExpressions.includes("neutra")
          ? "neutra"
          : availableBaseExpressions[0];
        const resolvedExpressionKeys = expressionKeys.includes("normal")
          ? expressionKeys
          : ["normal", ...expressionKeys];
        const expressionAliases = defaultExpressionKey === "normal"
          ? undefined
          : { normal: defaultExpressionKey };
        const colorMap = normalizeModelColorMapMetadata(config?.colorMap);
        const presetTag = normalizeModelPresetTag(config?.presetTag);
        const inferredLayout = config?.type === "head-only"
          ? null
          : await inferHeadOnlyLayout(folder, pngFiles);
        const colorMapFiles = colorMap
          ? (await readdir(join(folder, colorMap.directory)).catch(() => []))
            .filter((name) => name.toLowerCase().endsWith(".png"))
          : [];
        const versionParts = await Promise.all([
          ...pngFiles.map(async (name) => {
            const metadata = await stat(join(folder, name));
            return `${name}:${metadata.size}:${metadata.mtimeMs}`;
          }),
          ...colorMapFiles.map(async (name) => {
            const metadata = await stat(join(folder, colorMap.directory, name));
            return `color-map/${name}:${metadata.size}:${metadata.mtimeMs}`;
          }),
          stat(configPath)
            .then((metadata) => `config:${metadata.size}:${metadata.mtimeMs}`)
            .catch(() => "config:none"),
          stat(join(folder, MODEL_CATALOG_METADATA_FILE))
            .then((metadata) => `catalog:${metadata.size}:${metadata.mtimeMs}`)
            .catch(() => "catalog:none"),
        ]);
        const version = createHash("sha1")
          .update(versionParts.sort().join("|"))
          .digest("hex")
          .slice(0, 16);
        const numberedModel = entry.name.match(/^modelo-(\d+)$/i);
        result[gender].push({
          id: entry.name,
          name: numberedModel
            ? `Modelo ${Number(numberedModel[1])}`
            : typeof config?.name === "string" && config.name.trim()
            ? config.name.trim()
            : `Modelo ${index + 1}`,
          expressionKeys: resolvedExpressionKeys,
          ...(expressionAliases ? { expressionAliases } : {}),
          source: `/models/modelos/${gender}/${entry.name}`,
          version,
          catalogVersion,
          ...((config?.type === "head-only" || inferredLayout) ? {
            type: "head-only",
            anchor: config?.anchor === "neck-base" || inferredLayout?.anchor === "neck-base"
              ? "neck-base"
              : undefined,
            anchorX: Number.isFinite(config?.anchorX) ? Number(config.anchorX) : inferredLayout?.anchorX,
            anchorY: Number.isFinite(config?.anchorY) ? Number(config.anchorY) : inferredLayout?.anchorY,
          } : {}),
          ...(colorMap ? { colorMap } : {}),
          ...(presetTag ? { presetTag } : {}),
        });
      }
    }
    return result;
  };
}
