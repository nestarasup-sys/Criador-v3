import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "tests", "alinhador-profissional-v2", "fixtures", "same-character-abc");
const REPORT = path.join(ROOT, "tests", "alinhador-profissional-v2", "analysis-report.json");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function isBackground(r, g, b, a) {
  if (a < 12) return true;
  if (r > 242 && g > 242 && b > 242 && Math.max(r, g, b) - Math.min(r, g, b) < 10) return true;
  const dominance = g - Math.max(r, b);
  return g > 72 && dominance > 24 && g > r * 1.16 && g > b * 1.13;
}

function largestComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let read = 0; let write = 0; queue[write++] = start; visited[start] = 1;
    let area = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    let sumX = 0; let sumY = 0; let sumXX = 0; let sumYY = 0; let sumXY = 0;
    while (read < write) {
      const current = queue[read++]; const x = current % width; const y = Math.floor(current / width);
      area += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue; const nx = x + dx; const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx; if (!mask[next] || visited[next]) continue;
        visited[next] = 1; queue[write++] = next;
      }
    }
    if (!best || area > best.area) best = { area, minX, minY, maxX, maxY, sumX, sumY, sumXX, sumYY, sumXY };
  }
  return best;
}

function measureCell(data, imageWidth, channels, left, top, right, bottom) {
  const width = right - left; const height = bottom - top;
  const mask = new Uint8Array(width * height);
  const inset = 2;

  for (let y = top + inset; y < bottom - inset; y += 1) {
    for (let x = left + inset; x < right - inset; x += 1) {
      const offset = (y * imageWidth + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = channels === 4 ? data[offset + 3] : 255;
      if (isBackground(r, g, b, a)) continue;
      mask[(y - top) * width + (x - left)] = 1;
    }
  }
  const component = largestComponent(mask, width, height);
  if (!component) return { valid: false };
  const { area, minX, minY, maxX, maxY, sumX, sumY, sumXX, sumYY, sumXY } = component;
  const centroidX = sumX / area;
  const centroidY = sumY / area;
  const covarianceXX = sumXX / area - centroidX * centroidX;
  const covarianceYY = sumYY / area - centroidY * centroidY;
  const covarianceXY = sumXY / area - centroidX * centroidY;
  const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY) * 180 / Math.PI;
  const subjectWidth = maxX - minX + 1;
  const subjectHeight = maxY - minY + 1;
  return {
    valid: true,
    bounds: { x: minX, y: minY, width: subjectWidth, height: subjectHeight },
    center: { x: round(centroidX, 2), y: round(centroidY, 2) },
    foregroundArea: area,
    foregroundRatio: round(area / ((right - left) * (bottom - top))),
    aspectRatio: round(subjectWidth / subjectHeight),
    pcaAngle: round(angle, 2)
  };
}

async function analyzeSheet(label, file) {
  const image = sharp(file).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const left = Math.round(column * info.width / 7);
      const right = Math.round((column + 1) * info.width / 7);
      const top = Math.round(row * info.height / 3);
      const bottom = Math.round((row + 1) * info.height / 3);
      cells.push({ id: `${label}-${row * 7 + column + 1}`, row, column, ...measureCell(data, info.width, info.channels, left, top, right, bottom) });
    }
  }
  return { label, file: path.basename(file), width: info.width, height: info.height, cells };
}

function spread(values) {
  return { min: round(Math.min(...values), 2), median: round(median(values), 2), max: round(Math.max(...values), 2), range: round(Math.max(...values) - Math.min(...values), 2) };
}

function summarizeSheet(sheet) {
  const valid = sheet.cells.filter((cell) => cell.valid);
  return {
    detected: valid.length,
    width: spread(valid.map((cell) => cell.bounds.width)),
    height: spread(valid.map((cell) => cell.bounds.height)),
    centerX: spread(valid.map((cell) => cell.center.x)),
    centerY: spread(valid.map((cell) => cell.center.y)),
    aspectRatio: spread(valid.map((cell) => cell.aspectRatio)),
    foregroundRatio: spread(valid.map((cell) => cell.foregroundRatio)),
    pcaAngle: spread(valid.map((cell) => cell.pcaAngle))
  };
}

function compareCorresponding(sheets) {
  return Array.from({ length: 21 }, (_, index) => {
    const cells = sheets.map((sheet) => sheet.cells[index]);
    const values = (reader) => cells.map(reader);
    return {
      slot: index + 1,
      widthRange: spread(values((cell) => cell.bounds.width)).range,
      heightRange: spread(values((cell) => cell.bounds.height)).range,
      centerXRange: spread(values((cell) => cell.center.x)).range,
      centerYRange: spread(values((cell) => cell.center.y)).range,
      aspectRange: spread(values((cell) => cell.aspectRatio)).range,
      angleRange: spread(values((cell) => cell.pcaAngle)).range
    };
  });
}

export async function analyzeFixture() {
  const metadata = JSON.parse(await readFile(path.join(FIXTURE, "metadata.json"), "utf8"));
  const sheets = await Promise.all(Object.entries(metadata.sheets).map(([label, item]) => analyzeSheet(label, path.join(FIXTURE, item.file))));
  const corresponding = compareCorresponding(sheets);
  const report = {
    version: 1,
    fixture: metadata.id,
    generatedBy: "scripts/analyze-alinhador-v2-fixtures.mjs",
    sheets: Object.fromEntries(sheets.map((sheet) => [sheet.label, summarizeSheet(sheet)])),
    corresponding,
    worstCrossSheetVariation: {
      width: [...corresponding].sort((a, b) => b.widthRange - a.widthRange).slice(0, 5),
      height: [...corresponding].sort((a, b) => b.heightRange - a.heightRange).slice(0, 5),
      center: [...corresponding].sort((a, b) => (b.centerXRange + b.centerYRange) - (a.centerXRange + a.centerYRange)).slice(0, 5),
      aspect: [...corresponding].sort((a, b) => b.aspectRange - a.aspectRange).slice(0, 5)
    }
  };
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await analyzeFixture();
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}
