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
};

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
): HeadMeasurement | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return null;

  let contentTop = height;
  let contentBottom = -1;
  let contentLeft = width;
  let contentRight = -1;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] <= 12) continue;
    const pixel = (index - 3) / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    contentTop = Math.min(contentTop, y);
    contentBottom = Math.max(contentBottom, y);
    contentLeft = Math.min(contentLeft, x);
    contentRight = Math.max(contentRight, x);
  }
  if (contentRight < contentLeft || contentBottom < contentTop) return null;

  const visibleLimit = Math.min(
    contentBottom,
    Math.round(contentTop + (contentBottom - contentTop) * maxVisibleYRatio),
  );
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] <= 12) continue;
    const pixel = (index - 3) / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (y > visibleLimit) continue;
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
  const scaleX = clamp(target.width / source.width, 0.65, 1.6);
  const scaleY = clamp(target.height / source.height, 0.65, 1.6);
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
