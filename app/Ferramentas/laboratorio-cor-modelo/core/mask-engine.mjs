const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function srgbToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(clamp(channel, 0, 1) * 255);
}

export function rgbToOklab(red, green, blue) {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabToRgb(lab) {
  const lRoot = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const mRoot = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const sRoot = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function colorDistance(left, right) {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}

export function emptyMask(width, height) {
  return new Uint8ClampedArray(Math.max(0, width * height));
}

export function maskBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    count += 1;
  }
  return count ? { minX, minY, maxX, maxY, count } : null;
}

export function subjectBounds(image, options = {}) {
  const { data, width, height } = image;
  if (!data || width < 1 || height < 1) return null;
  const cornerOffsets = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
  const background = cornerOffsets.map((offset) => rgbToOklab(data[offset], data[offset + 1], data[offset + 2]));
  const alphaMinimum = options.minimumAlpha ?? 12;
  const backgroundTolerance = options.backgroundTolerance ?? 0.09;
  const step = Math.max(1, options.step ?? 2);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < alphaMinimum) continue;
      const color = rgbToOklab(data[offset], data[offset + 1], data[offset + 2]);
      const isBackground = data[offset + 3] === 255
        && background.some((sample) => colorDistance(color, sample) <= backgroundTolerance);
      if (isBackground) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }
  return count ? { minX, minY, maxX, maxY, count: count * step * step } : null;
}

export function selectConnectedColor(image, seedX, seedY, options = {}) {
  const { data, width, height } = image;
  const x0 = clamp(Math.round(seedX), 0, width - 1);
  const y0 = clamp(Math.round(seedY), 0, height - 1);
  const seedOffset = (y0 * width + x0) * 4;
  const seedAlpha = data[seedOffset + 3];
  if (seedAlpha < (options.minimumAlpha ?? 12)) return emptyMask(width, height);

  const tolerance = clamp(options.tolerance ?? 0.075, 0.005, 0.35);
  const localTolerance = tolerance * 0.42;
  const maximumDistance = Math.max(2, options.maximumDistance ?? Math.round(Math.min(width, height) * 0.12));
  const seedColor = rgbToOklab(data[seedOffset], data[seedOffset + 1], data[seedOffset + 2]);
  const accepted = emptyMask(width, height);
  const visited = new Uint8Array(width * height);
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queueX[tail] = x0;
  queueY[tail] = y0;
  tail += 1;
  visited[y0 * width + x0] = 1;

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    const pixel = y * width + x;
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    if (alpha < (options.minimumAlpha ?? 12)) continue;
    if (Math.hypot(x - x0, y - y0) > maximumDistance) continue;

    const color = rgbToOklab(data[offset], data[offset + 1], data[offset + 2]);
    const seedDelta = colorDistance(color, seedColor);
    let localMatch = pixel === y0 * width + x0;
    if (!localMatch) {
      const neighbours = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbourPixel = ny * width + nx;
        if (!accepted[neighbourPixel]) continue;
        const neighbourOffset = neighbourPixel * 4;
        const neighbourColor = rgbToOklab(data[neighbourOffset], data[neighbourOffset + 1], data[neighbourOffset + 2]);
        if (colorDistance(color, neighbourColor) <= localTolerance) {
          localMatch = true;
          break;
        }
      }
    }
    if (seedDelta > tolerance * 1.45 || (!localMatch && seedDelta > tolerance)) continue;

    accepted[pixel] = Math.max(32, alpha);
    const neighbours = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbourPixel = ny * width + nx;
      if (visited[neighbourPixel]) continue;
      visited[neighbourPixel] = 1;
      queueX[tail] = nx;
      queueY[tail] = ny;
      tail += 1;
    }
  }
  return accepted;
}

export function mergeMask(target, addition, mode = "add") {
  const result = new Uint8ClampedArray(target);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = mode === "subtract"
      ? Math.max(0, result[index] - addition[index])
      : Math.max(result[index], addition[index]);
  }
  return result;
}

export function paintMask(mask, width, height, centerX, centerY, radius, mode = "add") {
  const result = new Uint8ClampedArray(mask);
  const safeRadius = Math.max(1, radius);
  const minX = Math.max(0, Math.floor(centerX - safeRadius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + safeRadius));
  const minY = Math.max(0, Math.floor(centerY - safeRadius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + safeRadius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (Math.hypot(x - centerX, y - centerY) > safeRadius) continue;
      result[y * width + x] = mode === "subtract" ? 0 : 255;
    }
  }
  return result;
}

export function recolorMaskedPixels(image, mask, target, strength = 1) {
  const result = new Uint8ClampedArray(image.data);
  const targetLab = rgbToOklab(target.r, target.g, target.b);
  const amount = clamp(strength, 0, 1);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) continue;
    const offset = pixel * 4;
    const sourceLab = rgbToOklab(result[offset], result[offset + 1], result[offset + 2]);
    const weight = (mask[pixel] / 255) * amount;
    const colored = oklabToRgb({
      l: sourceLab.l,
      a: sourceLab.a + (targetLab.a - sourceLab.a) * weight,
      b: sourceLab.b + (targetLab.b - sourceLab.b) * weight,
    });
    result[offset] = colored.r;
    result[offset + 1] = colored.g;
    result[offset + 2] = colored.b;
  }
  return result;
}

export function maskOverlayPixels(image, mask, color = { r: 255, g: 0, b: 170 }, opacity = 0.62) {
  const result = new Uint8ClampedArray(image.data);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) continue;
    const offset = pixel * 4;
    const weight = (mask[pixel] / 255) * opacity;
    result[offset] = Math.round(result[offset] * (1 - weight) + color.r * weight);
    result[offset + 1] = Math.round(result[offset + 1] * (1 - weight) + color.g * weight);
    result[offset + 2] = Math.round(result[offset + 2] * (1 - weight) + color.b * weight);
  }
  return result;
}
