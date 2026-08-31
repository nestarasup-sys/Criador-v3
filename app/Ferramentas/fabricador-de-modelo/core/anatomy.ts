import type { FaceAnatomy, StructuralProfilePoint } from "../types/face-model";
import { createStructuralMask, createVisualMask, largestConnectedComponent, type BinaryMask, type MaskComponent } from "./structural-mask";
import { median } from "../utils/statistics";

function longestRun(mask: BinaryMask, width: number, y: number, left: number, right: number) {
  let start = -1; let bestStart = -1; let bestEnd = -1;
  for (let x = left; x <= right + 1; x += 1) {
    const active = x <= right && mask[y * width + x] === 1;
    if (active && start < 0) start = x;
    if (!active && start >= 0) {
      if (bestStart < 0 || x - 1 - start > bestEnd - bestStart) { bestStart = start; bestEnd = x - 1; }
      start = -1;
    }
  }
  return bestStart < 0 ? null : { left: bestStart, right: bestEnd, width: bestEnd - bestStart + 1, center: (bestStart + bestEnd) / 2 };
}

function profileForImage(mask: BinaryMask, width: number, component: MaskComponent, neckCenterX: number, cranialWidth: number): StructuralProfilePoint[] {
  const profile: StructuralProfilePoint[] = [];
  const headBottom = Math.max(component.y + 1, component.y + Math.round(component.height * .84));
  for (let index = 0; index < 32; index += 1) {
    const y = Math.round(component.y + (headBottom - component.y) * index / 31);
    const run = longestRun(mask, width, y, component.x, component.x + component.width - 1);
    profile.push(run ? { y, widthNorm: run.width / Math.max(1, cranialWidth), centerOffset: (run.center - neckCenterX) / Math.max(1, cranialWidth) } : { y, widthNorm: 0, centerOffset: 0 });
  }
  return profile;
}

export function analyzeFaceAnatomy(data: Uint8ClampedArray, width: number, height: number, preserveExpressiveDetails = true): FaceAnatomy | null {
  if (data.length !== width * height * 4 || width < 1 || height < 1) return null;
  const visualMask = createVisualMask(data, 24);
  const visualComponent = largestConnectedComponent(visualMask, width, height);
  if (!visualComponent) return null;
  const structural = createStructuralMask(visualMask, width, height, preserveExpressiveDetails);
  const structuralComponent = structural.component ?? visualComponent;
  const cranialRows: number[] = [];
  const cranialCenters: number[] = [];
  const headStart = structuralComponent.y + Math.round(structuralComponent.height * .08);
  const headEnd = structuralComponent.y + Math.round(structuralComponent.height * .68);
  for (let y = headStart; y <= Math.min(structuralComponent.y + structuralComponent.height - 1, headEnd); y += 1) {
    const run = longestRun(structural.mask, width, y, structuralComponent.x, structuralComponent.x + structuralComponent.width - 1);
    if (run && run.width >= 3) { cranialRows.push(run.width); cranialCenters.push(run.center); }
  }
  const cranialWidth = Math.max(1, Math.round(median(cranialRows) || structuralComponent.width));
  const centerX = median(cranialCenters) || (structuralComponent.x + structuralComponent.width / 2);
  const neckRuns: Array<{ width: number; center: number }> = [];
  const neckStart = visualComponent.y + Math.round(visualComponent.height * .78);
  for (let y = neckStart; y <= visualComponent.y + visualComponent.height - 1; y += 1) {
    const run = longestRun(visualMask, width, y, visualComponent.x, visualComponent.x + visualComponent.width - 1);
    if (run && run.width >= 2) neckRuns.push(run);
  }
  const lowerNeck = neckRuns.slice(Math.floor(neckRuns.length * .45));
  const neckCenterX = median(lowerNeck.map((run) => run.center)) || centerX;
  const neckWidth = Math.max(1, median(lowerNeck.map((run) => run.width)) || cranialWidth * .34);
  const profile = profileForImage(structural.mask, width, structuralComponent, neckCenterX, cranialWidth);
  return {
    width: cranialWidth,
    height: visualComponent.y + visualComponent.height - structuralComponent.y,
    centerX,
    centerY: structuralComponent.y + structuralComponent.height / 2,
    structuralTop: structuralComponent.y,
    structuralBottom: structuralComponent.y + structuralComponent.height - 1,
    neckCenterX,
    neckWidth,
    neckBaseY: visualComponent.y + visualComponent.height - 1,
    cranialWidth,
    profile,
    visualBounds: { x: visualComponent.x, y: visualComponent.y, width: visualComponent.width, height: visualComponent.height },
  };
}
