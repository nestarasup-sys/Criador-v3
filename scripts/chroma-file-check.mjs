import sharp from "sharp";
import { applyChromaPixels, estimateChromaKey } from "../app/chroma-processing.mjs";

const [input, output = "chroma-file-check.png"] = process.argv.slice(2);
if (!input) throw new Error("Uso: node scripts/chroma-file-check.mjs <imagem> [saida.png]");

const original = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = original.info;
const estimate = estimateChromaKey(original.data, width, height);
if (!estimate) throw new Error("Não foi possível estimar uma cor de chroma saturada nas bordas");

const processed = new Uint8ClampedArray(original.data);
applyChromaPixels(processed, width, height, estimate.color, estimate.tolerance, estimate.softness, false, {
  cleanEdges: true,
  feather: 1,
  despill: 72,
  intensity: 100,
});

const checker = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#eee"/><path d="M0 0h16v16H0zM16 16h16v16H16z" fill="#c9cad1"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`);
const resultPng = await sharp(Buffer.from(processed.buffer), { raw: { width, height, channels: 4 } }).png().toBuffer();
const after = await sharp(checker).composite([{ input: resultPng }]).png().toBuffer();
const panelWidth = 836;
const panelHeight = Math.round(height * panelWidth / width);
const beforePanel = await sharp(input).resize(panelWidth, panelHeight).png().toBuffer();
const afterPanel = await sharp(after).resize(panelWidth, panelHeight).png().toBuffer();
const labelHeight = 54;
const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * 2}" height="${labelHeight}"><rect width="100%" height="100%" fill="#202131"/><text x="${panelWidth / 2}" y="35" fill="white" font-size="22" font-family="Arial" text-anchor="middle">ORIGINAL</text><text x="${panelWidth * 1.5}" y="35" fill="white" font-size="22" font-family="Arial" text-anchor="middle">CHROMA ROBUSTO</text></svg>`);
await sharp({ create: { width: panelWidth * 2, height: panelHeight + labelHeight, channels: 4, background: "#202131" } })
  .composite([
    { input: labels, left: 0, top: 0 },
    { input: beforePanel, left: 0, top: labelHeight },
    { input: afterPanel, left: panelWidth, top: labelHeight },
  ])
  .png()
  .toFile(output);

let transparent = 0;
let partial = 0;
for (let index = 3; index < processed.length; index += 4) {
  if (processed[index] === 0) transparent += 1;
  else if (processed[index] < 255) partial += 1;
}
console.log(JSON.stringify({ output, estimate, transparent, partial, pixels: width * height }));
