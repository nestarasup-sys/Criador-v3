export function configureHighQualityContext(context: CanvasRenderingContext2D) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}
