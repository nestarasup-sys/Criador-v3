import type { FaceAnatomy, HeadMaster, QualityMetrics } from "../types/face-model";
import { clamp } from "../utils/statistics";
import { compareProfiles } from "./head-master";

export function scoreFace(anatomy: FaceAnatomy, master: HeadMaster, adjustment: { scale?: number; scaleX: number; scaleY: number }, stability: number, compatibility?: number): QualityMetrics {
  const uniform = adjustment.scale ?? 1;
  const effectiveScaleX = uniform * adjustment.scaleX;
  const effectiveScaleY = uniform * adjustment.scaleY;
  const scaleError = Math.max(Math.abs(Math.log(Math.max(.001, effectiveScaleX))), Math.abs(Math.log(Math.max(.001, effectiveScaleY))));
  const sourceLeft = (anatomy.structuralBounds.x - anatomy.neckCenterX) * effectiveScaleX;
  const sourceRight = (anatomy.structuralBounds.x + anatomy.structuralBounds.width - 1 - anatomy.neckCenterX) * effectiveScaleX;
  const sourceBottom = (anatomy.structuralBottom - anatomy.neckBaseY) * effectiveScaleY;
  const positionError = Math.max(Math.abs(sourceLeft - master.structuralLeft), Math.abs(sourceRight - master.structuralRight)) / Math.max(1, master.structuralWidth)
    + Math.abs(sourceBottom - master.structuralBottom) / Math.max(1, master.height) * .5;
  const proportionError = Math.abs(Math.log(Math.max(.001, (anatomy.width / Math.max(1, anatomy.height)) / (master.width / Math.max(1, master.height)))));
  const profile = compareProfiles(anatomy.profile, master.profile);
  const shape = clamp(100 - profile.total * 900, 0, 100);
  const metrics = {
    stability: clamp(stability, 0, 100),
    scale: clamp(100 - scaleError * 700, 0, 100),
    position: clamp(100 - positionError * 400, 0, 100),
    proportion: clamp(100 - proportionError * 900, 0, 100),
    shape,
    neck: clamp(100 - Math.abs(Math.log(Math.max(.001, (anatomy.neckWidth / Math.max(1, anatomy.width)) / (master.neckWidth / Math.max(1, master.width))))) * 800, 0, 100),
  };
  const overall = Math.round(metrics.stability * .18 + metrics.scale * .18 + metrics.position * .12 + metrics.proportion * .14 + metrics.shape * .23 + metrics.neck * .15);
  const reasons: string[] = [];
  if (metrics.stability < 70) reasons.push("trio instável");
  if (metrics.scale < 70) reasons.push("correção de escala alta");
  if (metrics.shape < 70) reasons.push("silhueta estrutural divergente");
  if (metrics.neck < 70) reasons.push("pescoço incompatível");
  if (compatibility !== undefined && compatibility < 70) reasons.push("compatibilidade baixa com o Head Master");
  return { ...metrics, overall, compatibility, critical: overall < 60 || metrics.neck < 45 || metrics.shape < 45, warning: overall < 88 || reasons.length > 0, reasons };
}
