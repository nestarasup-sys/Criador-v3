const DEFAULT_COLOR_ADJUSTMENT = {
  hue: 0,
  saturation: 100,
  brightness: 100,
  enabled: true,
  tint: "#ffffff",
  tintStrength: 0,
  contrast: 100,
  detailPreservation: 78,
};

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));

function normalizeAdjustment(value) {
  return {
    hue: clamp(value?.hue, 0, 360, 0),
    saturation: clamp(value?.saturation, 0, 250, 100),
    brightness: clamp(value?.brightness, 0, 250, 100),
    enabled: value?.enabled !== false,
    tint: typeof value?.tint === "string" && /^#[0-9a-f]{6}$/i.test(value.tint) ? value.tint : "#ffffff",
    tintStrength: clamp(value?.tintStrength, 0, 100, 0),
    contrast: clamp(value?.contrast, 0, 250, 100),
    detailPreservation: clamp(value?.detailPreservation, 0, 100, 78),
  };
}

export const DEFAULT_MODEL_COLOR_SCOPE = "pupilsBrows";

export function emptyModelColorAdjustments() {
  return {
    pupils: { ...DEFAULT_COLOR_ADJUSTMENT },
    pupilsBrows: { ...DEFAULT_COLOR_ADJUSTMENT },
    skin: { ...DEFAULT_COLOR_ADJUSTMENT },
    brows: { ...DEFAULT_COLOR_ADJUSTMENT },
  };
}

export function normalizeModelColorScope(value) {
  if (value === "pupils" || value === "pupilsBrows" || value === "skin" || value === "brows") return value;
  // Compatibilidade com personagens salvos antes da separação semântica.
  if (value === "details") return "pupilsBrows";
  if (value === "all") return "brows";
  return DEFAULT_MODEL_COLOR_SCOPE;
}

export function normalizeModelColorAdjustments(value) {
  const defaults = emptyModelColorAdjustments();
  defaults.pupils = normalizeAdjustment(value?.pupils);
  defaults.pupilsBrows = normalizeAdjustment(value?.pupilsBrows ?? value?.details);
  defaults.skin = normalizeAdjustment(value?.skin);
  defaults.brows = normalizeAdjustment(value?.brows ?? value?.all);
  return defaults;
}

/**
 * A base antiga pode ser uma figura inteira, enquanto os packs mais novos
 * trazem somente cabeça e pescoço. Para pupilas/sobrancelhas, usar o bounding
 * box da figura inteira transforma as coordenadas relativas em lixo. Esta
 * medida encontra a queda sustentada da largura da cabeça para o pescoço e
 * devolve um ROI facial independente do corpo.
 */
export function inferModelFaceBounds(data, width, height, visibleBounds) {
  const spanY = Math.max(1, visibleBounds.maxY - visibleBounds.minY);
  const rows = [];
  for (let y = visibleBounds.minY; y <= visibleBounds.maxY; y += 1) {
    let minX = width;
    let maxX = -1;
    for (let x = visibleBounds.minX; x <= visibleBounds.maxX; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    rows.push({ y, width: maxX >= minX ? maxX - minX + 1 : 0, minX, maxX });
  }
  // Do not use the widest row of the whole figure: shoulders and clothes are
  // often wider than the head and would make the facial ROI include the body.
  // The head is the first broad region after the top transparent margin.
  const headSearchEnd = Math.max(0, Math.min(rows.length - 1, Math.ceil(spanY * 0.30)));
  const headRows = rows.slice(Math.ceil(rows.length * 0.04), headSearchEnd + 1).filter((row) => row.width > 0);
  const widest = headRows.reduce((best, row) => row.width > best.width ? row : best, { y: visibleBounds.minY, width: 0 });
  const narrowThreshold = widest.width * 0.58;
  const sustainedRows = Math.max(5, Math.round(spanY * 0.015));
  let narrowStart = -1;
  let narrowCount = 0;
  for (const row of rows) {
    if (row.y < widest.y + spanY * 0.05) continue;
    // A head-only sprite may place the neck near its bottom edge. A full
    // figure is still bounded by the first neck valley, so scanning farther
    // is safe and avoids falling back to the entire image.
    if (row.y > visibleBounds.minY + spanY * 0.92) break;
    if (row.width > 0 && row.width <= narrowThreshold) {
      narrowStart = narrowStart < 0 ? row.y : narrowStart;
      narrowCount += 1;
      if (narrowCount >= sustainedRows) break;
    } else {
      narrowStart = -1;
      narrowCount = 0;
    }
  }
  const likelyFullFigure = spanY > Math.max(1, visibleBounds.maxX - visibleBounds.minX) * 1.65;
  const faceMaxY = narrowCount >= sustainedRows
    ? narrowStart
    : likelyFullFigure
      ? Math.floor(visibleBounds.minY + spanY * 0.42)
      : visibleBounds.maxY;
  const faceRows = rows.filter((row) => row.y <= faceMaxY && row.width > 0);
  return {
    // Start reductions outside the visible bounds. Seeding with the full
    // figure bounds keeps a shoulder/foot outlier in the facial ROI even when
    // the row scan has already found the neck correctly.
    minX: faceRows.reduce((value, row) => Math.min(value, row.minX), width),
    minY: visibleBounds.minY,
    maxX: faceRows.reduce((value, row) => Math.max(value, row.maxX), -1),
    maxY: Math.max(visibleBounds.minY + 1, faceMaxY),
  };
}

function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    hue = max === r
      ? ((g - b) / delta + (g < b ? 6 : 0))
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
    hue *= 60;
  }
  return { hue, saturation: max <= 0 ? 0 : delta / max, value: max };
}

function relativeFacePosition(position) {
  if (!position?.bounds) return null;
  const { minX, minY, maxX, maxY } = position.bounds;
  return {
    x: (position.x - minX) / Math.max(1, maxX - minX),
    y: (position.y - minY) / Math.max(1, maxY - minY),
  };
}

function isLightWarmWash(red, green, blue, saturation, value) {
  // Skin in the imported model packs is often almost white (for example
  // 255/226/212), so the old 15% red margin classified the whole face as a
  // pigment region. Keep this conservative: pale warm pixels are skin/wash;
  // saturated eyes and dark brows remain eligible.
  return value >= 0.65 && red >= green * 1.08 && red >= blue * 1.03 && saturation <= 0.38;
}

function eyeCenters(position) {
  return position?.eyeLanes?.length ? position.eyeLanes : [0.49, 0.86];
}

function isInsideEyeCore(relative, eyeX) {
  const dx = (relative.x - eyeX) / 0.09;
  const dy = (relative.y - 0.56) / 0.085;
  return (dx * dx) + (dy * dy) <= 1;
}

function isInsideBrowBand(relative, eyeX) {
  const dx = (relative.x - eyeX) / 0.18;
  const dy = (relative.y - 0.425) / 0.065;
  return (dx * dx) + (dy * dy) <= 1;
}

function hasPigment(red, green, blue) {
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  // Dark strokes are valid eyebrows, while pale skin and eye whites are not.
  return (saturation >= 0.12 && value >= 0.06) || value <= 0.38;
}

function isModelBrow(red, green, blue, alpha, position) {
  if (alpha <= 8 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  if (!relative || relative.x < 0.16 || relative.x > 0.98 || relative.y < 0.29 || relative.y > 0.52) return false;
  if (eyeCenters(position).some((eyeX) => isInsideEyeCore(relative, eyeX))) return false;
  if (!eyeCenters(position).some((eyeX) => isInsideBrowBand(relative, eyeX))) return false;
  return hasPigment(red, green, blue);
}

function isLegacyModelDetail(red, green, blue, alpha, position) {
  if (alpha <= 8) return false;
  if (!position?.bounds) return false;
  const { minX, minY, maxX, maxY } = position.bounds;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const relativeX = (position.x - minX) / spanX;
  const relativeY = (position.y - minY) / spanY;
  if (relativeX < 0.12 || relativeX > 0.88 || relativeY < 0.24 || relativeY > 0.63) return false;
  const { saturation, value } = rgbToHsv(red, green, blue);
  const channels = [red, green, blue].sort((left, right) => right - left);
  const dominantRatio = channels[0] / Math.max(1, channels[1]);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  if (saturation >= 0.12 && value >= 0.06 && dominantRatio >= 1.32) return true;
  return value <= 0.38;
}

/**
 * Finds the most likely colored eye-pigment lanes in the actual decoded head.
 * Fixed coordinates remain only as a conservative fallback for monochrome
 * models. This keeps a new model with a different head width from inheriting
 * the coordinates of an older model.
 */
export function inferModelEyeLanes(data, width, height, bounds) {
  const colorAnchors = inferColorEyeAnchors(data, width, height, bounds);
  if (colorAnchors.every((anchor) => anchor !== null)) {
    return colorAnchors.map((anchor) => (anchor.centerX - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX));
  }
  return inferScanlineEyeLanes(data, width, height, bounds);
}

function isEyePigmentPixel(red, green, blue, alpha) {
  if (alpha < 128) return false;
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  // Low-saturation warm pixels are skin/blush. Keep saturated red irises
  // eligible, while still rejecting the warm neutral face fill.
  if (isSkinTone(red, green, blue, alpha) && saturation < 0.42) return false;
  return saturation >= 0.18 && value >= 0.12;
}

function inferColorEyeAnchors(data, width, height, bounds) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const minY = Math.max(0, Math.floor(bounds.minY + spanY * 0.53));
  const maxY = Math.min(height - 1, Math.ceil(bounds.minY + spanY * 0.8));
  const seeds = [0.47, 0.84];
  return seeds.map((seed) => {
    const seedX = bounds.minX + seed * spanX;
    const minX = Math.max(0, Math.floor(seedX - spanX * 0.2));
    const maxX = Math.min(width - 1, Math.ceil(seedX + spanX * 0.2));
    let weightTotal = 0;
    let weightedX = 0;
    let weightedY = 0;
    for (let y = minY; y <= maxY; y += 1) {
      const verticalProgress = (y - minY) / Math.max(1, maxY - minY);
      const verticalWeight = Math.max(0.08, verticalProgress) ** 2;
      for (let x = minX; x <= maxX; x += 1) {
        const offset = (y * width + x) * 4;
        const { saturation, value } = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
        const colored = isEyePigmentPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
        const darkCore = data[offset + 3] >= 128 && !isLightWarmWash(data[offset], data[offset + 1], data[offset + 2], saturation, value) && value <= 0.26;
        if (!colored && !darkCore) continue;
        const colorWeight = colored
          ? Math.max(0.04, saturation) ** 2 * (0.5 + value)
          : (0.3 + (1 - value) * 0.35);
        const weight = colorWeight * verticalWeight;
        weightTotal += weight;
        weightedX += x * weight;
        weightedY += y * weight;
      }
    }
    if (weightTotal < Math.max(6, spanX * 0.04)) return null;
    return { centerX: weightedX / weightTotal, centerY: weightedY / weightTotal };
  });
}

function inferScanlineEyeLanes(data, width, height, bounds) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const minY = Math.max(0, Math.floor(bounds.minY + spanY * 0.4));
  const maxY = Math.min(height - 1, Math.ceil(bounds.minY + spanY * 0.76));
  const minX = Math.max(0, Math.floor(bounds.minX + spanX * 0.06));
  const maxX = Math.min(width - 1, Math.ceil(bounds.maxX - spanX * 0.04));
  const minimumRun = Math.max(4, Math.round(spanX * 0.035));
  const runs = [];
  for (let y = minY; y <= maxY; y += 1) {
    let start = -1;
    for (let x = minX; x <= maxX + 1; x += 1) {
      let eyeLike = false;
      if (x <= maxX) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        const { saturation, value } = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
        const coloredPigment = saturation >= 0.22 && value >= 0.14
          && !isLightWarmWash(data[offset], data[offset + 1], data[offset + 2], saturation, value);
        eyeLike = alpha >= 160 && (coloredPigment || value <= 0.3);
      }
      if (eyeLike && start < 0) start = x;
      if ((!eyeLike || x > maxX) && start >= 0) {
        const end = x - 1;
        if (end - start + 1 >= minimumRun) {
          runs.push({ center: ((start + end + 1) / 2 - bounds.minX) / spanX, width: (end - start + 1) / spanX });
        }
        start = -1;
      }
    }
  }
  // A horizontal eye contour is wide; the head outline is usually only a few
  // pixels on a scanline. Cluster runs from adjacent scanlines to obtain one
  // stable center per eye instead of choosing a highlight or a cheek edge.
  const clusters = [];
  for (const run of runs.sort((left, right) => left.center - right.center)) {
    const cluster = clusters.at(-1);
    if (cluster && run.center - cluster.maxCenter <= 0.1) {
      cluster.runs.push(run);
      cluster.maxCenter = Math.max(cluster.maxCenter, run.center);
      cluster.minCenter = Math.min(cluster.minCenter, run.center);
    } else {
      clusters.push({ runs: [run], minCenter: run.center, maxCenter: run.center });
    }
  }
  const candidates = clusters.map((cluster) => {
    const score = cluster.runs.reduce((total, run) => total + run.width, 0);
    const center = cluster.runs.reduce((total, run) => total + run.center * run.width, 0) / Math.max(1, score);
    return { center, score, width: cluster.runs.reduce((max, run) => Math.max(max, run.width), 0) };
  }).filter((candidate) => candidate.center >= 0.12 && candidate.center <= 0.94 && candidate.score >= minimumRun / spanX * 2);
  const pairs = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const separation = Math.abs(candidates[left].center - candidates[right].center);
      if (separation < 0.2 || separation > 0.72) continue;
      pairs.push({ left: candidates[left], right: candidates[right], score: candidates[left].score + candidates[right].score - Math.abs(separation - 0.38) * 0.12 });
    }
  }
  const bestPair = pairs.sort((left, right) => right.score - left.score)[0];
  const selected = bestPair ? [bestPair.left, bestPair.right] : candidates.sort((left, right) => right.score - left.score).slice(0, 2);
  const lanes = selected.sort((left, right) => left.center - right.center).map((candidate) => candidate.center);
  return lanes.length ? lanes : [0.49, 0.86];
}

function semanticBoundsFor(scope, visibleBounds, data, width, height) {
  return scope === "skin" ? visibleBounds : inferModelFaceBounds(data, width, height, visibleBounds);
}

function pupilCandidate(red, green, blue, alpha, position) {
  if (alpha < 128 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  if (!relative || relative.x < 0.1 || relative.x > 0.99 || relative.y < 0.43 || relative.y > 0.7) return false;
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  // Saturated pigment catches colored irises. The dark branch keeps models
  // with gray/black pupils supported without admitting the pale eye white.
  return (saturation >= 0.22 && value >= 0.16 && !isSkinTone(red, green, blue, alpha)) || value <= 0.32;
}

function browCandidate(red, green, blue, alpha, position) {
  if (alpha <= 8 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  // Stop before the eye line. This prevents a brow joined to lashes by
  // antialiasing from becoming one component with the eye itself.
  if (!relative || relative.x < 0.1 || relative.x > 0.99 || relative.y < 0.25 || relative.y > 0.49) return false;
  return hasPigment(red, green, blue);
}

function collectComponents(candidate, width, height) {
  const visited = new Uint8Array(candidate.length);
  const components = [];
  for (let start = 0; start < candidate.length; start += 1) {
    if (!candidate[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (candidate[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    components.push({ pixels: queue, area, minX, minY, maxX, maxY });
  }
  return components;
}

function isEyePigment(red, green, blue) {
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  return (saturation >= 0.2 && value >= 0.12) || value <= 0.3;
}

/**
 * Derives a small region for each eye from the decoded pixels. The lane is
 * only the horizontal anchor; the vertical center is found from the strongest
 * pigment/dark-pixel band, so a tall or short head does not inherit a fixed
 * y-coordinate from another model.
 */
function inferModelEyeRegions(data, width, height, bounds) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const colorAnchors = inferColorEyeAnchors(data, width, height, bounds);
  const lanes = inferModelEyeLanes(data, width, height, bounds);
  return lanes.map((lane, index) => {
    const centerX = bounds.minX + lane * spanX;
    const anchor = colorAnchors[index];
    if (anchor) {
      return {
        centerX: anchor.centerX,
        centerY: anchor.centerY,
        // Keep the pupil/iris window tight. A wider ellipse catches the
        // coloured anti-aliased lashes that sit beside the iris, especially
        // on three-quarter faces.
        radiusX: Math.max(5, spanX * 0.09),
        radiusY: Math.max(5, spanY * 0.085),
      };
    }
    const radiusX = Math.max(5, spanX * 0.12);
    const minY = Math.max(bounds.minY, Math.floor(bounds.minY + spanY * 0.43));
    const maxY = Math.min(bounds.maxY, Math.ceil(bounds.minY + spanY * 0.72));
    const rowScores = [];
    for (let y = minY; y <= maxY; y += 1) {
      let score = 0;
      for (let x = Math.max(bounds.minX, Math.floor(centerX - radiusX)); x <= Math.min(bounds.maxX, Math.ceil(centerX + radiusX)); x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 128) continue;
        const { saturation, value } = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
        if (isLightWarmWash(data[offset], data[offset + 1], data[offset + 2], saturation, value)) continue;
        if (saturation >= 0.2 && value >= 0.12) score += 3;
        else if (value <= 0.3) score += 1;
      }
      rowScores.push({ y, score });
    }
    const windowRadius = Math.max(2, Math.round(spanY * 0.018));
    let best = { y: Math.round(bounds.minY + spanY * 0.58), score: 0 };
    const windows = [];
    for (let index = 0; index < rowScores.length; index += 1) {
      const score = rowScores
        .slice(Math.max(0, index - windowRadius), Math.min(rowScores.length, index + windowRadius + 1))
        .reduce((total, item) => total + item.score, 0);
      windows.push({ y: rowScores[index].y, score });
      if (score > best.score) best = { y: rowScores[index].y, score };
    }
    // Eyebrows can be darker than the iris and therefore produce the first
    // histogram peak. When a second, lower peak is materially strong, it is
    // the eye line; choosing it keeps the brow pass above the eye instead of
    // treating the brow itself as the eye center.
    return { centerX, centerY: best.y, radiusX, radiusY: Math.max(5, spanY * 0.105) };
  });
}

function buildPupilMask(data, width, height, bounds) {
  const mask = new Uint8Array(width * height);
  const regions = inferModelEyeRegions(data, width, height, bounds);
  for (const region of regions) {
    for (let y = Math.max(bounds.minY, Math.floor(region.centerY - region.radiusY)); y <= Math.min(bounds.maxY, Math.ceil(region.centerY + region.radiusY)); y += 1) {
      for (let x = Math.max(bounds.minX, Math.floor(region.centerX - region.radiusX)); x <= Math.min(bounds.maxX, Math.ceil(region.centerX + region.radiusX)); x += 1) {
        const dx = (x - region.centerX) / region.radiusX;
        const dy = (y - region.centerY) / region.radiusY;
        if ((dx * dx) + (dy * dy) > 1) continue;
        const pixel = y * width + x;
        const offset = pixel * 4;
        if (data[offset + 3] < 128) continue;
        const { saturation, value } = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
        if (isLightWarmWash(data[offset], data[offset + 1], data[offset + 2], saturation, value)) continue;
        const colored = Math.abs(dx) <= 0.78 && Math.abs(dy) <= 0.52
          && isEyePigmentPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
        const darkInner = value <= 0.3 && Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.55;
        if (colored || darkInner) mask[pixel] = 1;
      }
    }
  }
  return mask;
}

function buildBrowMask(data, width, height, bounds) {
  const mask = new Uint8Array(width * height);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const regions = inferModelEyeRegions(data, width, height, bounds);
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    // Use the gap between the two eye anchors as the partition. Eyebrows can
    // be long and strongly slanted (particularly in masculine models), so a
    // small ellipse around the iris incorrectly trims them or rejects them.
    const previousBoundary = index === 0
      ? bounds.minX + spanX * 0.03
      : (regions[index - 1].centerX + region.centerX) / 2;
    const nextBoundary = index === regions.length - 1
      ? bounds.maxX - spanX * 0.02
      : (region.centerX + regions[index + 1].centerX) / 2;
    const rowMinX = Math.max(bounds.minX, Math.floor(previousBoundary));
    const rowMaxX = Math.min(bounds.maxX, Math.ceil(nextBoundary));
    const minY = Math.max(bounds.minY, Math.floor(region.centerY - spanY * 0.28));
    // Stop above the eye contour. A connected-component pass cannot safely do
    // this because antialiasing often joins brow and lash pixels into one blob.
    const maxY = Math.min(bounds.maxY, Math.floor(region.centerY - spanY * 0.075));
    const minimumRun = Math.max(3, Math.round(spanX * 0.035));
    for (let y = minY; y <= maxY; y += 1) {
      let start = -1;
      for (let x = rowMinX; x <= rowMaxX + 1; x += 1) {
        let selected = false;
        if (x <= rowMaxX) {
          const offset = (y * width + x) * 4;
          // Chroma cleanup can leave a faint, coloured fringe around the old
          // background. It is useful for edge compositing, but never a valid
          // eyebrow. Require opaque core pixels for semantic brow detection.
          selected = data[offset + 3] >= 128 && hasPigment(data[offset], data[offset + 1], data[offset + 2]);
        }
        if (selected && start < 0) start = x;
        if ((!selected || x > rowMaxX) && start >= 0) {
          const end = x - 1;
          const runWidth = end - start + 1;
          const center = (start + end + 1) / 2;
          // Keep long horizontal strokes inside this eye's partition. This
          // rejects the vertical head contour while preserving a slanted brow
          // whose row-by-row center moves away from the iris.
          if (runWidth >= minimumRun && center >= rowMinX && center <= rowMaxX) {
            for (let runX = start; runX <= end; runX += 1) mask[y * width + runX] = 1;
          }
          start = -1;
        }
      }
    }
  }
  return mask;
}

function componentBelongsToScope(component, scope, bounds) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const componentWidth = component.maxX - component.minX + 1;
  const componentHeight = component.maxY - component.minY + 1;
  const relativeY = (component.minY - bounds.minY) / spanY;
  const relativeBottom = (component.maxY - bounds.minY) / spanY;
  const relativeWidth = componentWidth / spanX;
  const aspect = componentWidth / Math.max(1, componentHeight);
  if (component.area < 3 || relativeY < 0.2 || relativeBottom > 0.74) return false;
  if (scope === "pupils") {
    // A pupil/iris is compact. Long horizontal components are usually
    // eyelashes or the eye outline and must not be recolored.
    return relativeY >= 0.42 && relativeBottom <= 0.73 && relativeWidth <= 0.34 && aspect <= 11;
  }
  // A brow is a short elongated stroke above the eye, not a full face edge.
  return relativeY >= 0.25 && relativeBottom <= 0.56 && relativeWidth >= 0.018 && relativeWidth <= 0.38 && aspect >= 1.15 && aspect <= 18;
}

/**
 * Builds a semantic mask from the decoded source instead of deciding each
 * pixel independently. Components are important here: anti-aliased pupils
 * and brows form coherent regions, while outlines and facial washes have a
 * different shape and are discarded before recoloring.
 */
export function buildModelColorSelectionMask(scope, data, width, height, visibleBounds) {
  const normalizedScope = normalizeModelColorScope(scope);
  const mask = new Uint8Array(width * height);
  if (visibleBounds.maxX < visibleBounds.minX || visibleBounds.maxY < visibleBounds.minY) return mask;
  const bounds = semanticBoundsFor(normalizedScope, visibleBounds, data, width, height);
  if (normalizedScope === "skin") {
    for (let y = bounds.minY; y <= Math.min(height - 1, bounds.maxY); y += 1) {
      for (let x = Math.max(0, bounds.minX); x <= Math.min(width - 1, bounds.maxX); x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        if (isSkinTone(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) mask[pixel] = 1;
      }
    }
    return mask;
  }
  const pupils = buildPupilMask(data, width, height, bounds);
  if (normalizedScope === "pupils" || normalizedScope === "pupilsBrows") {
    for (let pixel = 0; pixel < mask.length; pixel += 1) if (pupils[pixel]) mask[pixel] = 1;
  }
  if (normalizedScope === "brows" || normalizedScope === "pupilsBrows") {
    const brows = buildBrowMask(data, width, height, bounds);
    for (let pixel = 0; pixel < mask.length; pixel += 1) if (brows[pixel]) mask[pixel] = 1;
  }
  return mask;
}

function isModelPupil(red, green, blue, alpha, position) {
  if (alpha < 160 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  if (!relative) return false;

  // The supported model heads are framed consistently: the two eye/iris
  // centers stay in these lanes, including three-quarter faces. The narrow
  // vertical ellipse excludes brows, blush and mouth.
  const insideEyeCore = eyeCenters(position).some((eyeX) => isInsideEyeCore(relative, eyeX));
  if (!insideEyeCore) return false;

  // Only pigment is selected. Neutral eye whites, outlines and lashes stay
  // intact, and an asymmetric asset keeps a missing/unpainted eye untouched.
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  return saturation >= 0.3 && value >= 0.25;
}

function isSkinTone(red, green, blue, alpha) {
  if (alpha <= 8) return false;
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const warmHue = hue <= 58 || hue >= 335;
  const warmBalance = red >= blue * 1.08 && green >= blue * 0.88;
  return warmHue && warmBalance && saturation <= 0.52 && value >= 0.18;
}

export function isModelColorPixel(scope, red, green, blue, alpha, position) {
  if (scope === "details") return isLegacyModelDetail(red, green, blue, alpha, position);
  const normalizedScope = normalizeModelColorScope(scope);
  if (normalizedScope === "pupils") return isModelPupil(red, green, blue, alpha, position);
  if (normalizedScope === "brows") return isModelBrow(red, green, blue, alpha, position);
  if (normalizedScope === "pupilsBrows") return isModelPupil(red, green, blue, alpha, position)
    || isModelBrow(red, green, blue, alpha, position);
  return isSkinTone(red, green, blue, alpha);
}
