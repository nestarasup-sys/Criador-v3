/**
 * Encontra os limites reais dos pixels visíveis de uma imagem RGBA.
 * A margem é aplicada somente depois de encontrar o primeiro/último pixel,
 * evitando que células de folhas determinem o tamanho final do recorte.
 */
export function findVisibleBounds(data, width, height, options = {}) {
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? 24));
  const padding = Math.max(0, Math.round(options.padding ?? 3));
  const search = options.search ?? { x: 0, y: 0, width, height };
  const startX = Math.max(0, Math.floor(search.x));
  const startY = Math.max(0, Math.floor(search.y));
  const endX = Math.min(width, Math.ceil(search.x + search.width));
  const endY = Math.min(height, Math.ceil(search.y + search.height));
  let minX = endX;
  let minY = endY;
  let maxX = -1;
  let maxY = -1;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const x = Math.max(startX, minX - padding);
  const y = Math.max(startY, minY - padding);
  return {
    x,
    y,
    width: Math.min(endX, maxX + padding + 1) - x,
    height: Math.min(endY, maxY + padding + 1) - y,
  };
}
