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

function foregroundClassifier(image) {
  const { data, width, height } = image;
  const offsets = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
  const backgrounds = offsets.map((offset) => rgbToOklab(data[offset], data[offset + 1], data[offset + 2]));
  return (pixel) => {
    const offset = pixel * 4;
    if (data[offset + 3] < 10) return false;
    if (data[offset + 3] < 250) return true;
    const lab = pixelLab(data, pixel);
    return !backgrounds.some((background) => delta(lab, background) <= 0.075);
  };
}

export function headBounds(image) {
  const subject = subjectBounds(image, { step: 1, minimumAlpha: 10, backgroundTolerance: 0.075 });
  if (!subject) return null;
  const { width, height } = image;
  const isForeground = foregroundClassifier(image);
  const subjectHeight = subject.maxY - subject.minY + 1;
  const scanBottom = Math.min(subject.maxY, Math.round(subject.minY + subjectHeight * 0.55), subject.minY + 520);
  const rows = [];
  let trackedCenter = (subject.minX + subject.maxX) / 2;
  for (let y = subject.minY; y <= scanBottom; y += 1) {
    const spans = [];
    let start = -1;
    for (let x = subject.minX; x <= subject.maxX; x += 1) {
      const foreground = isForeground(y * width + x);
      if (foreground && start < 0) start = x;
      if ((!foreground || x === subject.maxX) && start >= 0) {
        const end = foreground && x === subject.maxX ? x : x - 1;
        if (end - start >= 2) spans.push({ left: start, right: end, width: end - start + 1, center: (start + end) / 2 });
        start = -1;
      }
    }
    const span = spans.toSorted((left, right) =>
      (Math.abs(left.center - trackedCenter) - left.width * 0.12) - (Math.abs(right.center - trackedCenter) - right.width * 0.12))[0];
    if (span) {
      trackedCenter = trackedCenter * 0.82 + span.center * 0.18;
      rows.push({ y, ...span });
    }
  }
  if (!rows.length) return subject;
  const warmupEnd = subject.minY + Math.min(subjectHeight * 0.32, 300);
  const widest = rows.filter((row) => row.y <= warmupEnd).reduce((best, row) => row.width > best.width ? row : best, rows[0]);
  // Sprites novos já contêm somente cabeça e pescoço. Só procuramos a constrição
  // quando a silhueta é alta o bastante para ser um corpo inteiro; isso evita
  // confundir a lateral inclinada do rosto com o pescoço.
  if (subjectHeight <= widest.width * 1.8) return subject;
  const peakIndex = rows.indexOf(widest);
  let neckIndex = -1;
  for (let index = peakIndex + 1; index < rows.length - 3; index += 1) {
    const sample = rows.slice(index, index + 4);
    if (rows[index].y >= subject.minY + widest.width * 0.72
      && sample.every((row) => row.width <= widest.width * 0.62)) { neckIndex = index; break; }
  }
  const bottom = neckIndex >= 0 ? rows[neckIndex].y + 2 : Math.min(subject.maxY, scanBottom);
  let minX = width;
  let maxX = -1;
  for (const row of rows) {
    if (row.y > bottom) break;
    minX = Math.min(minX, row.left);
    maxX = Math.max(maxX, row.right);
  }
  return minX <= maxX ? { minX, minY: subject.minY, maxX, maxY: Math.min(height - 1, bottom), count: 0 } : subject;
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

function colorComponents(image, binary, roi, localTolerance = 0.032) {
  const { data, width } = image;
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
      let sumL = 0;
      let sumA = 0;
      let sumB = 0;
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
        const currentColor = pixelLab(data, pixel);
        sumL += currentColor.l;
        sumA += currentColor.a;
        sumB += currentColor.b;
        for (const neighbour of [pixel - 1, pixel + 1, pixel - width, pixel + width]) {
          if (neighbour < 0 || neighbour >= binary.length || visited[neighbour] || !binary[neighbour]) continue;
          const nx = neighbour % width;
          const ny = Math.floor(neighbour / width);
          if (nx < roi.left || nx > roi.right || ny < roi.top || ny > roi.bottom) continue;
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1 || delta(currentColor, pixelLab(data, neighbour)) > localTolerance) continue;
          visited[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
      found.push({
        pixels, minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1,
        lab: { l: sumL / pixels.length, a: sumA / pixels.length, b: sumB / pixels.length },
      });
    }
  }
  return found;
}

function featurePair(items, expectedY, headWidth, headHeight) {
  let best = null;
  for (let firstIndex = 0; firstIndex < items.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < items.length; secondIndex += 1) {
      const ordered = [(items[firstIndex]), (items[secondIndex])].toSorted((a, b) => a.minX - b.minX);
      const [left, right] = ordered;
      const leftX = (left.minX + left.maxX) / 2;
      const rightX = (right.minX + right.maxX) / 2;
      const separation = (rightX - leftX) / headWidth;
      if (separation < 0.28 || separation > 0.62) continue;
      const leftY = (left.minY + left.maxY) / 2;
      const rightY = (right.minY + right.maxY) / 2;
      const vertical = Math.abs(leftY - rightY) / headHeight;
      const size = Math.abs(left.width - right.width) / Math.max(left.width, right.width)
        + Math.abs(left.height - right.height) / Math.max(left.height, right.height);
      const color = left.lab && right.lab ? delta(left.lab, right.lab) : 0;
      const yDistance = Math.abs((leftY + rightY) / 2 - expectedY) / headHeight;
      const smallFeaturePenalty = clamp(18 / Math.max(1, Math.min(left.pixels.length, right.pixels.length)) - 0.18, 0, 0.38);
      const score = 1 - clamp(vertical * 5.5 + size * 0.24 + color * 1.8 + yDistance * 1.35 + smallFeaturePenalty, 0, 1);
      if (!best || score > best.score) best = { left, right, score };
    }
  }
  return best;
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
      if (centerX - leftX < headWidth * 0.08 || rightX - centerX < headWidth * 0.08) continue;
      if (rightX - leftX < headWidth * 0.28) continue;
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

function expandedFeatureMask(image, selected, skin, padding = 2) {
  const mask = emptyMask(image.width, image.height);
  if (!selected) return mask;
  for (const component of [selected.left, selected.right]) {
    for (let y = Math.max(0, component.minY - padding); y <= Math.min(image.height - 1, component.maxY + padding); y += 1) {
      for (let x = Math.max(0, component.minX - padding); x <= Math.min(image.width - 1, component.maxX + padding); x += 1) {
        const pixel = y * image.width + x;
        const offset = pixel * 4;
        if (image.data[offset + 3] < 24) continue;
        const lab = pixelLab(image.data, pixel);
        if (delta(lab, skin) > 0.035 && (Math.hypot(lab.a, lab.b) > 0.022 || lab.l < skin.l - 0.16)) {
          mask[pixel] = Math.max(72, image.data[offset + 3]);
        }
      }
    }
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
  const { data, width, height } = image;
  const headWidth = bounds.maxX - bounds.minX + 1;
  const headHeight = bounds.maxY - bounds.minY + 1;
  const roi = {
    left: Math.max(0, Math.round(bounds.minX + headWidth * 0.08)),
    right: Math.min(width - 1, Math.round(bounds.maxX - headWidth * 0.05)),
    top: Math.max(0, Math.round(bounds.minY + headHeight * 0.39)),
    bottom: Math.min(height - 1, Math.round(bounds.minY + headHeight * 0.68)),
  };
  const candidatesFor = (mode) => {
    const binary = new Uint8Array(width * height);
    for (let y = roi.top; y <= roi.bottom; y += 1) {
      for (let x = roi.left; x <= roi.right; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        if (data[offset + 3] < 70) continue;
        const lab = pixelLab(data, pixel);
        const chroma = Math.hypot(lab.a, lab.b);
        const skinDistance = delta(lab, skin);
        const accepted = mode === "chroma"
          ? chroma > 0.048 && skinDistance > 0.07
          : lab.l < skin.l - 0.34 && skinDistance > 0.27;
        if (accepted) binary[pixel] = 1;
      }
    }
    return colorComponents(image, binary, roi, mode === "chroma" ? 0.052 : 0.025).filter((item) =>
      item.width >= Math.max(3, headWidth * 0.022) && item.height >= Math.max(3, headHeight * 0.014)
      && item.width <= headWidth * 0.15 && item.height <= headHeight * 0.12
      && item.width / item.height <= 1.9 && item.height / item.width <= 2.8);
  };
  let pair = featurePair(candidatesFor("chroma"), bounds.minY + headHeight * 0.60, headWidth, headHeight);
  if (!pair || pair.score < 0.26) pair = featurePair(candidatesFor("dark"), bounds.minY + headHeight * 0.60, headWidth, headHeight);
  if (!pair || pair.score < 0.26) return { mask: emptyMask(width, height), confidence: 0.12, pair: null };
  const eyeBonus = eyes ? 0.08 : 0;
  return { mask: expandedFeatureMask(image, pair, skin, 2), confidence: clamp(0.43 + pair.score * 0.46 + eyeBonus, 0, 0.97), pair };
}

function detectBrows(image, bounds, skin, eyes) {
  const { data, width, height } = image;
  const headWidth = bounds.maxX - bounds.minX + 1;
  const headHeight = bounds.maxY - bounds.minY + 1;
  const eyeY = Math.round(bounds.minY + headHeight * 0.55);
  const roi = {
    left: Math.max(0, Math.round(bounds.minX + headWidth * 0.10)),
    right: Math.min(width - 1, Math.round(bounds.maxX - headWidth * 0.07)),
    top: Math.max(0, Math.round(bounds.minY + headHeight * 0.34)),
    bottom: Math.min(height - 1, Math.round(bounds.minY + headHeight * 0.56)),
  };
  if (roi.bottom <= roi.top) return { mask: emptyMask(width, height), confidence: 0, pair: null };
  const binary = new Uint8Array(width * height);
  for (let y = roi.top; y <= roi.bottom; y += 1) {
    for (let x = roi.left; x <= roi.right; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      if (data[offset + 3] < 100) continue;
      const lab = pixelLab(data, pixel);
      if (delta(lab, skin) > 0.038 && lab.l < skin.l - 0.025) binary[pixel] = 1;
    }
  }
  const candidates = colorComponents(image, binary, roi, 0.045).filter((item) =>
    item.width >= headWidth * 0.045 && item.width <= headWidth * 0.34
    && item.height >= 1 && item.height <= headHeight * 0.085
    && item.width / Math.max(1, item.height) >= 1.45);
  const pair = featurePair(candidates, bounds.minY + headHeight * 0.48, headWidth, headHeight);
  return { mask: pair ? expandedFeatureMask(image, pair, skin, 1) : emptyMask(width, height), confidence: pair ? clamp(0.35 + pair.score * 0.58, 0, 0.95) : 0, pair };
}

export function detectColorAnatomy(image) {
  const bounds = headBounds(image);
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
