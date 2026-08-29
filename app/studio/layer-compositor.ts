/**
 * Achata camadas já renderizadas em uma ordem determinística.
 *
 * Cada chamada recebe um estado limpo para que uma operação de composição
 * usada por máscara em uma camada não vaze para a próxima camada.
 */
export function compositeCharacterLayers(
  context: CanvasRenderingContext2D,
  layers: readonly (CanvasImageSource | null | undefined)[],
) {
  for (const layer of layers) {
    if (!layer) continue;
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.drawImage(layer, 0, 0);
    context.restore();
  }
}
