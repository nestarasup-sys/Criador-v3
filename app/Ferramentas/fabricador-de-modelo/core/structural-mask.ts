export type BinaryMask = Uint8Array;
export type MaskComponent = { mask: BinaryMask; area: number; x: number; y: number; width: number; height: number };

export function createVisualMask(data: Uint8ClampedArray, alphaThreshold = 24) {
  const mask = new Uint8Array(data.length / 4);
  for (let index = 0; index < mask.length; index += 1) mask[index] = data[index * 4 + 3] > alphaThreshold ? 1 : 0;
  return mask;
}

function erode(source: BinaryMask, width: number, height: number, radius: number) {
  let current = source;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(source.length);
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (current[index] && current[index - 1] && current[index + 1] && current[index - width] && current[index + width]) next[index] = 1;
    }
    current = next;
  }
  return current;
}

function dilate(source: BinaryMask, width: number, height: number, radius: number) {
  let current = source;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(source.length);
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (current[index] || current[index - 1] || current[index + 1] || current[index - width] || current[index + width]) next[index] = 1;
    }
    current = next;
  }
  return current;
}

export function largestConnectedComponent(mask: BinaryMask, width: number, height: number): MaskComponent | null {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best: MaskComponent | null = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0; let tail = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    const pixels: number[] = [];
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
      pixels.push(index); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const neighbours = x === 0 ? [index - width, index + width, index + 1] : x === width - 1 ? [index - width, index + width, index - 1] : [index - width, index + width, index - 1, index + 1];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= mask.length || seen[neighbour] || !mask[neighbour]) continue;
        seen[neighbour] = 1; queue[tail++] = neighbour;
      }
    }
    if (!best || pixels.length > best.area) {
      const output = new Uint8Array(mask.length); for (const pixel of pixels) output[pixel] = 1;
      best = { mask: output, area: pixels.length, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
  }
  return best;
}

export function createStructuralMask(visualMask: BinaryMask, width: number, height: number, preserveDetails = true) {
  if (!preserveDetails) return { mask: visualMask, component: largestConnectedComponent(visualMask, width, height), ignoredPixels: 0, openingRadius: 0 };
  const component = largestConnectedComponent(visualMask, width, height);
  if (!component) return { mask: visualMask, component: null, ignoredPixels: 0, openingRadius: 0 };
  const radius = Math.max(1, Math.min(3, Math.round(Math.min(component.width, component.height) / 110)));
  const opened = dilate(erode(component.mask, width, height, radius), width, height, radius);
  const structural = largestConnectedComponent(opened, width, height);
  if (!structural || structural.area < component.area * .45) return { mask: component.mask, component, ignoredPixels: 0, openingRadius: 0 };
  let ignoredPixels = 0;
  for (let index = 0; index < visualMask.length; index += 1) if (visualMask[index] && !structural.mask[index]) ignoredPixels += 1;
  return { mask: structural.mask, component: structural, ignoredPixels, openingRadius: radius };
}
