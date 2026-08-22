import sharp from "sharp";
import { applyChromaPixels } from "../app/chroma-processing.mjs";

const width = 420;
const height = 420;
const output = process.argv[2] ?? "chroma-visual-check.png";
const scene = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00d878"/>
      <stop offset=".52" stop-color="#00b764"/>
      <stop offset="1" stop-color="#006f3d"/>
    </linearGradient>
  </defs>
  <rect width="420" height="420" fill="url(#green)"/>
  <ellipse cx="210" cy="83" rx="52" ry="61" fill="#edbc9e" stroke="#352b35" stroke-width="7"/>
  <path d="M158 80 Q168 8 214 18 Q265 14 266 94 Q245 54 211 56 Q178 50 158 80" fill="#29242d"/>
  <path d="M171 143 Q210 119 249 143 L264 294 Q210 324 156 294 Z" fill="#704f91" stroke="#352b35" stroke-width="8"/>
  <!-- Braços ligados ao quadril deixam chroma totalmente cercado entre braço e tronco. -->
  <path d="M169 153 Q107 150 72 219 Q112 286 163 270 L157 236 Q126 246 111 216 Q132 187 169 190 Z" fill="#edbc9e" stroke="#352b35" stroke-width="8"/>
  <path d="M251 153 Q313 150 348 219 Q308 286 257 270 L263 236 Q294 246 309 216 Q288 187 251 190 Z" fill="#edbc9e" stroke="#352b35" stroke-width="8"/>
  <path d="M170 291 L160 405 L198 405 L202 310" fill="#3c334a" stroke="#28222e" stroke-width="8"/>
  <path d="M250 291 L260 405 L222 405 L218 310" fill="#3c334a" stroke="#28222e" stroke-width="8"/>
  <!-- Fios finos sobre o chroma para inspecionar antialiasing e despill. -->
  <path d="M163 56 Q118 105 142 154 M258 52 Q302 112 276 164" fill="none" stroke="#29242d" stroke-width="5" stroke-linecap="round"/>
</svg>`;

const original = await sharp(Buffer.from(scene)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const processed = new Uint8ClampedArray(original.data);
applyChromaPixels(processed, width, height, { r: 0, g: 183, b: 100 }, 38, 58, false, {
  cleanEdges: true,
  feather: 1,
  despill: 78,
  intensity: 100,
});

const alphaAt = (x, y) => processed[(y * width + x) * 4 + 3];
const checks = [
  [135, 215, "entre braço esquerdo e tronco"],
  [285, 215, "entre braço direito e tronco"],
  [210, 365, "entre as pernas"],
];
for (const [x, y, label] of checks) {
  if (alphaAt(x, y) > 24) throw new Error(`Chroma residual ${label}: alpha ${alphaAt(x, y)}`);
}
if (alphaAt(210, 205) < 230) throw new Error("O tronco foi apagado pelo Chroma Key");

const checker = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#eee"/><path d="M0 0h12v12H0zM12 12h12v12H12z" fill="#cfcfd5"/></pattern></defs>
  <rect width="420" height="420" fill="url(#c)"/>
</svg>`);
const processedPng = await sharp(Buffer.from(processed.buffer), { raw: { width, height, channels: 4 } }).png().toBuffer();
const before = await sharp(original.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
const after = await sharp(checker).composite([{ input: processedPng }]).png().toBuffer();
const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="860" height="46"><rect width="860" height="46" fill="#1f2030"/><text x="190" y="30" fill="white" font-size="20" font-family="Arial" text-anchor="middle">ANTES</text><text x="650" y="30" fill="white" font-size="20" font-family="Arial" text-anchor="middle">DEPOIS · CAVIDADES TRANSPARENTES</text></svg>`);
await sharp({ create: { width: 860, height: 466, channels: 4, background: "#1f2030" } })
  .composite([
    { input: labels, left: 0, top: 0 },
    { input: before, left: 0, top: 46 },
    { input: after, left: 440, top: 46 },
  ])
  .png()
  .toFile(output);

console.log(JSON.stringify({ output, internalAlpha: Object.fromEntries(checks.map(([x, y, label]) => [label, alphaAt(x, y)])), torsoAlpha: alphaAt(210, 205) }));
