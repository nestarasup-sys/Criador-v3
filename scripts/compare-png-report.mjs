import crypto from "node:crypto";
import sharp from "sharp";

const [referencePath, candidatePath, diffPath] = process.argv.slice(2);
if (!referencePath || !candidatePath) throw new Error("Uso: node scripts/compare-png-report.mjs <a.png> <b.png> [diff.png]");
const [a, b] = await Promise.all([
  sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  sharp(candidatePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
]);
const result = {
  hashA: crypto.createHash("sha256").update(await sharp(referencePath).png().toBuffer()).digest("hex"),
  hashB: crypto.createHash("sha256").update(await sharp(candidatePath).png().toBuffer()).digest("hex"),
  dimensionsA: { width: a.info.width, height: a.info.height },
  dimensionsB: { width: b.info.width, height: b.info.height },
};
if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}
let changed = 0;
let max = 0;
let total = 0;
let minX = a.info.width;
let minY = a.info.height;
let maxX = -1;
let maxY = -1;
const diff = Buffer.alloc(a.data.length);
for (let i = 0; i < a.data.length; i += 4) {
  const delta = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a.data[i + channel] - b.data[i + channel])));
  max = Math.max(max, delta);
  total += delta / 255;
  diff[i] = diff[i + 1] = diff[i + 2] = delta;
  diff[i + 3] = delta ? 255 : 0;
  if (!delta) continue;
  const pixel = i / 4;
  const x = pixel % a.info.width;
  const y = Math.floor(pixel / a.info.width);
  changed += 1;
  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  maxX = Math.max(maxX, x);
  maxY = Math.max(maxY, y);
}
result.totalPixels = a.info.width * a.info.height;
result.differentPixels = changed;
result.differencePercentage = changed / result.totalPixels * 100;
result.maxChannelDifference = max;
result.meanDifference = total / result.totalPixels;
result.boundingBox = changed ? { minX, minY, maxX, maxY } : null;
if (diffPath) {
  await sharp(diff, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toFile(diffPath);
  result.diffPath = diffPath;
}
console.log(JSON.stringify(result, null, 2));
