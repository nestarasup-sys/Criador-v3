import { headContourPolygon } from "./head-fit";
import type { HeadFitCorrection, ItemTransform } from "../domain/character-primitives";

type Padding = { x: number; y: number };
type RenderItem = { width: number; height: number; defaultX?: number; defaultY?: number };

function drawTransformed(
  target: CanvasRenderingContext2D,
  source: CanvasImageSource,
  item: RenderItem,
  transform: HeadFitCorrection["transform"] | ItemTransform,
  padding: Padding,
) {
  const centerX = item.defaultX ?? item.width / 2;
  const centerY = item.defaultY ?? item.height / 2;
  target.save();
  target.globalCompositeOperation = "source-over";
  target.translate(padding.x + centerX + transform.x, padding.y + centerY + transform.y);
  target.rotate((transform.rotation * Math.PI) / 180);
  target.scale(
    transform.scale * (transform.scaleX ?? 1) * (transform.flipX ? -1 : 1),
    transform.scale * (transform.scaleY ?? 1),
  );
  target.drawImage(source, -item.width / 2, -item.height / 2, item.width, item.height);
  target.restore();
}

function createHeadMask(width: number, height: number, correction: HeadFitCorrection) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const context = mask.getContext("2d");
  if (!context) return null;
  const polygon = headContourPolygon(correction.source, 0);
  if (polygon.length < 3) return null;
  context.fillStyle = "white";
  context.beginPath();
  context.moveTo(polygon[0].x, polygon[0].y);
  for (const point of polygon.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fill();
  return mask;
}

/**
 * Draws an outfit while applying a head-only correction. This prevents a
 * different male/female head aspect ratio from deforming the outfit body.
 */
export function drawImageWithHeadFit(
  target: CanvasRenderingContext2D,
  source: CanvasImageSource,
  item: RenderItem,
  transform: ItemTransform,
  padding: Padding,
) {
  const correction = transform.headFit;
  if (!correction?.source?.contour?.length) {
    drawTransformed(target, source, item, transform, padding);
    return;
  }

  const mask = createHeadMask(item.width, item.height, correction);
  if (!mask) {
    drawTransformed(target, source, item, transform, padding);
    return;
  }

  const head = document.createElement("canvas");
  head.width = item.width;
  head.height = item.height;
  const headContext = head.getContext("2d");
  const body = document.createElement("canvas");
  body.width = item.width;
  body.height = item.height;
  const bodyContext = body.getContext("2d");
  if (!headContext || !bodyContext) {
    drawTransformed(target, source, item, transform, padding);
    return;
  }

  headContext.drawImage(source, 0, 0, item.width, item.height);
  headContext.globalCompositeOperation = "destination-in";
  headContext.drawImage(mask, 0, 0);

  bodyContext.drawImage(source, 0, 0, item.width, item.height);
  bodyContext.globalCompositeOperation = "destination-out";
  bodyContext.drawImage(mask, 0, 0);

  const { headFit: _headFit, ...bodyTransform } = transform;
  void _headFit;
  drawTransformed(target, body, item, bodyTransform, padding);
  drawTransformed(target, head, item, correction.transform, padding);
}
