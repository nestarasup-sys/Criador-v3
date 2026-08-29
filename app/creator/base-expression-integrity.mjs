import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Região estável da base head-only abaixo do queixo.
 *
 * Os quadros de expressão mudam olhos/boca, mas o pescoço não deveria abrir
 * janelas para o cabelo traseiro. O ponto de referência vem do anchor do
 * pacote, para o diagnóstico continuar reproduzível sem depender do nome da
 * personagem.
 */
export function neckRegionForPack(config = {}) {
  const anchorX = Number.isFinite(config.anchorX) ? Number(config.anchorX) : 960;
  const anchorY = Number.isFinite(config.anchorY) ? Number(config.anchorY) : 346;
  return {
    left: Math.round(anchorX - 20),
    top: Math.round(anchorY - 25),
    width: 46,
    height: 21,
  };
}

export const DEFAULT_BASE_EMOTIONS = [
  "normal",
  "serio",
  "raiva",
  "assustado",
  "corado",
  "sorriso_canto",
  "surpreso",
];

async function readRaw(filePath) {
  return sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixelsMissingFromReference(candidate, reference, region, threshold = 250) {
  const missing = [];
  const left = Math.max(0, region.left);
  const top = Math.max(0, region.top);
  const right = Math.min(candidate.info.width, region.left + region.width);
  const bottom = Math.min(candidate.info.height, region.top + region.height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * candidate.info.width + x) * 4;
      const referenceAlpha = reference.data[offset + 3];
      const candidateAlpha = candidate.data[offset + 3];
      if (referenceAlpha >= threshold && candidateAlpha < threshold) missing.push({ x, y, offset });
    }
  }
  return missing;
}

function expressionNames(files, emotions = DEFAULT_BASE_EMOTIONS) {
  const available = new Set(files);
  return emotions.flatMap((emotion) => [
    `${emotion}.png`,
    `${emotion}_talk.png`,
  ]).filter((name) => available.has(name));
}

export async function inspectBaseExpressionPack(packDir, options = {}) {
  const files = await fs.readdir(packDir);
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(path.join(packDir, "model.json"), "utf8"));
  } catch {
    // Packs legados podem não ter metadados; o anchor padrão é determinístico.
  }
  const region = options.region ?? neckRegionForPack(config);
  const names = expressionNames(files, options.emotions ?? DEFAULT_BASE_EMOTIONS);
  const entries = [];
  for (const name of names) {
    const emotion = name.replace(/(?:_talk)?\.png$/, "");
    const referenceName = `${emotion}_blink.png`;
    if (!files.includes(referenceName)) {
      entries.push({ name, referenceName, status: "reference-missing", missingPixels: null });
      continue;
    }
    const [candidate, reference] = await Promise.all([
      readRaw(path.join(packDir, name)),
      readRaw(path.join(packDir, referenceName)),
    ]);
    const missing = pixelsMissingFromReference(candidate, reference, region, options.alphaThreshold ?? 250);
    entries.push({
      name,
      referenceName,
      status: missing.length ? "neck-gaps" : "covered",
      missingPixels: missing.length,
      boundingBox: missing.length ? {
        minX: Math.min(...missing.map((point) => point.x)),
        minY: Math.min(...missing.map((point) => point.y)),
        maxX: Math.max(...missing.map((point) => point.x)),
        maxY: Math.max(...missing.map((point) => point.y)),
      } : null,
    });
  }
  return { packDir: path.resolve(packDir), region, entries };
}

/**
 * Copia somente os pixels de pescoço que estão opacos no quadro blink
 * correspondente e transparentes/semitransparentes no alvo. Não toca em
 * olhos, boca, cabelo ou no restante do asset.
 */
export async function repairBaseExpressionPack(packDir, options = {}) {
  const files = await fs.readdir(packDir);
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(path.join(packDir, "model.json"), "utf8"));
  } catch {
    // Usa o anchor padrão para pacotes legados.
  }
  const region = options.region ?? neckRegionForPack(config);
  const names = expressionNames(files, options.emotions ?? DEFAULT_BASE_EMOTIONS);
  const repaired = [];
  for (const name of names) {
    const emotion = name.replace(/(?:_talk)?\.png$/, "");
    const referenceName = `${emotion}_blink.png`;
    if (!files.includes(referenceName)) continue;
    const [candidate, reference] = await Promise.all([
      readRaw(path.join(packDir, name)),
      readRaw(path.join(packDir, referenceName)),
    ]);
    const missing = pixelsMissingFromReference(candidate, reference, region, options.alphaThreshold ?? 250);
    if (!missing.length) continue;
    for (const { offset } of missing) {
      candidate.data[offset] = reference.data[offset];
      candidate.data[offset + 1] = reference.data[offset + 1];
      candidate.data[offset + 2] = reference.data[offset + 2];
      candidate.data[offset + 3] = reference.data[offset + 3];
    }
    await sharp(candidate.data, { raw: candidate.info }).png().toFile(path.join(packDir, name));
    repaired.push({ name, referenceName, repairedPixels: missing.length });
  }
  return { packDir: path.resolve(packDir), region, repaired };
}
