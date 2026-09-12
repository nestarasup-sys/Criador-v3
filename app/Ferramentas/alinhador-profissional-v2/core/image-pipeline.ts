export type V2Landmark = { name: string; label: string; x: number; y: number; weight: number; kind: "structural" | "detail"; enabled: boolean };
export type V2Head = {
  id: string;
  sheet: "A" | "B" | "C";
  slot: number;
  width: number;
  height: number;
  sourceUrl: string;
  landmarks: V2Landmark[];
  touchesSourceBoundary: boolean;
  foregroundRatio: number;
};

const LABELS: Record<string, string> = { top: "Topo", left: "Lateral E", right: "Lateral D", chin: "Queixo", neckLeft: "Pescoço E", neckRight: "Pescoço D", eyeLeft: "Olho E", eyeRight: "Olho D", nose: "Nariz", mouth: "Boca" };

function isGreenBackground(r: number, g: number, b: number, a: number) {
  const neutralSeparator = r > 242 && g > 242 && b > 242 && Math.max(r, g, b) - Math.min(r, g, b) < 10;
  return a < 12 || neutralSeparator || (g > 70 && g - Math.max(r, b) > 23 && g > r * 1.15 && g > b * 1.12);
}

function largestComponentBounds(mask: Uint8ClampedArray, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best = { area: 0, minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let read = 0; let write = 0; queue[write++] = start; visited[start] = 1;
    let area = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    while (read < write) {
      const current = queue[read++]; const x = current % width; const y = Math.floor(current / width);
      area += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue; const nx = x + dx; const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx; if (!mask[next] || visited[next]) continue;
        visited[next] = 1; queue[write++] = next;
      }
    }
    if (area > best.area) best = { area, minX, minY, maxX, maxY };
  }
  return best;
}

function rowExtent(alpha: Uint8ClampedArray, width: number, y: number) {
  let left = width;
  let right = -1;
  for (let x = 0; x < width; x += 1) if (alpha[y * width + x] > 20) { left = Math.min(left, x); right = Math.max(right, x); }
  return right >= left ? { left, right, width: right - left + 1 } : null;
}

function nearestExtent(alpha: Uint8ClampedArray, width: number, height: number, targetY: number) {
  for (let delta = 0; delta < height; delta += 1) {
    for (const y of [targetY - delta, targetY + delta]) if (y >= 0 && y < height) {
      const extent = rowExtent(alpha, width, y);
      if (extent && extent.width > width * 0.18) return { ...extent, y };
    }
  }
  return { left: 0, right: width - 1, width, y: targetY };
}

function landmarksFor(alpha: Uint8ClampedArray, width: number, height: number): V2Landmark[] {
  const topLine = nearestExtent(alpha, width, height, 0);
  const headLine = nearestExtent(alpha, width, height, Math.round(height * 0.43));
  let jawY = Math.round(height * 0.82);
  let bestDrop = -Infinity;
  for (let y = Math.round(height * 0.7); y < Math.round(height * 0.92); y += 1) {
    const before = nearestExtent(alpha, width, height, Math.max(0, y - 6)).width;
    const after = nearestExtent(alpha, width, height, Math.min(height - 1, y + 7)).width;
    const drop = before - after;
    if (before > width * 0.52 && after < before * 0.78 && drop + y * 0.025 > bestDrop) { bestDrop = drop + y * 0.025; jawY = y; }
  }
  const neckLine = nearestExtent(alpha, width, height, Math.min(height - 2, jawY + Math.round(height * 0.1)));
  const centerX = (headLine.left + headLine.right) / 2;
  const definitions: Array<[string, number, number, number, "structural" | "detail"]> = [
    ["top", (topLine.left + topLine.right) / 2, topLine.y, 1.5, "structural"], ["left", headLine.left, headLine.y, 1.25, "structural"], ["right", headLine.right, headLine.y, 1.25, "structural"],
    ["chin", centerX, jawY, 1.5, "structural"], ["neckLeft", neckLine.left, neckLine.y, 1, "structural"], ["neckRight", neckLine.right, neckLine.y, 1, "structural"],
    ["eyeLeft", width * 0.39, height * 0.52, 0.35, "detail"], ["eyeRight", width * 0.7, height * 0.52, 0.35, "detail"],
    ["nose", width * 0.59, height * 0.65, 0.2, "detail"], ["mouth", width * 0.58, height * 0.77, 0.2, "detail"],
  ];
  return definitions.map(([name, x, y, weight, kind]) => ({ name, label: LABELS[name], x, y, weight, kind, enabled: true }));
}

export async function processSheet(file: File, sheet: "A" | "B" | "C"): Promise<V2Head[]> {
  const bitmap = await createImageBitmap(file);
  const full = document.createElement("canvas");
  full.width = bitmap.width;
  full.height = bitmap.height;
  const fullContext = full.getContext("2d", { willReadFrequently: true });
  if (!fullContext) throw new Error("Canvas de leitura indisponível.");
  fullContext.drawImage(bitmap, 0, 0);
  const heads: V2Head[] = [];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 7; column += 1) {
    const cellLeft = Math.round(column * bitmap.width / 7);
    const cellRight = Math.round((column + 1) * bitmap.width / 7);
    const cellTop = Math.round(row * bitmap.height / 3);
    const cellBottom = Math.round((row + 1) * bitmap.height / 3);
    const cellWidth = cellRight - cellLeft;
    const cellHeight = cellBottom - cellTop;
    const pixels = fullContext.getImageData(cellLeft, cellTop, cellWidth, cellHeight);
    const alpha = new Uint8ClampedArray(cellWidth * cellHeight);
    let rawArea = 0;
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4;
      const foreground = !isGreenBackground(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2], pixels.data[offset + 3]);
      if (!foreground) { pixels.data[offset + 3] = 0; continue; }
      alpha[index] = 255; rawArea += 1;
    }
    const { area, minX, minY, maxX, maxY } = largestComponentBounds(alpha, cellWidth, cellHeight);
    if (maxX < minX || maxY < minY) continue;
    const padding = 4;
    const left = Math.max(0, minX - padding); const top = Math.max(0, minY - padding);
    const right = Math.min(cellWidth - 1, maxX + padding); const bottom = Math.min(cellHeight - 1, maxY + padding);
    const width = right - left + 1; const height = bottom - top + 1;
    const crop = document.createElement("canvas"); crop.width = width; crop.height = height;
    const cropContext = crop.getContext("2d", { willReadFrequently: true });
    if (!cropContext) throw new Error("Canvas de recorte indisponível.");
    cropContext.putImageData(pixels, -left, -top);
    const cropPixels = cropContext.getImageData(0, 0, width, height);
    const cropAlpha = new Uint8ClampedArray(width * height);
    for (let index = 0; index < cropAlpha.length; index += 1) cropAlpha[index] = cropPixels.data[index * 4 + 3];
    const slot = row * 7 + column + 1;
    const touchesSourceBoundary = (row === 0 && minY <= 2) || (row === 2 && maxY >= cellHeight - 3) || (column === 0 && minX <= 2) || (column === 6 && maxX >= cellWidth - 3);
    heads.push({ id: `${sheet}-${slot}`, sheet, slot, width, height, sourceUrl: crop.toDataURL("image/png"), landmarks: landmarksFor(cropAlpha, width, height), touchesSourceBoundary, foregroundRatio: rawArea / (cellWidth * cellHeight) });
  }
  bitmap.close();
  if (heads.length !== 21) throw new Error(`Folha ${sheet}: ${heads.length}/21 cabeças encontradas.`);
  return heads;
}
