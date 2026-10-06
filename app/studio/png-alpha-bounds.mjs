/** Retorna limites inclusivos à esquerda/topo e exclusivos à direita/baixo. */
export function alphaBoundsFromRgba(pixels, width, height) {
  if (!pixels || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Dimensões RGBA inválidas");
  }
  if (pixels.length !== width * height * 4) throw new Error("Buffer RGBA incompatível com as dimensões");

  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  const rowStride = width * 4;
  for (let y = 0; y < height; y += 1) {
    let pixelIndex = y * rowStride + 3;
    for (let x = 0; x < width; x += 1, pixelIndex += 4) {
      if (pixels[pixelIndex] === 0) continue;
      if (x < left) left = x;
      if (x + 1 > right) right = x + 1;
      if (y < top) top = y;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}
