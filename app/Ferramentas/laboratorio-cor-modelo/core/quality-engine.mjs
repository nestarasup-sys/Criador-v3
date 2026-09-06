import { maskBounds } from "./mask-engine.mjs";

export function summarizeMask(mask, width, height) {
  const bounds = maskBounds(mask, width, height);
  const total = width * height;
  const pixels = bounds?.count ?? 0;
  return {
    pixels,
    coverage: total ? pixels / total : 0,
    bounds,
  };
}

export function validateMaskPair(masks, image, options = {}) {
  const { width, height, data } = image;
  const minimumPixels = options.minimumPixels ?? 2;
  const pupil = summarizeMask(masks.pupils, width, height);
  const brow = summarizeMask(masks.brows, width, height);
  const warnings = [];
  if (pupil.pixels < minimumPixels) warnings.push("Pupilas ausentes ou muito pequenas.");
  if (brow.pixels < minimumPixels) warnings.push("Sobrancelhas ausentes ou muito pequenas.");

  let overlap = 0;
  let transparentSelection = 0;
  const length = Math.min(masks.pupils.length, masks.brows.length, width * height);
  for (let pixel = 0; pixel < length; pixel += 1) {
    if (masks.pupils[pixel] && masks.brows[pixel]) overlap += 1;
    if ((masks.pupils[pixel] || masks.brows[pixel]) && data[pixel * 4 + 3] < 12) transparentSelection += 1;
  }
  if (overlap > 0) warnings.push(`${overlap.toLocaleString("pt-BR")} pixels foram marcados simultaneamente como pupila e sobrancelha.`);
  if (transparentSelection > 0) warnings.push(`${transparentSelection.toLocaleString("pt-BR")} pixels transparentes foram selecionados.`);
  return {
    pupil,
    brow,
    overlap,
    transparentSelection,
    warnings,
    status: warnings.length ? "review" : "ready",
  };
}
