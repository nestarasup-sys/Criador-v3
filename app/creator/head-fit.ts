export type HeadMeasurement = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  /** Medidas da faixa estável do pescoço, quando ela foi detectada. */
  neckLeft?: number;
  neckRight?: number;
  neckWidth?: number;
  neckCenterX?: number;
  neckY?: number;
  /** Última linha confiável antes de o pescoço abrir para gola/ombros. */
  neckBottomY?: number;
  /** Perfil separado para não contaminar o polígono usado ao apagar a cabeça. */
  neckContour?: HeadContourRow[];
  contour?: HeadContourRow[];
};

export type HeadContourRow = {
  y: number;
  left: number;
  right: number;
};

export type HeadFitResult = {
  scale: number;
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
  flipX?: boolean;
};

export type HeadFitProjection = HeadMeasurement;
export type HeadFitReference = "head" | "neck";

export type HeadFitOptions = {
  /**
   * Mantém a geometria global da cabeça e deixa a faixa cervical para o warp
   * local. Isso é importante em roupas com gola/armadura, cuja largura não
   * representa a largura real da cabeça.
   */
  mode?: "default" | "balanced-neck" | "male-neck";
};

/**
 * Medição da abertura interna de um cabelo frontal. Diferente da silhueta
 * externa, esta referência representa o espaço vazio onde a cabeça entra.
 */
export type HairOpeningMeasurement = HeadMeasurement & {
  kind: "hair-opening";
};

// Pequena folga para a roupa cobrir completamente o pescoço, sem deixar
// frestas nas bordas por causa do antialiasing dos dois assets.
const NECK_FIT_WIDTH_MARGIN = 1.02;

function skinColorDistance(r: number, g: number, b: number, reference: { r: number; g: number; b: number }) {
  // Diferenças de crominância recebem mais peso que iluminação. Isso mantém
  // sombras da mesma pele no componente e rejeita gola/cabelo de brilho parecido.
  const redGreen = (r - g) - (reference.r - reference.g);
  const blueGreen = (b - g) - (reference.b - reference.g);
  const luminance = (r + g + b - reference.r - reference.g - reference.b) / 3;
  return Math.hypot(redGreen, blueGreen) + Math.abs(luminance) * 0.28;
}

function detectSkinNeckContour(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  head: { left: number; right: number; top: number; bottom: number; centerX: number },
  visibleLimit: number,
) {
  const headWidth = head.right - head.left + 1;
  const headHeight = head.bottom - head.top + 1;
  const samples: Array<{ r: number; g: number; b: number }> = [];
  for (const yRatio of [0.2, 0.28, 0.36]) {
    const y = clamp(Math.round(head.top + headHeight * yRatio), 0, height - 1);
    for (const xRatio of [-0.08, -0.04, 0, 0.04, 0.08]) {
      const x = clamp(Math.round(head.centerX + headWidth * xRatio), 0, width - 1);
      const index = (y * width + x) * 4;
      if (pixels[index + 3] < 160) continue;
      samples.push({ r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] });
    }
  }
  if (samples.length < 6) return null;
  const reference = {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
  const startY = Math.max(head.top, head.bottom - Math.round(headHeight * 0.04));
  const endY = Math.min(visibleLimit, head.bottom + Math.max(12, Math.round(headHeight * 0.42)));
  const searchLeft = clamp(Math.floor(head.centerX - headWidth * 0.34), 0, width - 1);
  const searchRight = clamp(Math.ceil(head.centerX + headWidth * 0.34), 0, width - 1);
  const minimumWidth = Math.max(4, headWidth * 0.045);
  const maximumWidth = headWidth * 0.58;
  const rows: HeadContourRow[] = [];
  let missing = 0;
  for (let y = startY; y <= endY; y += 1) {
    const runs: Array<{ left: number; right: number }> = [];
    let runStart = -1;
    for (let x = searchLeft; x <= searchRight; x += 1) {
      const index = (y * width + x) * 4;
      const matches = pixels[index + 3] > 80
        && skinColorDistance(pixels[index], pixels[index + 1], pixels[index + 2], reference) <= 24;
      if (matches && runStart < 0) runStart = x;
      if ((!matches || x === searchRight) && runStart >= 0) {
        runs.push({ left: runStart, right: matches && x === searchRight ? x : x - 1 });
        runStart = -1;
      }
    }
    const candidate = runs
      .map((run) => ({ ...run, width: run.right - run.left + 1, center: (run.left + run.right) / 2 }))
      .filter((run) => run.width >= minimumWidth && run.width <= maximumWidth)
      .sort((leftRun, rightRun) => (
        Math.abs(leftRun.center - head.centerX) - Math.abs(rightRun.center - head.centerX)
        || rightRun.width - leftRun.width
      ))[0];
    if (!candidate) {
      missing += 1;
      if (rows.length >= 5 && missing >= 3) break;
      continue;
    }
    missing = 0;
    rows.push({ y, left: candidate.left, right: candidate.right });
  }
  if (rows.length < 5) return null;
  // O final pode conter até duas linhas anteriores a uma interrupção; manter
  // apenas a sequência contínua mais longa evita pular uma gola e reencontrar pele.
  let best: HeadContourRow[] = [];
  let current: HeadContourRow[] = [];
  for (const row of rows) {
    if (current.length && row.y > current[current.length - 1].y + 1) current = [];
    current.push(row);
    if (current.length > best.length) best = current.slice();
  }
  return best.length >= 5 ? best : null;
}

/**
 * Measures the upper silhouette of a transparent character image.
 * Clothing imports contain a full body, so the lower part is deliberately
 * ignored. This keeps the fit anchored to the included head rather than to
 * the skirt, arms or other clothing details.
 */
export function measureHeadSilhouette(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxVisibleYRatio = 0.64,
  requireNeckTransition = true,
): HeadMeasurement | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return null;

  let contentTop = height;
  let contentBottom = -1;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] <= 12) continue;
    const pixel = (index - 3) / 4;
    const y = Math.floor(pixel / width);
    contentTop = Math.min(contentTop, y);
    contentBottom = Math.max(contentBottom, y);
  }
  if (contentBottom < contentTop) return null;

  const visibleLimit = Math.min(
    contentBottom,
    Math.round(contentTop + (contentBottom - contentTop) * maxVisibleYRatio),
  );

  // Build the horizontal silhouette profile. The first narrow, sustained
  // section after the widest part is the neck; this is much more reliable for
  // full-body clothing than treating an arbitrary percentage of the image as
  // the head. Small antialiased gaps are tolerated by looking at neighboring
  // rows while keeping the original pixel positions.
  const rows: Array<{ y: number; left: number; right: number; width: number }> = [];
  for (let y = contentTop; y <= visibleLimit; y += 1) {
    let left = width;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= 12) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    rows.push({ y, left, right, width: right >= left ? right - left + 1 : 0 });
  }
  if (rows.every((row) => row.width <= 0)) return null;
  // Find the head's widest point before the shoulders can inflate the
  // profile. A 45% window was still too generous for tall outfits: some
  // shoulders entered the window and became the "head". Keep the peak in the
  // upper 40%, where every supported sheet has already reached the cranium
  // plateau but has not reached the torso yet.
  const peakSearchEnd = Math.max(1, Math.ceil(rows.length * 0.4));
  const widestRow = rows.slice(0, peakSearchEnd).reduce<{ left: number; right: number; width: number; index: number }>(
    (best, row, index) => row.width > best.width ? { ...row, index } : best,
    { ...rows[0], index: 0 },
  );
  const minimumNeckWidth = widestRow.width * 0.62;
  let neckIndex = -1;

  // A jaw can become narrower than the neck before it reaches the chin.
  // Therefore the first narrow row is not a reliable boundary: on Iris, for
  // example, the profile narrows from ~207 px to ~122 px while the chin still
  // continues for several dozen rows. The neck is the first *stable* narrow
  // band after that curve, not the first row below a width threshold.
  for (let index = widestRow.index + 4; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.width <= 0 || row.width > widestRow.width * 0.72) continue;
    const following = rows
      .slice(index, Math.min(rows.length, index + 9))
      .filter((candidate) => candidate.width > 0);
    if (following.length < 6) continue;
    const minimumFollowingWidth = Math.min(...following.map((candidate) => candidate.width));
    const maximumFollowingWidth = Math.max(...following.map((candidate) => candidate.width));
    const stableBand =
      maximumFollowingWidth <= minimumFollowingWidth * 1.1 &&
      row.width <= minimumFollowingWidth * 1.08 &&
      following.filter((candidate) => candidate.width <= widestRow.width * 0.72).length >= 6;
    if (stableBand) {
      neckIndex = index;
      break;
    }
  }

  // Keep a conservative fallback for assets whose neck is short or has
  // antialiased gaps. This fallback is deliberately stricter than the old
  // “first sustained narrowing” rule, so a gradual jaw curve cannot end the
  // head polygon by itself.
  if (neckIndex < 0) {
    for (let index = widestRow.index + 4; index < rows.length; index += 1) {
      if (rows[index].width <= 0 || rows[index].width > minimumNeckWidth) continue;
      const following = rows.slice(index, Math.min(rows.length, index + 7)).filter((row) => row.width > 0);
      if (following.length >= 5 && following.filter((row) => row.width <= widestRow.width * 0.68).length >= 5) {
        neckIndex = index;
        break;
      }
    }
  }

  // Some clothes have a high collar or a scarf directly under the chin. In
  // those images there is no nine-row stable neck band: the profile narrows
  // until the last jaw row and then expands abruptly into the collar/torso.
  // That turning point is still a reliable head boundary. It is deliberately
  // stricter than "first narrow row" so a normal cheek curve cannot terminate
  // the head too early.
  let jawTurnIndex = -1;
  if (neckIndex < 0) {
    const smoothedWidths = rows.map((_, index) => median(
      rows
        .slice(Math.max(widestRow.index, index - 2), Math.min(rows.length, index + 3))
        .map((row) => row.width)
        .filter((width) => width > 0),
    ));
    for (let index = widestRow.index + 8; index < rows.length - 2; index += 1) {
      const currentWidth = smoothedWidths[index];
      if (currentWidth <= 0 || currentWidth > widestRow.width * 0.82) continue;
      const previous = smoothedWidths.slice(Math.max(widestRow.index, index - 12), index);
      const descendingRows = previous.filter((width, previousIndex) => (
        previousIndex === 0 || width <= previous[previousIndex - 1] * 1.04
      )).length;
      if (previous.length < 7 || descendingRows < previous.length * 0.72) continue;

      const localWindow = smoothedWidths.slice(Math.max(widestRow.index, index - 2), index + 3);
      if (currentWidth > Math.min(...localWindow) + 3) continue;
      const after = smoothedWidths.slice(index + 1, Math.min(rows.length, index + 8));
      const rebound = Math.max(...after, 0) >= Math.max(currentWidth + 12, currentWidth * 1.18);
      if (rebound) {
        jawTurnIndex = index;
        break;
      }
    }
  }

  // A full-body clothing asset without its own head starts at the shoulders
  // and has no head-to-neck transition. Refusing that case is safer than
  // stretching the torso as if it were a head.
  const headBoundaryIndex = neckIndex >= 0 ? neckIndex : jawTurnIndex;
  if (requireNeckTransition && headBoundaryIndex < 0) return null;
  const headEnd = headBoundaryIndex >= 0 ? rows[headBoundaryIndex].y : visibleLimit;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] <= 12) continue;
    const pixel = (index - 3) / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (y > headEnd) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return null;

  const contour = rows
    .slice(0, headBoundaryIndex >= 0 ? headBoundaryIndex + 1 : rows.length)
    .filter((row) => row.width > 0)
    .map((row) => ({ y: row.y, left: row.left, right: row.right }));

  // A largura total da cabeça não é uma referência confiável para roupas:
  // dois modelos podem ter o mesmo crânio, mas pescoços de larguras
  // diferentes. Use a faixa estreita e estável encontrada após a curva do
  // queixo. A mediana evita que uma linha antialiasada ou uma sombra isolada
  // altere o scaleX.
  const neckRows = neckIndex >= 0
    ? rows.slice(neckIndex, Math.min(rows.length, neckIndex + 9)).filter((row) => row.width > 0)
    : [];
  const neckLeft = neckRows.length >= 3 ? median(neckRows.map((row) => row.left)) : undefined;
  const neckRight = neckRows.length >= 3 ? median(neckRows.map((row) => row.right)) : undefined;
  const neckWidth = neckLeft !== undefined && neckRight !== undefined
    ? Math.max(1, neckRight - neckLeft + 1)
    : undefined;
  const neckCenterX = neckLeft !== undefined && neckRight !== undefined
    ? (neckLeft + neckRight) / 2
    : undefined;
  const neckY = neckRows.length >= 3
    ? median(neckRows.map((row) => row.y))
    : jawTurnIndex >= 0 ? rows[jawTurnIndex].y : undefined;
  let neckContour: HeadContourRow[] | undefined;
  let neckBottomY: number | undefined;
  if (neckIndex >= 0 && neckRows.length >= 3) {
    const referenceWidth = median(neckRows.map((row) => row.width));
    const referenceCenter = median(neckRows.map((row) => (row.left + row.right) / 2));
    const maximumRows = Math.max(12, Math.round(widestRow.width * 0.34));
    const candidates = rows.slice(neckIndex, Math.min(rows.length, neckIndex + maximumRows));
    let invalidRun = 0;
    const accepted: typeof rows = [];
    for (const row of candidates) {
      const center = (row.left + row.right) / 2;
      const plausible = row.width > 0
        && row.width <= referenceWidth * 1.24
        && Math.abs(center - referenceCenter) <= widestRow.width * 0.1;
      if (plausible) {
        invalidRun = 0;
        accepted.push(row);
      } else {
        invalidRun += 1;
        if (invalidRun >= 3) break;
      }
    }
    if (accepted.length >= 5) {
      neckContour = accepted.map((row) => ({ y: row.y, left: row.left, right: row.right }));
      neckBottomY = accepted[accepted.length - 1].y;
    }
  }
  if (!neckContour) {
    const skinNeck = detectSkinNeckContour(pixels, width, height, { left, right, top, bottom, centerX: (left + right) / 2 }, visibleLimit);
    if (skinNeck) {
      neckContour = skinNeck;
      neckBottomY = skinNeck[skinNeck.length - 1].y;
      const stableSkinRows = skinNeck.slice(Math.max(0, skinNeck.length - Math.min(9, skinNeck.length)));
      const skinLeft = median(stableSkinRows.map((row) => row.left));
      const skinRight = median(stableSkinRows.map((row) => row.right));
      // Estes campos eram constantes; `let` permite preencher o fallback por
      // pele somente quando a silhueta alpha não encontrou uma faixa cervical.
      return {
        left,
        right,
        top,
        bottom,
        width: Math.max(1, right - left + 1),
        height: Math.max(1, bottom - top + 1),
        centerX: (left + right) / 2,
        neckLeft: skinLeft,
        neckRight: skinRight,
        neckWidth: Math.max(1, skinRight - skinLeft + 1),
        neckCenterX: (skinLeft + skinRight) / 2,
        neckY: skinNeck[0].y,
        neckBottomY,
        neckContour,
        contour,
      };
    }
  }

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
    centerX: (left + right) / 2,
    ...(neckLeft !== undefined && neckRight !== undefined && neckWidth !== undefined && neckCenterX !== undefined
      ? { neckLeft, neckRight, neckWidth, neckCenterX, neckY, neckBottomY, neckContour }
      : neckY !== undefined ? { neckY } : {}),
    contour,
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Builds the filled contour used by the automatic outfit-head eraser.
 *
 * The optional side margin is intentionally applied only above the detected
 * neck band. The antialiased edge of an imported head can otherwise survive
 * as a one-pixel line, while expanding the neck itself would remove part of
 * the collar/skin that the eraser is meant to preserve.
 */
export function headContourPolygon(measurement: HeadMeasurement, horizontalMargin = 0) {
  const rows = measurement.contour?.filter((row) => row.right >= row.left) ?? [];
  const margin = Math.max(0, horizontalMargin);
  const sideMarginFor = (y: number) => (
    measurement.neckY === undefined || y < measurement.neckY - 2 ? margin : 0
  );
  if (rows.length < 2) {
    return [
      { x: measurement.left - margin, y: measurement.top },
      { x: measurement.right + margin, y: measurement.top },
      { x: measurement.right + margin, y: measurement.bottom },
      { x: measurement.left - margin, y: measurement.bottom },
    ];
  }
  return [
    ...rows.map((row) => ({ x: row.left - sideMarginFor(row.y), y: row.y })),
    ...rows.slice().reverse().map((row) => ({ x: row.right + sideMarginFor(row.y), y: row.y })),
  ];
}

type AlphaRun = { left: number; right: number };
type OpeningCandidate = { left: number; right: number; width: number; center: number };

function alphaRunsAtRow(pixels: Uint8ClampedArray, width: number, y: number) {
  const runs: AlphaRun[] = [];
  let start = -1;
  for (let x = 0; x < width; x += 1) {
    const visible = pixels[(y * width + x) * 4 + 3] > 12;
    if (visible && start < 0) start = x;
    if ((!visible || x === width - 1) && start >= 0) {
      const right = visible && x === width - 1 ? x : x - 1;
      runs.push({ left: start, right });
      start = -1;
    }
  }
  return runs;
}

function openingCandidatesAtRow(runs: AlphaRun[], width: number) {
  const minimumGap = Math.max(8, Math.round(width * 0.07));
  const candidates: OpeningCandidate[] = [];
  for (let index = 0; index < runs.length - 1; index += 1) {
    const left = runs[index].right + 1;
    const right = runs[index + 1].left - 1;
    const gapWidth = right - left + 1;
    if (gapWidth < minimumGap) continue;
    // A gap touching the image edge is the transparent background, not the
    // opening between the two sides of the hairstyle.
    const edgeMargin = Math.max(2, Math.round(width * 0.04));
    if (left <= edgeMargin || right >= width - 1 - edgeMargin) continue;
    candidates.push({ left, right, width: gapWidth, center: (left + right) / 2 });
  }
  return candidates;
}

function chooseOpeningCandidate(candidates: OpeningCandidate[], previousCenter?: number) {
  if (!candidates.length) return null;
  const pool = previousCenter === undefined
    ? candidates
    : candidates.filter((candidate) => Math.abs(candidate.center - previousCenter) <= Math.max(24, candidate.width * 0.9));
  const usable = pool.length ? pool : candidates;
  return usable.slice().sort((left, right) => {
    if (previousCenter !== undefined) {
      const distance = Math.abs(left.center - previousCenter) - Math.abs(right.center - previousCenter);
      if (Math.abs(distance) > 2) return distance;
    }
    return right.width - left.width;
  })[0];
}

/**
 * Finds the transparent opening inside a frontal hairstyle.
 *
 * The opening must be bounded by visible hair on both sides and persist for
 * several rows. This avoids treating the transparent page background, tiny
 * holes between strands, or the outer silhouette as the head reference.
 */
export function measureHairOpening(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): HairOpeningMeasurement | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return null;

  let contentTop = height;
  let contentBottom = -1;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] <= 12) continue;
    const pixel = (index - 3) / 4;
    const y = Math.floor(pixel / width);
    contentTop = Math.min(contentTop, y);
    contentBottom = Math.max(contentBottom, y);
  }
  if (contentBottom < contentTop) return null;

  const rows: Array<{ y: number; candidates: OpeningCandidate[] }> = [];
  for (let y = contentTop; y <= contentBottom; y += 1) {
    const candidates = openingCandidatesAtRow(alphaRunsAtRow(pixels, width, y), width);
    rows.push({ y, candidates });
  }

  // The first valid gap must be sustained. This prevents a small triangular
  // hole below a fringe from becoming the top of the head opening.
  let startIndex = -1;
  for (let index = 0; index < rows.length - 10; index += 1) {
    const current = chooseOpeningCandidate(rows[index].candidates);
    if (!current) continue;
    let sustained = 0;
    for (let offset = 0; offset < 12; offset += 1) {
      const candidate = chooseOpeningCandidate(rows[index + offset].candidates, current.center);
      if (candidate && Math.abs(candidate.center - current.center) <= Math.max(32, width * 0.16)) sustained += 1;
    }
    if (sustained >= 7) {
      startIndex = index;
      break;
    }
  }
  if (startIndex < 0) return null;

  const openingRows: HeadContourRow[] = [];
  let previousCenter: number | undefined;
  let missedRows = 0;
  for (let index = startIndex; index < rows.length; index += 1) {
    const candidate = chooseOpeningCandidate(rows[index].candidates, previousCenter);
    if (!candidate) {
      missedRows += 1;
      if (missedRows > 5) break;
      continue;
    }
    missedRows = 0;
    previousCenter = candidate.center;
    openingRows.push({ y: rows[index].y, left: candidate.left, right: candidate.right });
  }
  if (openingRows.length < 12) return null;

  const top = openingRows[0].y;
  const bottom = openingRows[openingRows.length - 1].y;
  const left = Math.min(...openingRows.map((row) => row.left));
  const right = Math.max(...openingRows.map((row) => row.right));
  return {
    kind: "hair-opening",
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
    centerX: (left + right) / 2,
    contour: openingRows,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function contourAt(measurement: HeadMeasurement, normalizedY: number) {
  const rows = measurement.contour?.filter((row) => row.right >= row.left) ?? [];
  if (rows.length < 2 || measurement.bottom <= measurement.top) return null;
  const y = measurement.top + (measurement.bottom - measurement.top) * clamp(normalizedY, 0, 1);
  return contourAtY(measurement, y, rows);
}

function contourAtY(measurement: HeadMeasurement, y: number, knownRows?: HeadContourRow[]) {
  const rows = knownRows ?? measurement.contour?.filter((row) => row.right >= row.left) ?? [];
  if (rows.length < 2) return null;
  let lower = rows[0];
  let upper = rows[rows.length - 1];
  for (const row of rows) {
    if (row.y <= y) lower = row;
    if (row.y >= y) {
      upper = row;
      break;
    }
  }
  const range = upper.y - lower.y;
  const ratio = range > 0 ? (y - lower.y) / range : 0;
  const left = lower.left + (upper.left - lower.left) * ratio;
  const right = lower.right + (upper.right - lower.right) * ratio;
  return { left, right, center: (left + right) / 2, width: Math.max(1, right - left) };
}

function profileScaleY(
  source: HeadMeasurement,
  target: HeadMeasurement,
  initialScaleX: number,
  sourceCenterX: number,
  targetCenterX: number,
  initialScaleY: number,
) {
  const sourceRows = source.contour?.filter((row) => row.right >= row.left) ?? [];
  const targetRows = target.contour?.filter((row) => row.right >= row.left) ?? [];
  if (sourceRows.length < 8 || targetRows.length < 8) return initialScaleY;

  const sourceBottom = structuralBottom(source);
  const targetBottom = structuralBottom(target);
  const sourceSpan = sourceBottom - source.top;
  const targetSpan = targetBottom - target.top;
  if (sourceSpan < 8 || targetSpan < 8) return initialScaleY;

  const xOffset = targetCenterX - sourceCenterX * initialScaleX;
  const candidates: Array<{ scale: number; score: number }> = [];
  // Search around the endpoint estimate. A bounded search is intentional:
  // this is a refinement for heads with different curvature, not permission
  // to stretch an outfit into an unrelated size.
  const minimum = clamp(initialScaleY * 0.65, 0.35, 2.4);
  const maximum = clamp(initialScaleY * 1.35, 0.35, 2.4);
  for (let step = 0; step <= 40; step += 1) {
    const scaleY = minimum + (maximum - minimum) * (step / 40);
    let score = 0;
    let samples = 0;
    for (let sample = 0.08; sample <= 0.92; sample += 0.14) {
      const targetY = target.top + targetSpan * sample;
      const sourceY = source.top + (targetY - target.top) / scaleY;
      if (sourceY < source.top || sourceY > sourceBottom) continue;
      const sourceRow = contourAtY(source, sourceY, sourceRows);
      const targetRow = contourAtY(target, targetY, targetRows);
      if (!sourceRow || !targetRow) continue;
      const projectedLeft = sourceRow.left * initialScaleX + xOffset;
      const projectedRight = sourceRow.right * initialScaleX + xOffset;
      const targetWidth = Math.max(1, targetRow.right - targetRow.left);
      score += (
        Math.abs(projectedLeft - targetRow.left)
        + Math.abs(projectedRight - targetRow.right)
      ) / targetWidth;
      samples += 1;
    }
    if (samples >= 5) candidates.push({ scale: scaleY, score: score / samples });
  }
  if (!candidates.length) return initialScaleY;
  candidates.sort((left, right) => left.score - right.score);
  const best = candidates[0];
  // Do not let a nearly tied profile score cause a surprising jump from the
  // simpler endpoint solution. Only accept a meaningful improvement.
  const initial = candidates.reduce((bestCandidate, candidate) => (
    Math.abs(candidate.scale - initialScaleY) < Math.abs(bestCandidate.scale - initialScaleY)
      ? candidate
      : bestCandidate
  ));
  return best.score + 0.015 < initial.score ? best.scale : initialScaleY;
}

function robustContourReference(source: HeadMeasurement, target: HeadMeasurement) {
  // The legacy aligner stabilizes several normalized scanlines instead of
  // trusting one bounding-box row. Use the same principle here: one affine
  // transform is estimated from the median of multiple head-profile samples.
  const samples = [0.08, 0.2, 0.34, 0.5, 0.66, 0.8, 0.92]
    .map((normalizedY) => ({ source: contourAt(source, normalizedY), target: contourAt(target, normalizedY) }))
    .filter((sample): sample is { source: NonNullable<ReturnType<typeof contourAt>>; target: NonNullable<ReturnType<typeof contourAt>> } => Boolean(sample.source && sample.target));
  if (samples.length < 4) return null;
  const scaleCandidates = samples
    .filter((sample) => sample.source.width > 2)
    .map((sample) => sample.target.width / sample.source.width);
  if (scaleCandidates.length < 4) return null;
  const scaleX = median(scaleCandidates);
  // Estimate the translation from both edges, not just the center. This
  // prevents an asymmetric head (common in three-quarter poses) from being
  // centered correctly while one side still misses the model's silhouette.
  const mappedEdgeOffsets = samples.flatMap((sample) => [
    sample.target.left - sample.source.left * scaleX,
    sample.target.right - sample.source.right * scaleX,
  ]);
  const mappedCenterOffsets = samples.map((sample) => sample.target.center - sample.source.center * scaleX);
  const mappedOffset = median(mappedEdgeOffsets.length >= 8 ? mappedEdgeOffsets : mappedCenterOffsets);
  const sourceCenterX = median(samples.map((sample) => sample.source.center));
  return {
    scaleX,
    sourceCenterX,
    targetCenterX: mappedOffset + sourceCenterX * scaleX,
  };
}

function structuralBottom(measurement: HeadMeasurement) {
  // `bottom` is the last visible pixel in the detected head region. When the
  // detector found a real neck band, `neckY` is the more stable boundary and
  // ignores a collar/shoulder fragment that may sit below it.
  return measurement.neckY ?? measurement.bottom;
}

/**
 * Calculates the transform used by Creator's renderer. The target is in the
 * final 1920×1080 scene; the source point is in the item's native image.
 * The default head reference uses the outer silhouette. The optional neck
 * reference uses the stable neck band for horizontal scale and centering,
 * while keeping the upper point as the vertical reference.
 */
export function calculateHeadFit(
  source: HeadMeasurement,
  target: HeadMeasurement,
  item: { width: number; height: number; defaultX?: number; defaultY?: number },
  targetAnchor?: { x?: number; y?: number },
  reference: HeadFitReference = "head",
  options: HeadFitOptions = {},
): HeadFitResult {
  const sourceNeckWidth = source.neckWidth;
  const targetNeckWidth = target.neckWidth;
  const useNeckReference = reference === "neck"
    && sourceNeckWidth !== undefined
    && targetNeckWidth !== undefined;
  // The renderer maps the actual edge coordinates (left/right and top/bottom),
  // not the number of covered pixels. Using `width`/`height` here adds one
  // pixel to both boxes and leaves a small but visible residual on different
  // sized heads. Keep the inclusive pixel counts for display, but fit by the
  // geometric span that projectHeadMeasurement uses.
  const sourceHeadWidth = Math.max(1, source.right - source.left);
  const targetHeadWidth = Math.max(1, target.right - target.left);
  // A roupa inteira recebe este transform.  Para a altura, a referência
  // correta é o intervalo estrutural topo → base do pescoço, não o último
  // pixel detectado do recorte.  Alguns assets têm gola, sombra ou um
  // fragmento do tronco abaixo da cabeça; usar `bottom` nesses casos faz o
  // topo coincidir, mas deixa o pescoço divergente conforme a roupa desce.
  const sourceStructuralBottom = structuralBottom(source);
  const targetStructuralBottom = structuralBottom(target);
  const sourceHeadHeight = Math.max(1, sourceStructuralBottom - source.top);
  const targetHeadHeight = Math.max(1, targetStructuralBottom - target.top);
  const contourReference = robustContourReference(source, target);
  const headScale = contourReference?.scaleX ?? targetHeadWidth / sourceHeadWidth;
  const neckScale = useNeckReference
    ? (targetNeckWidth! / sourceNeckWidth!) * NECK_FIT_WIDTH_MARGIN
    : headScale;
  const balancedNeck = useNeckReference && (options.mode === "balanced-neck" || options.mode === "male-neck");
  // Se a proporção cervical diverge muito da proporção da cabeça, ela é uma
  // característica local da roupa (gola, armadura, cachecol etc.), não uma
  // boa escala para o corpo inteiro. Perto da proporção esperada ainda
  // permitimos uma pequena contribuição do pescoço; quando a divergência é
  // grande, a cabeça passa a comandar a escala e o warp corrige a faixa.
  const neckAgreement = options.mode === "male-neck"
    ? 0
    : balancedNeck
    ? clamp(0.32 - Math.abs(Math.log(Math.max(0.01, neckScale / Math.max(0.01, headScale)))) * 0.42, 0, 0.32)
    : 1;
  const scaleX = clamp(
    useNeckReference
      ? headScale + (neckScale - headScale) * neckAgreement
      : headScale,
    0.35,
    2.4,
  );
  const centerX = item.defaultX ?? item.width / 2;
  const centerY = item.defaultY ?? item.height / 2;
  const targetCenterX = targetAnchor?.x
    ?? (useNeckReference && !balancedNeck ? target.neckCenterX : undefined)
    ?? contourReference?.targetCenterX
    ?? target.centerX;
  const sourceCenterX = (!balancedNeck && useNeckReference ? source.neckCenterX : undefined)
    ?? contourReference?.sourceCenterX
    ?? source.centerX;
  const endpointScaleY = clamp(targetHeadHeight / sourceHeadHeight, 0.35, 2.4);
  // No modo pescoço, topo e faixa cervical precisam coincidir exatamente.
  // O refinamento pelo perfil da cabeça é útil no encaixe comum, mas alterava
  // scaleY depois do cálculo dos extremos e fazia o pescoço voltar a sair do
  // lugar. O warp local cuida das diferenças de curva sem quebrar a âncora.
  const scaleY = useNeckReference ? endpointScaleY : profileScaleY(
      source,
      target,
      scaleX,
      sourceCenterX,
      targetCenterX,
      endpointScaleY,
    );
  const targetTopY = target.top;

  // drawLayer translates to item center and draws from -width/2,-height/2.
  // Solve that same equation instead of relying on a second coordinate system.
  return {
    scaleX: +scaleX.toFixed(4),
    scaleY: +scaleY.toFixed(4),
    scale: 1,
    x: +(
      targetCenterX - (centerX - item.width / 2 * scaleX + sourceCenterX * scaleX)
    ).toFixed(2),
    y: +(
      targetTopY - (centerY - item.height / 2 * scaleY + source.top * scaleY)
    ).toFixed(2),
  };
}

export function projectHeadMeasurement(
  source: HeadMeasurement,
  item: { width: number; height: number; defaultX?: number; defaultY?: number },
  transform: HeadFitResult,
): HeadFitProjection {
  const scaleX = transform.scale * transform.scaleX * (transform.flipX ? -1 : 1);
  const scaleY = transform.scale * transform.scaleY;
  const centerX = item.defaultX ?? item.width / 2;
  const centerY = item.defaultY ?? item.height / 2;
  const projectX = (value: number) => centerX + transform.x + (value - item.width / 2) * scaleX;
  const projectY = (value: number) => centerY + transform.y + (value - item.height / 2) * scaleY;
  const left = Math.min(projectX(source.left), projectX(source.right));
  const right = Math.max(projectX(source.left), projectX(source.right));
  const neckLeft = source.neckLeft === undefined ? undefined : projectX(source.neckLeft);
  const neckRight = source.neckRight === undefined ? undefined : projectX(source.neckRight);
  return {
    left,
    right,
    top: projectY(source.top),
    bottom: projectY(source.bottom),
    width: Math.max(1, right - left),
    height: Math.max(1, Math.abs(projectY(source.bottom) - projectY(source.top))),
    centerX: (left + right) / 2,
    ...(neckLeft !== undefined && neckRight !== undefined && source.neckY !== undefined
      ? {
          neckLeft: Math.min(neckLeft, neckRight),
          neckRight: Math.max(neckLeft, neckRight),
          neckWidth: Math.max(1, Math.abs(neckRight - neckLeft)),
          neckCenterX: (neckLeft + neckRight) / 2,
          neckY: projectY(source.neckY),
          neckBottomY: source.neckBottomY === undefined ? undefined : projectY(source.neckBottomY),
          neckContour: source.neckContour?.map((row) => ({
            y: projectY(row.y),
            left: Math.min(projectX(row.left), projectX(row.right)),
            right: Math.max(projectX(row.left), projectX(row.right)),
          })),
        }
      : {}),
    contour: source.contour?.map((row) => ({
      y: projectY(row.y),
      left: Math.min(projectX(row.left), projectX(row.right)),
      right: Math.max(projectX(row.left), projectX(row.right)),
    })),
  };
}
