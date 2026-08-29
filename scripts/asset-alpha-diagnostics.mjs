import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [statePath = "dados-locais-premium/state.json", characterName = "Iris", outputDir = "character-render-debug"] = process.argv.slice(2);

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const character = state.characters.find((item) => item.name.includes(characterName));
if (!character) throw new Error(`Personagem não encontrado: ${characterName}`);
await fs.mkdir(outputDir, { recursive: true });

const catalog = new Map(state.catalog.map((item) => [item.id, item]));
const assets = [
  ["body", { id: `${character.model}/${character.basePackId}/${character.expressionEmotion ?? "normal"}_${character.expressionState ?? "default"}`, url: `/models/modelos/${character.model}/${character.basePackId}/${character.expressionEmotion ?? "normal"}_${character.expressionState ?? "default"}.png` }],
  ["backhair", catalog.get(character.selections.cabelosTras)],
  ["fronthair", catalog.get(character.selections.cabelos)],
  ["clothes", catalog.get(character.selections.roupas)],
].filter(([, item]) => item);

const resolveAsset = (item) => {
  if (item.url?.startsWith("/")) return path.join(process.cwd(), "public", item.url.slice(1));
  return path.join(process.cwd(), "dados-locais-premium", "arquivos", "catalogo", `${item.id}.png`);
};

const statsFor = async (name, filePath) => {
  const decoded = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const data = decoded.data;
  let visible = 0;
  let partial = 0;
  let transparentRgb = 0;
  let green = 0;
  let greenMinX = width;
  let greenMinY = height;
  let greenMaxX = -1;
  let greenMaxY = -1;
  let greenAlphaSum = 0;
  let greenAlphaMin = 255;
  let greenAlphaMax = 0;
  const greenMask = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const alpha = data[offset + 3];
    const x = (offset / 4) % width;
    const y = Math.floor(offset / 4 / width);
    if (alpha > 0) visible += 1;
    if (alpha > 0 && alpha < 255) partial += 1;
    if (alpha === 0 && (r || g || b)) transparentRgb += 1;
    const isGreen = alpha > 0 && g > r * 1.08 && g > b * 1.08;
    if (isGreen) {
      green += 1;
      greenMinX = Math.min(greenMinX, x);
      greenMinY = Math.min(greenMinY, y);
      greenMaxX = Math.max(greenMaxX, x);
      greenMaxY = Math.max(greenMaxY, y);
      greenAlphaSum += alpha;
      greenAlphaMin = Math.min(greenAlphaMin, alpha);
      greenAlphaMax = Math.max(greenAlphaMax, alpha);
      greenMask[offset] = r;
      greenMask[offset + 1] = g;
      greenMask[offset + 2] = b;
      greenMask[offset + 3] = alpha;
    }
  }
  if (green) {
    await sharp(greenMask, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(path.join(outputDir, `${name}-green-pixels.png`));
  }
  return {
    name,
    file: path.resolve(filePath),
    width,
    height,
    visiblePixels: visible,
    partialAlphaPixels: partial,
    transparentRgbPixels: transparentRgb,
    greenPixels: green,
    greenBoundingBox: green ? { minX: greenMinX, minY: greenMinY, maxX: greenMaxX, maxY: greenMaxY } : null,
    greenAlpha: green ? { min: greenAlphaMin, max: greenAlphaMax, mean: greenAlphaSum / green } : null,
  };
};

const results = [];
for (const [name, item] of assets) results.push(await statsFor(name, resolveAsset(item)));
await fs.writeFile(path.join(outputDir, "iris-assets.json"), JSON.stringify({ character: character.name, selections: character.selections, results }, null, 2));
console.log(JSON.stringify({ character: character.name, results }, null, 2));
