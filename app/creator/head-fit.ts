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

// Pequena folga para a roupa cobrir completamente o pescoço, sem deixar
// frestas nas bordas por causa do antialiasing dos dois assets.
const NECK_FIT_WIDTH_MARGIN = 1.02;

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

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
    centerX: (left + right) / 2,
    ...(neckLeft !== undefined && neckRight !== undefined && neckWidth !== undefined && neckCenterX !== undefined
      ? { neckLeft, neckRight, neckWidth, neckCenterX, neckY }
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function contourAt(measurement: HeadMeasurement, normalizedY: number) {
  const rows = measurement.contour?.filter((row) => row.right >= row.left) ?? [];
  if (rows.length < 2 || measurement.bottom <= measurement.top) return null;
  const y = measurement.top + (measurement.bottom - measurement.top) * clamp(normalizedY, 0, 1);
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
  const mappedCenterOffsets = samples.map((sample) => sample.target.center - sample.source.center * scaleX);
  return {
    scaleX,
    sourceCenterX: median(samples.map((sample) => sample.source.center)),
    targetCenterX: median(mappedCenterOffsets) + median(samples.map((sample) => sample.source.center)) * scaleX,
  };
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
  const sourceHeadHeight = Math.max(1, source.bottom - source.top);
  const targetHeadHeight = Math.max(1, target.bottom - target.top);
  const contourReference = !useNeckReference ? robustContourReference(source, target) : null;
  const scaleX = clamp(
    useNeckReference
      ? (targetNeckWidth! / sourceNeckWidth!) * NECK_FIT_WIDTH_MARGIN
      : contourReference?.scaleX ?? targetHeadWidth / sourceHeadWidth,
    0.35,
    2.4,
  );
  const scaleY = clamp(targetHeadHeight / sourceHeadHeight, 0.35, 2.4);
  const centerX = item.defaultX ?? item.width / 2;
  const centerY = item.defaultY ?? item.height / 2;
  const targetCenterX = targetAnchor?.x
    ?? (useNeckReference ? target.neckCenterX : undefined)
    ?? contourReference?.targetCenterX
    ?? target.centerX;
  const sourceCenterX = (useNeckReference ? source.neckCenterX : undefined)
    ?? contourReference?.sourceCenterX
    ?? source.centerX;
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
        }
      : {}),
    contour: source.contour?.map((row) => ({
      y: projectY(row.y),
      left: Math.min(projectX(row.left), projectX(row.right)),
      right: Math.max(projectX(row.left), projectX(row.right)),
    })),
  };
}
