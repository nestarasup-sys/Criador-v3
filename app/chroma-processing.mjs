const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function smoothstep(value) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function colorSignature(r, g, b) {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const sum = Math.max(1, r + g + b);
  return {
    y: .2126 * r + .7152 * g + .0722 * b,
    cb: -.114572 * r - .385428 * g + .5 * b,
    cr: .5 * r - .454153 * g - .045847 * b,
    nr: r / sum,
    ng: g / sum,
    nb: b / sum,
    saturation: maximum <= 0 ? 0 : (maximum - minimum) / maximum,
  };
}

/** Compara crominância e proporção dos canais, dando pouco peso à iluminação. */
export function chromaColorDistance(r, g, b, color) {
  const target = colorSignature(color.r, color.g, color.b);
  const sample = colorSignature(r, g, b);
  if (target.saturation < .12) {
    return Math.hypot(r - color.r, g - color.g, b - color.b) * .72;
  }
  const chromaDistance = Math.hypot(sample.cb - target.cb, sample.cr - target.cr);
  const ratioDistance = Math.hypot(
    sample.nr - target.nr,
    sample.ng - target.ng,
    sample.nb - target.nb,
  ) * 255;
  const lowColorPenalty = sample.saturation < .08
    ? (target.saturation - sample.saturation) * 70
    : Math.max(0, target.saturation - sample.saturation) * 12;
  const luminanceDistance = Math.abs(sample.y - target.y) * .035;
  return Math.min(chromaDistance, ratioDistance) * .72
    + Math.max(chromaDistance, ratioDistance) * .28
    + lowColorPenalty
    + luminanceDistance;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
}

function dominantEdgeColor(samples) {
  if (samples.length <= 1) return { color: samples[0], support: samples.length };
  const stride = Math.max(1, Math.floor(samples.length / 128));
  let best = samples[0];
  let bestSupport = 0;
  for (let candidateIndex = 0; candidateIndex < samples.length; candidateIndex += stride) {
    const candidate = samples[candidateIndex];
    const color = { r: candidate[0], g: candidate[1], b: candidate[2] };
    let support = 0;
    for (const sample of samples) {
      if (chromaColorDistance(sample[0], sample[1], sample[2], color) <= 34) support += 1;
    }
    if (support > bestSupport) {
      best = candidate;
      bestSupport = support;
    }
  }
  return { color: best, support: bestSupport };
}

/**
 * Estima o fundo pelas bordas, mas elimina amostras de roupa, pele ou cabelo
 * que encostem nelas antes de calcular tolerância e transição.
 */
export function estimateChromaKey(data, width, height, boost = 0) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 90));
  let sampleSlots = 0;
  const add = (x, y) => {
    sampleSlots += 1;
    const index = (y * width + x) * 4;
    if (data[index + 3] > 20) samples.push([data[index], data[index + 1], data[index + 2]]);
  };
  const ringStep = Math.max(1, Math.round(Math.min(width, height) * .012));
  const rings = [...new Set([0, ringStep, ringStep * 2])]
    .filter((inset) => inset * 2 < width && inset * 2 < height);
  for (const inset of rings) {
    for (let x = inset; x < width - inset; x += step) {
      add(x, inset);
      add(x, height - 1 - inset);
    }
    for (let y = inset + step; y < height - inset - step; y += step) {
      add(inset, y);
      add(width - 1 - inset, y);
    }
  }
  if (samples.length === 0) return null;

  const opaqueCoverage = samples.length / Math.max(1, sampleSlots);
  // Transparent PNGs commonly touch one edge with hair or clothing. A few
  // opaque edge pixels are not evidence that the asset still has a backdrop.
  if (opaqueCoverage < .42) return null;

  const dominant = dominantEdgeColor(samples);
  if (!dominant.color || dominant.support < Math.max(12, samples.length * .28)) return null;
  const initialColor = { r: dominant.color[0], g: dominant.color[1], b: dominant.color[2] };

  const initialDistances = samples.map(([r, g, b]) => chromaColorDistance(r, g, b, initialColor));
  const coreLimit = Math.min(68, Math.max(10, percentile(initialDistances, .7) * 2.4 + 4));
  const backgroundSamples = samples.filter((_, index) => initialDistances[index] <= coreLimit);
  if (backgroundSamples.length < Math.max(12, samples.length * .28)) return null;

  const color = {
    r: Math.round(percentile(backgroundSamples.map((sample) => sample[0]), .5)),
    g: Math.round(percentile(backgroundSamples.map((sample) => sample[1]), .5)),
    b: Math.round(percentile(backgroundSamples.map((sample) => sample[2]), .5)),
  };
  const distances = backgroundSamples.map(([r, g, b]) => chromaColorDistance(r, g, b, color));
  const tolerance = clamp(Math.round(Math.max(16, percentile(distances, .78) + 5) + boost * .25), 16, 64);
  const softness = clamp(Math.round(Math.max(20, percentile(distances, .98) - percentile(distances, .5) + 16) + boost * .45), 20, 72);
  return {
    color,
    tolerance,
    softness,
    confidence: backgroundSamples.length / samples.length * opaqueCoverage,
  };
}

function buildKeyMatte(data, width, height, color, tolerance, softness) {
  const pixelCount = width * height;
  const matte = new Float32Array(pixelCount);
  const outerLimit = Math.max(tolerance + softness, tolerance + .001);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const index = pixelIndex * 4;
    if (data[index + 3] === 0) {
      matte[pixelIndex] = 1;
      continue;
    }
    const distance = chromaColorDistance(data[index], data[index + 1], data[index + 2], color);
    if (distance <= tolerance) matte[pixelIndex] = 1;
    else if (distance < outerLimit) matte[pixelIndex] = 1 - smoothstep((distance - tolerance) / Math.max(.001, softness));
  }
  return matte;
}

function restrictToBorderConnected(matte, data, width, height) {
  const pixelCount = width * height;
  const connected = new Float32Array(pixelCount);
  const queued = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const enqueue = (pixelIndex) => {
    if (queued[pixelIndex] || data[pixelIndex * 4 + 3] === 0 || matte[pixelIndex] <= .015) return;
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
    connected[pixelIndex] = matte[pixelIndex];
    const x = pixelIndex % width;
    if (x > 0) enqueue(pixelIndex - 1);
    if (x < width - 1) enqueue(pixelIndex + 1);
    if (pixelIndex >= width) enqueue(pixelIndex - width);
    if (pixelIndex < pixelCount - width) enqueue(pixelIndex + width);
  }
  return connected;
}

function cleanResiduals(matte, width, height) {
  if (width < 3 || height < 3) return matte;
  let current = matte;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const pixelIndex = y * width + x;
        let keyedNeighbors = 0;
        let transparentWeight = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const value = current[(y + offsetY) * width + x + offsetX];
            if (value > .55) keyedNeighbors += 1;
            transparentWeight += value;
          }
        }
        if (current[pixelIndex] > .02 && current[pixelIndex] < .22 && keyedNeighbors >= 7) {
          next[pixelIndex] = Math.max(current[pixelIndex], transparentWeight / 8);
        }
      }
    }
    current = next;
  }
  return current;
}

function slidingExtrema(source, width, height, radius, useMaximum, horizontal) {
  const output = new Float32Array(source.length);
  const lineLength = horizontal ? width : height;
  const lineCount = horizontal ? height : width;
  const indices = new Int32Array(lineLength);
  for (let line = 0; line < lineCount; line += 1) {
    let head = 0;
    let tail = 0;
    const valueAt = (position) => source[horizontal ? line * width + position : position * width + line];
    const writeAt = (position, value) => {
      output[horizontal ? line * width + position : position * width + line] = value;
    };
    for (let position = 0; position < lineLength + radius; position += 1) {
      const incoming = position + radius;
      if (incoming < lineLength) {
        const incomingValue = valueAt(incoming);
        while (tail > head) {
          const previousValue = valueAt(indices[tail - 1]);
          if (useMaximum ? previousValue > incomingValue : previousValue < incomingValue) break;
          tail -= 1;
        }
        indices[tail++] = incoming;
      }
      const outgoing = position - radius;
      while (tail > head && indices[head] < outgoing) head += 1;
      if (position < lineLength && tail > head) writeAt(position, valueAt(indices[head]));
    }
  }
  return output;
}

function adjustMatte(matte, width, height, amount) {
  const radius = Math.min(8, Math.round(Math.abs(amount)));
  if (radius === 0) return matte;
  const expandTransparency = amount > 0;
  return slidingExtrema(
    slidingExtrema(matte, width, height, radius, expandTransparency, true),
    width,
    height,
    radius,
    expandTransparency,
    false,
  );
}

function boxBlur(source, width, height, radius) {
  const safeRadius = Math.min(10, Math.round(radius));
  if (safeRadius <= 0) return source;
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -safeRadius; x <= safeRadius; x += 1) sum += source[y * width + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (safeRadius * 2 + 1);
      sum += source[y * width + clamp(x + safeRadius + 1, 0, width - 1)]
        - source[y * width + clamp(x - safeRadius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -safeRadius; y <= safeRadius; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / (safeRadius * 2 + 1);
      sum += horizontal[clamp(y + safeRadius + 1, 0, height - 1) * width + x]
        - horizontal[clamp(y - safeRadius, 0, height - 1) * width + x];
    }
  }
  return output;
}

function hasKeyedNeighbor(matte, width, height, pixelIndex) {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
      if (matte[neighborY * width + neighborX] > .92) return true;
    }
  }
  return false;
}

function applyDespill(data, source, matte, width, height, color, despill) {
  const strength = clamp(despill, 0, 100) / 100;
  if (strength <= 0) return;
  const average = (color.r + color.g + color.b) / 3;
  const vector = [color.r - average, color.g - average, color.b - average];
  const length = Math.hypot(...vector);
  if (length < 12) return;
  const unit = vector.map((value) => value / length);
  for (let pixelIndex = 0; pixelIndex < matte.length; pixelIndex += 1) {
    const index = pixelIndex * 4;
    if (data[index + 3] === 0) continue;
    const neighborKeyed = hasKeyedNeighbor(matte, width, height, pixelIndex);
    if (matte[pixelIndex] <= .015) continue;
    const pixelAverage = (source[index] + source[index + 1] + source[index + 2]) / 3;
    const projection = (source[index] - pixelAverage) * unit[0]
      + (source[index + 1] - pixelAverage) * unit[1]
      + (source[index + 2] - pixelAverage) * unit[2];
    if (projection <= 0) continue;
    const edgeWeight = clamp(matte[pixelIndex] * 1.4 + (neighborKeyed ? .45 : 0), 0, 1);
    const correction = projection * strength * edgeWeight;
    data[index] = clamp(Math.round(source[index] - unit[0] * correction), 0, 255);
    data[index + 1] = clamp(Math.round(source[index + 1] - unit[1] * correction), 0, 255);
    data[index + 2] = clamp(Math.round(source[index + 2] - unit[2] * correction), 0, 255);
  }
}

/** Aplica o matte em toda a imagem; conexão às bordas é uma proteção opcional. */
export function applyChromaPixels(
  data,
  width,
  height,
  color,
  tolerance,
  softness,
  connectedOnly = false,
  options = {},
) {
  const normalizedOptions = typeof options === "boolean" ? { cleanEdges: options } : options;
  const {
    cleanEdges = false,
    maskAdjustment = 0,
    feather = 0,
    despill = cleanEdges ? 72 : 0,
    intensity = 100,
  } = normalizedOptions;
  const source = new Uint8ClampedArray(data);
  let matte = buildKeyMatte(source, width, height, color, Math.max(0, tolerance), Math.max(0, softness));
  if (connectedOnly) matte = restrictToBorderConnected(matte, source, width, height);
  if (cleanEdges) matte = cleanResiduals(matte, width, height);
  matte = adjustMatte(matte, width, height, clamp(maskAdjustment, -8, 8));
  matte = boxBlur(matte, width, height, clamp(feather, 0, 10));

  const keyStrength = clamp(intensity, 0, 100) / 100;
  for (let pixelIndex = 0; pixelIndex < matte.length; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const keyAmount = clamp(matte[pixelIndex] * keyStrength, 0, 1);
    data[index + 3] = Math.round(source[index + 3] * (1 - keyAmount));
    if (data[index + 3] === 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
    }
  }
  applyDespill(data, source, matte, width, height, color, despill);
  return data;
}
