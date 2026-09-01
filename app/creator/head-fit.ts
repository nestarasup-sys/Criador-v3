export type HeadMeasurement = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
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
  const rows: Array<{ left: number; right: number; width: number }> = [];
  for (let y = contentTop; y <= visibleLimit; y += 1) {
    let left = width;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= 12) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    rows.push({ left, right, width: right >= left ? right - left + 1 : 0 });
  }
  if (rows.every((row) => row.width <= 0)) return null;
  // Find the head's widest point before the shoulders can inflate the
  // profile. For a full-body outfit this usually covers the upper 45% of the
  // inspected region; for a head-only model it still contains the cranium.
  const peakSearchEnd = Math.max(1, Math.ceil(rows.length * 0.45));
  const widestRow = rows.slice(0, peakSearchEnd).reduce<{ left: number; right: number; width: number; index: number }>(
    (best, row, index) => row.width > best.width ? { ...row, index } : best,
    { ...rows[0], index: 0 },
  );
  const minimumNeckWidth = widestRow.width * 0.62;
  let neckIndex = -1;
  for (let index = widestRow.index + 4; index < rows.length; index += 1) {
    if (rows[index].width <= 0 || rows[index].width > minimumNeckWidth) continue;
    const following = rows.slice(index, Math.min(rows.length, index + 5)).filter((row) => row.width > 0);
    if (following.length >= 3 && following.filter((row) => row.width <= widestRow.width * 0.72).length >= 3) {
      neckIndex = index;
      break;
    }
  }
  // A full-body clothing asset without its own head starts at the shoulders
  // and has no head-to-neck transition. Refusing that case is safer than
  // stretching the torso as if it were a head.
  if (requireNeckTransition && neckIndex < 0) return null;
  const headEnd = neckIndex >= 0 ? contentTop + neckIndex : visibleLimit;
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

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
    centerX: (left + right) / 2,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Calculates the transform used by Creator's renderer. The target is in the
 * final 1920×1080 scene; the source point is in the item's native image.
 * Horizontal sides and the lower head/neck point are the anchors. The top is
 * intentionally not used as a hard anchor because expressions and hairlines
 * can change it slightly.
 */
export function calculateHeadFit(
  source: HeadMeasurement,
  target: HeadMeasurement,
  item: { width: number; height: number; defaultX?: number; defaultY?: number },
  targetAnchor?: { x?: number; y?: number },
): HeadFitResult {
  const scaleX = clamp(target.width / source.width, 0.35, 2.4);
  const scaleY = clamp(target.height / source.height, 0.35, 2.4);
  const centerX = item.defaultX ?? item.width / 2;
  const centerY = item.defaultY ?? item.height / 2;
  const targetCenterX = targetAnchor?.x ?? target.centerX;
  const targetBaseY = targetAnchor?.y ?? target.bottom;

  // drawLayer translates to item center and draws from -width/2,-height/2.
  // Solve that same equation instead of relying on a second coordinate system.
  return {
    scaleX: +scaleX.toFixed(4),
    scaleY: +scaleY.toFixed(4),
    scale: 1,
    x: +(
      targetCenterX - (centerX - item.width / 2 * scaleX + source.centerX * scaleX)
    ).toFixed(2),
    y: +(
      targetBaseY - (centerY - item.height / 2 * scaleY + source.bottom * scaleY)
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
  return {
    left,
    right,
    top: projectY(source.top),
    bottom: projectY(source.bottom),
    width: Math.max(1, right - left),
    height: Math.max(1, Math.abs(projectY(source.bottom) - projectY(source.top))),
    centerX: (left + right) / 2,
  };
}
