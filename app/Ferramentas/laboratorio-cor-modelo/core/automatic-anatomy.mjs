import { emptyMask, rgbToOklab, subjectBounds } from "./mask-engine.mjs";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function delta(left, right) {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}

function pixelLab(data, pixel) {
  const offset = pixel * 4;
  return rgbToOklab(data[offset], data[offset + 1], data[offset + 2]);
}

function percentile(values, position) {
  if (!values.length) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * clamp(position, 0, 1))];
}

function estimateSkin(image, bounds) {
  const { data, width } = image;
  const headWidth = bounds.maxX - bounds.minX + 1;
  const headHeight = bounds.maxY - bounds.minY + 1;
  const samples = [];
  const left = Math.round(bounds.minX + headWidth * 0.30);
  const right = Math.round(bounds.minX + headWidth * 0.70);
  const top = Math.round(bounds.minY + headHeight * 0.18);
  const bottom = Math.round(bounds.minY + headHeight * 0.38);
  for (let y = top; y <= bottom; y += 3) {
    for (let x = left; x <= right; x += 3) {
      const pixel = y * width + x;
      if (data[pixel * 4 + 3] < 200) continue;
      const lab = pixelLab(data, pixel);
      if (lab.l > 0.45) samples.push(lab);
    }
  }
  if (!samples.length) return { l: 0.82, a: 0.03, b: 0.03 };
  return {
    l: percentile(samples.map((sample) => sample.l), 0.62),
    a: percentile(samples.map((sample) => sample.a), 0.5),
    b: percentile(samples.map((sample) => sample.b), 0.5),
  };
}

function components(binary, width, height, roi) {
  const visited = new Uint8Array(binary.length);
  const found = [];
  const queue = new Int32Array(binary.length);
  for (let y = roi.top; y <= roi.bottom; y += 1) {
    for (let x = roi.left; x <= roi.right; x += 1) {
      const start = y * width + x;
      if (!binary[start] || visited[start]) continue;
      let head = 0;
      let tail = 1;
      queue[0] = start;
      visited[start] = 1;
      const pixels = [];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (head < tail) {
        const pixel = queue[head++];
        pixels.push(pixel);
        const px = pixel % width;
        const py = Math.floor(pixel / width);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        const neighbours = [pixel - 1, pixel + 1, pixel - width, pixel + width];
        for (const neighbour of neighbours) {
          if (neighbour < 0 || neighbour >= binary.length || visited[neighbour] || !binary[neighbour]) continue;
          const nx = neighbour % width;
          const ny = Math.floor(neighbour / width);
          if (nx < roi.left || nx > roi.right || ny < roi.top || ny > roi.bottom) continue;
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          visited[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
      found.push({ pixels, minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 });
    }
  }
  return found;
}

function dilate(mask, width, height, radius = 1) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let enabled = false;
      for (let dy = -radius; dy <= radius && !enabled; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) { enabled = true; break; }
        }
      }
      if (enabled) result[y * width + x] = 1;
    }
  }
  return result;
}

function erode(mask, width, height, radius = 1) {
  const result = new Uint8Array(mask.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let enabled = true;
      for (let dy = -radius; dy <= radius && enabled; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (!mask[(y + dy) * width + x + dx]) { enabled = false; break; }
        }
      }
      if (enabled) result[y * width + x] = 1;
    }
  }
  return result;
}

function close(mask, width, height) {
  return erode(dilate(mask, width, height, 1), width, height, 1);
}

function mirroredPair(items, centerX, expectedY, headWidth, headHeight) {
  let best = null;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    const leftX = (left.minX + left.maxX) / 2;
    if (leftX >= centerX) continue;
    for (let rightIndex = 0; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      const rightX = (right.minX + right.maxX) / 2;
      if (rightX <= centerX) continue;
      const leftY = (left.minY + left.maxY) / 2;
      const rightY = (right.minY + right.maxY) / 2;
      const symmetry = Math.abs((centerX - leftX) - (rightX - centerX)) / headWidth;
      const vertical = Math.abs(leftY - rightY) / headHeight;
      const size = Math.abs(left.width - right.width) / Math.max(left.width, right.width)
        + Math.abs(left.height - right.height) / Math.max(left.height, right.height);
      const yDistance = Math.abs((leftY + rightY) / 2 - expectedY) / headHeight;
      const score = 1 - clamp(symmetry * 2.6 + vertical * 5 + size * 0.28 + yDistance * 1.2, 0, 1);
      if (!best || score > best.score) best = { left, right, score };
    }
  }
  return best;
}

function componentMask(image, selected, soften = true) {
  const mask = emptyMask(image.width, image.height);
  if (!selected) return mask;
  const selectedPixels = [...selected.left.pixels, ...selected.right.pixels];
  for (const pixel of selectedPixels) mask[pixel] = Math.max(96, image.data[pixel * 4 + 3]);
  if (!soften) return mask;
  const grown = dilate(Uint8Array.from(mask, (value) => value > 0 ? 1 : 0), image.width, image.height, 1);
  for (let pixel = 0; pixel < grown.length; pixel += 1) {
    if (grown[pixel] && !mask[pixel]) mask[pixel] = Math.min(96, image.data[pixel * 4 + 3]);
  }
  return mask;
}

function detectEyePair(image, bounds, skin) {
  const { data, width, height } = image;
  const headWidth = bounds.maxX - bounds.minX + 1;
  const headHeight = bounds.maxY - bounds.minY + 1;
  const roi = {
    left: Math.max(0, Math.round(bounds.minX + headWidth * 0.08)),
    right: Math.min(width - 1, Math.round(bounds.maxX - headWidth * 0.06)),
    top: Math.max(0, Math.round(bounds.minY + headHeight * 0.35)),
    bottom: Math.min(height - 1, Math.round(bounds.minY + headHeight * 0.68)),
  };
  const sclera = new Uint8Array(width * height);
  for (let y = roi.top; y <= roi.bottom; y += 1) {
    for (let x = roi.left; x <= roi.right; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      if (data[offset + 3] < 180) continue;
      const lab = pixelLab(data, pixel);
      const chroma = Math.hypot(lab.a, lab.b);
      if (lab.l > Math.max(0.70, skin.l - 0.11) && chroma < 0.075 && delta(lab, skin) > 0.018) sclera[pixel] = 1;
    }
  }
  const merged = close(sclera, width, height);
  const candidates = components(merged, width, height, roi).filter((item) =>
    item.width >= headWidth * 0.06 && item.width <= headWidth * 0.34
    && item.height >= headHeight * 0.012 && item.height <= headHeight * 0.13
    && item.width / item.height >= 1.05);
  return mirroredPair(candidates, (bounds.minX + bounds.maxX) / 2, bounds.minY + headHeight * 0.52, headWidth, headHeight);
}

function detectPupils(image, bounds, skin, eyes) {
  if (!eyes) return { mask: emptyMask(image.width, image.height), confidence: 0, pair: null };
  const { data, width, height } = image;
  const headWidth = bounds.maxX - bounds.minX + 1;
  const headHeight = bounds.maxY - bounds.minY + 1;
  const binary = new Uint8Array(width * height);
  const eyeBoxes = [eyes.left, eyes.right].map((eye) => ({
    left: Math.max(0, eye.minX - Math.round(headWidth * 0.03)),
    right: Math.min(width - 1, eye.maxX + Math.round(headWidth * 0.03)),
    top: Math.max(0, eye.minY - Math.round(headHeight * 0.025)),
    bottom: Math.min(height - 1, eye.maxY + Math.round(headHeight * 0.04)),
  }));
  const pupilComponents = [];
  for (const roi of eyeBoxes) {
    for (let y = roi.top; y <= roi.bottom; y += 1) {
      for (let x = roi.left; x <= roi.right; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        if (data[offset + 3] < 80) continue;
        const lab = pixelLab(data, pixel);
        const chroma = Math.hypot(lab.a, lab.b);
        const skinDistance = delta(lab, skin);
        if ((chroma > 0.045 && skinDistance > 0.055) || (lab.l < skin.l - 0.30 && skinDistance > 0.22)) binary[pixel] = 1;
      }
    }
    const items = components(close(binary, width, height), width, height, roi).filter((item) =>
      item.width >= 2 && item.height >= 2
      && item.width <= headWidth * 0.16 && item.height <= headHeight * 0.11
      && item.width / item.height < 2.4);
    const eyeCenterX = (roi.left + roi.right) / 2;
    const eyeCenterY = (roi.top + roi.bottom) / 2;
    items.sort((a, b) => {
      const score = (item) => Math.abs((item.minX + item.maxX) / 2 - eyeCenterX) / headWidth
        + Math.abs((item.minY + item.maxY) / 2 - eyeCenterY) / headHeight
        - item.pixels.length / (headWidth * headHeight) * 2;
      return score(a) - score(b);
    });
    if (items[0]) pupilComponents.push(items[0]);
  }
  if (pupilComponents.length !== 2) return { mask: emptyMask(width, height), confidence: 0.15, pair: null };
  const pair = { left: pupilComponents[0], right: pupilComponents[1], score: eyes.score };
  return { mask: componentMask(image, pair), confidence: clamp(0.42 + eyes.score * 0.5, 0, 0.96), pair };
}

function detectBrows(image, bounds, skin, eyes) {
  const { data, width, height } = image;
  const headWidth = bounds.maxX - bounds.minX + 1;
  const headHeight = bounds.maxY - bounds.minY + 1;
  const eyeY = eyes ? Math.min(eyes.left.minY, eyes.right.minY) : Math.round(bounds.minY + headHeight * 0.52);
  const roi = {
    left: Math.max(0, Math.round(bounds.minX + headWidth * 0.10)),
    right: Math.min(width - 1, Math.round(bounds.maxX - headWidth * 0.07)),
    top: Math.max(0, Math.round(bounds.minY + headHeight * 0.27)),
    bottom: Math.min(height - 1, eyeY - Math.max(2, Math.round(headHeight * 0.018))),
  };
  if (roi.bottom <= roi.top) return { mask: emptyMask(width, height), confidence: 0, pair: null };
  const binary = new Uint8Array(width * height);
  for (let y = roi.top; y <= roi.bottom; y += 1) {
    for (let x = roi.left; x <= roi.right; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      if (data[offset + 3] < 100) continue;
      const lab = pixelLab(data, pixel);
      if (delta(lab, skin) > 0.055 && lab.l < skin.l - 0.035) binary[pixel] = 1;
    }
  }
  const candidates = components(close(binary, width, height), width, height, roi).filter((item) =>
    item.width >= headWidth * 0.045 && item.width <= headWidth * 0.34
    && item.height >= 1 && item.height <= headHeight * 0.075
    && item.width / Math.max(1, item.height) >= 1.45);
  const pair = mirroredPair(candidates, (bounds.minX + bounds.maxX) / 2, eyeY - headHeight * 0.075, headWidth, headHeight);
  return { mask: componentMask(image, pair), confidence: pair ? clamp(0.35 + pair.score * 0.58, 0, 0.95) : 0, pair };
}

export function detectColorAnatomy(image) {
  const bounds = subjectBounds(image, { step: 1, minimumAlpha: 10, backgroundTolerance: 0.075 });
  if (!bounds) return {
    pupils: emptyMask(image.width, image.height), brows: emptyMask(image.width, image.height),
    confidence: { pupils: 0, brows: 0 }, warnings: ["Nenhum rosto transparente foi encontrado."], diagnostics: null,
  };
  const skin = estimateSkin(image, bounds);
  const eyes = detectEyePair(image, bounds, skin);
  const pupils = detectPupils(image, bounds, skin, eyes);
  const brows = detectBrows(image, bounds, skin, eyes);
  const warnings = [];
  if (!eyes) warnings.push("Os dois olhos não foram localizados com segurança.");
  if (pupils.confidence < 0.55) warnings.push("Pupilas precisam de revisão manual.");
  if (brows.confidence < 0.55) warnings.push("Sobrancelhas precisam de revisão manual.");
  return {
    pupils: pupils.mask,
    brows: brows.mask,
    confidence: { pupils: pupils.confidence, brows: brows.confidence },
    warnings,
    diagnostics: { bounds, skin, eyes, pupilPair: pupils.pair, browPair: brows.pair },
  };
}
