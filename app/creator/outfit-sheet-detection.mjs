import { findVisibleBounds } from "../image-bounds.mjs";

export function contentBoundsInside(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  search: ImageRegion,
  padding: number,
) {
  return findVisibleBounds(data, width, height, {
    alphaThreshold: 32,
    padding,
    search,
  });
}

export function detectOutfitSheetRegions(data: Uint8ClampedArray, width: number, height: number) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const labels = new Uint16Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  let nextLabel = 1;
  const visible = (pixelIndex: number) => data[pixelIndex * 4 + 3] > 40;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || !visible(start)) continue;
    let head = 0;
    let tail = 0;
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const label = nextLabel++;
    visited[start] = 1;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
          const neighbor = neighborY * width + neighborX;
          if (!visited[neighbor] && visible(neighbor)) {
            visited[neighbor] = 1;
            labels[neighbor] = label;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    if (pixels >= 32) components.push({ label, pixels, minX, minY, maxX, maxY });
  }

  const largest = Math.max(0, ...components.map((component) => component.pixels));
  const mainThreshold = Math.max(800, Math.round(pixelCount * .002), Math.round(largest * .18));
  const main = components
    .filter((component) => component.pixels >= mainThreshold)
    .sort((left, right) => left.minX - right.minX);
  main.forEach((component, index) => { component.owner = index + 1; });
  const minor = components.filter((component) => component.pixels < mainThreshold);
  const attachDistance = Math.max(24, Math.round(Math.max(width, height) * .055));
  minor.forEach((component) => {
    let nearest;
    let nearestDistance = Number.POSITIVE_INFINITY;
    main.forEach((candidate) => {
      const distanceX = Math.max(candidate.minX - component.maxX, component.minX - candidate.maxX, 0);
      const distanceY = Math.max(candidate.minY - component.maxY, component.minY - candidate.maxY, 0);
      const distance = Math.hypot(distanceX, distanceY);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    });
    if (nearest !== undefined && nearestDistance <= attachDistance) {
      component.owner = nearest.owner;
      nearest.minX = Math.min(nearest.minX, component.minX);
      nearest.minY = Math.min(nearest.minY, component.minY);
      nearest.maxX = Math.max(nearest.maxX, component.maxX);
      nearest.maxY = Math.max(nearest.maxY, component.maxY);
    }
  });

  const ownerByLabel = new Map<number, number>();
  [...main, ...minor].forEach((component) => {
    if (component.owner) ownerByLabel.set(component.label, component.owner);
  });
  const owners = new Uint16Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    owners[pixelIndex] = ownerByLabel.get(labels[pixelIndex]) ?? 0;
  }

  const safetyPadding = Math.max(7, Math.round(Math.max(width, height) * .005));
  const regions = main.map((component) => {
      const x = Math.max(0, component.minX - safetyPadding);
      const y = Math.max(0, component.minY - safetyPadding);
      return {
        x,
        y,
        width: Math.min(width, component.maxX + safetyPadding + 1) - x,
        height: Math.min(height, component.maxY + safetyPadding + 1) - y,
        owner: component.owner!,
      };
    })
    .sort((left, right) => left.x - right.x);
  return { regions, owners };
}
