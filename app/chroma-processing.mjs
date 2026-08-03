function colorDistance(data, index, color) {
  return Math.hypot(
    data[index] - color.r,
    data[index + 1] - color.g,
    data[index + 2] - color.b,
  );
}

function isChromaDominant(data, index, color) {
  const target = [color.r, color.g, color.b];
  const dominantChannel = target.indexOf(Math.max(...target));
  const otherChannels = [0, 1, 2].filter((channel) => channel !== dominantChannel);
  const targetSpill = target[dominantChannel]
    - (target[otherChannels[0]] + target[otherChannels[1]]) / 2;
  if (targetSpill < 18) return false;
  const pixelSpill = data[index + dominantChannel]
    - (data[index + otherChannels[0]] + data[index + otherChannels[1]]) / 2;
  return pixelSpill >= Math.max(22, targetSpill * .3);
}

function hasTransparentNeighbor(alpha, width, height, pixelIndex) {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
      if (alpha[neighborY * width + neighborX] <= 8) return true;
    }
  }
  return false;
}

function findOpaqueNeighbor(data, alpha, width, height, pixelIndex) {
  const originX = pixelIndex % width;
  const originY = Math.floor(pixelIndex / width);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const x = originX + offsetX;
        const y = originY + offsetY;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const candidate = y * width + x;
        if (alpha[candidate] < 220) continue;
        const score = alpha[candidate] * 10 - Math.hypot(offsetX, offsetY);
        if (score > bestScore) {
          bestIndex = candidate;
          bestScore = score;
        }
      }
    }
    if (bestIndex >= 0) break;
  }
  return bestIndex;
}

/**
 * Applies a chroma matte in place. Edge cleanup is opt-in so the manual tool
 * keeps its historical controls while automatic imports get halo removal.
 */
export function applyChromaPixels(
  data,
  width,
  height,
  color,
  tolerance,
  softness,
  connectedOnly,
  { cleanEdges = false } = {},
) {
  const pixelCount = width * height;
  const outerLimit = tolerance + softness;
  let connected = null;

  if (connectedOnly) {
    connected = new Uint8Array(pixelCount);
    const queued = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;
    const enqueue = (pixelIndex) => {
      if (queued[pixelIndex] || data[pixelIndex * 4 + 3] === 0) return;
      if (colorDistance(data, pixelIndex * 4, color) > outerLimit) return;
      queued[pixelIndex] = 1;
      queue[tail++] = pixelIndex;
    };
    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }
    while (head < tail) {
      const pixelIndex = queue[head++];
      connected[pixelIndex] = 1;
      const x = pixelIndex % width;
      if (x > 0) enqueue(pixelIndex - 1);
      if (x < width - 1) enqueue(pixelIndex + 1);
      if (pixelIndex >= width) enqueue(pixelIndex - width);
      if (pixelIndex < pixelCount - width) enqueue(pixelIndex + width);
    }
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (connected && !connected[pixelIndex]) continue;
    const index = pixelIndex * 4;
    const distance = colorDistance(data, index, color);
    if (distance <= tolerance) data[index + 3] = 0;
    else if (softness > 0 && distance <= outerLimit) {
      data[index + 3] = Math.round(data[index + 3] * ((distance - tolerance) / softness));
    }
  }

  if (!cleanEdges) return data;

  // Generated images often contain two or three antialiased pixels outside
  // the regular matte. Grow only through chroma-dominant pixels connected to
  // transparency, which protects legitimate muted greens inside the outfit.
  let alpha = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    alpha[pixelIndex] = data[pixelIndex * 4 + 3];
  }
  const haloLimit = outerLimit + Math.max(56, Math.round(softness * 3));
  const haloSpan = Math.max(1, haloLimit - outerLimit);
  for (let pass = 0; pass < 3; pass += 1) {
    const nextAlpha = alpha.slice();
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (alpha[pixelIndex] === 0 || !hasTransparentNeighbor(alpha, width, height, pixelIndex)) continue;
      const index = pixelIndex * 4;
      const distance = colorDistance(data, index, color);
      if (distance > haloLimit || !isChromaDominant(data, index, color)) continue;
      const haloAlpha = Math.max(0, Math.min(255, Math.round(((distance - outerLimit) / haloSpan) * 255)));
      nextAlpha[pixelIndex] = Math.min(nextAlpha[pixelIndex], haloAlpha);
    }
    alpha = nextAlpha;
  }

  const sourceColors = new Uint8ClampedArray(data);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const index = pixelIndex * 4;
    data[index + 3] = alpha[pixelIndex];
    if (alpha[pixelIndex] === 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      continue;
    }
    const edgePixel = alpha[pixelIndex] < 250 || hasTransparentNeighbor(alpha, width, height, pixelIndex);
    if (!edgePixel || !isChromaDominant(sourceColors, index, color)) continue;
    const neighbor = findOpaqueNeighbor(sourceColors, alpha, width, height, pixelIndex);
    if (neighbor >= 0) {
      const neighborIndex = neighbor * 4;
      data[index] = sourceColors[neighborIndex];
      data[index + 1] = sourceColors[neighborIndex + 1];
      data[index + 2] = sourceColors[neighborIndex + 2];
      continue;
    }
    const normalizedAlpha = Math.max(.08, alpha[pixelIndex] / 255);
    data[index] = Math.max(0, Math.min(255, Math.round((sourceColors[index] - color.r * (1 - normalizedAlpha)) / normalizedAlpha)));
    data[index + 1] = Math.max(0, Math.min(255, Math.round((sourceColors[index + 1] - color.g * (1 - normalizedAlpha)) / normalizedAlpha)));
    data[index + 2] = Math.max(0, Math.min(255, Math.round((sourceColors[index + 2] - color.b * (1 - normalizedAlpha)) / normalizedAlpha)));
  }
  return data;
}
