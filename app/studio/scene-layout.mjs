export const STUDIO_SCENE_WIDTH = 1920;
export const STUDIO_SCENE_HEIGHT = 1080;
export const STUDIO_CHARACTER_HEIGHT = STUDIO_SCENE_HEIGHT * 0.72;
export const STUDIO_OBJECT_WIDTH = STUDIO_SCENE_WIDTH * 0.18;

export function fitMediaRect(sourceWidth, sourceHeight, targetWidth, targetHeight, fit = "cover") {
  const safeSourceWidth = Math.max(1, Number(sourceWidth) || 1);
  const safeSourceHeight = Math.max(1, Number(sourceHeight) || 1);
  const scale = fit === "contain"
    ? Math.min(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight)
    : Math.max(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height, scale };
}

export function characterRect(sourceWidth, sourceHeight, scale = 1) {
  const height = STUDIO_CHARACTER_HEIGHT * scale;
  return { width: height * Math.max(1, sourceWidth) / Math.max(1, sourceHeight), height };
}

export function objectRect(sourceWidth, sourceHeight, scale = 1) {
  const width = STUDIO_OBJECT_WIDTH * scale;
  return { width, height: width * Math.max(1, sourceHeight) / Math.max(1, sourceWidth) };
}

export function analyzeSourceQuality(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const horizontalScale = targetWidth / Math.max(1, sourceWidth);
  const verticalScale = targetHeight / Math.max(1, sourceHeight);
  const upscale = Math.max(horizontalScale, verticalScale);
  return {
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    upscale,
    status: upscale > 1.05 ? "warning" : "native",
  };
}
