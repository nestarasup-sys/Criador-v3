import { largestConnectedComponent, type BinaryMask } from "./structural-mask";

export function removeForeignEdgeFragments(data: Uint8ClampedArray, width: number, height: number) {
  if (width < 2 || height < 2) return data;
  const mask: BinaryMask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = data[index * 4 + 3] > 12 ? 1 : 0;
  const main = largestConnectedComponent(mask, width, height);
  if (!main) return data;
  const seen = new Uint8Array(mask.length); const queue = new Int32Array(mask.length); const edgeBand = Math.max(3, Math.round(height * .045)); const maxForeignArea = main.area * .38;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start] || main.mask[start]) continue;
    let head = 0; let tail = 0; let minY = height; let maxY = -1; const pixels: number[] = [];
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const index = queue[head++]; const x = index % width; const y = Math.floor(index / width); pixels.push(index); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
      for (const neighbour of neighbours) if (neighbour >= 0 && mask[neighbour] && !seen[neighbour] && !main.mask[neighbour]) { seen[neighbour] = 1; queue[tail++] = neighbour; }
    }
    const touchesTop = minY <= edgeBand; const touchesBottom = maxY >= height - 1 - edgeBand; const clearlyAbove = touchesTop && maxY < main.y + Math.max(2, main.height * .08); const clearlyBelow = touchesBottom && minY > main.y + main.height - 1 - Math.max(2, main.height * .08);
    if (pixels.length <= maxForeignArea && (clearlyAbove || clearlyBelow)) for (const index of pixels) data[index * 4 + 3] = 0;
  }
  return data;
}
