import type { FaceAnatomy, HeadMaster, QualityMetrics } from "../types/face-model";
import { clamp } from "../utils/statistics";

type TransformedProfilePoint = { width: number; center: number };

function adjustedProfile(anatomy: FaceAnatomy, scaleX: number, dx: number): TransformedProfilePoint[] {
  return anatomy.profile.map((point) => ({
    width: point.widthNorm * anatomy.cranialWidth * scaleX,
    center: point.centerOffset * anatomy.cranialWidth * scaleX + dx,
  }));
}

function adjustedProfileError(profile: readonly TransformedProfilePoint[], master: HeadMaster) {
  let widthError = 0;
  let centerError = 0;
  let count = 0;
  for (let index = 0; index < Math.min(profile.length, master.profile.length); index += 1) {
    const source = profile[index];
    const target = master.profile[index];
    const targetWidth = target.widthNorm * Math.max(1, master.width);
    if (!source.width || !targetWidth) continue;
    widthError += Math.abs(Math.log(Math.max(.001, source.width / targetWidth)));
    centerError += Math.abs(source.center - target.centerOffset * Math.max(1, master.width)) / Math.max(1, master.width);
    count += 1;
  }
  return count ? widthError / count + centerError / count * .45 : 1;
}

export function scoreFace(anatomy: FaceAnatomy, master: HeadMaster, adjustment: { scale?: number; scaleX: number; scaleY: number; dx?: number; dy?: number }, stability: number, compatibility?: number): QualityMetrics {
  const uniform = adjustment.scale ?? 1;
  const effectiveScaleX = uniform * adjustment.scaleX;
  const effectiveScaleY = uniform * adjustment.scaleY;
  const dx = adjustment.dx ?? 0;
  const dy = adjustment.dy ?? 0;
  // The magnitude of the correction is not a quality failure by itself. A
  // sprite from the extension sheet can legitimately start 8% smaller and
  // still be perfectly aligned after calibration. Score the residual size
  // error of the transformed result instead of punishing the correction that
  // fixed it.
  const adjustedStructuralWidth = anatomy.structuralBounds.width * effectiveScaleX;
  const adjustedStructuralHeight = anatomy.height * effectiveScaleY;
  const widthResidual = Math.abs(Math.log(Math.max(.001, adjustedStructuralWidth / Math.max(1, master.structuralWidth))));
  const heightResidual = Math.abs(Math.log(Math.max(.001, adjustedStructuralHeight / Math.max(1, master.height))));
  const scaleError = Math.max(widthResidual, heightResidual);
  const sourceLeft = (anatomy.structuralBounds.x - anatomy.neckCenterX) * effectiveScaleX + dx;
  const sourceRight = (anatomy.structuralBounds.x + anatomy.structuralBounds.width - 1 - anatomy.neckCenterX) * effectiveScaleX + dx;
  const sourceBottom = (anatomy.structuralBottom - anatomy.neckBaseY) * effectiveScaleY + dy;
  const positionError = Math.max(Math.abs(sourceLeft - master.structuralLeft), Math.abs(sourceRight - master.structuralRight)) / Math.max(1, master.structuralWidth)
    + Math.abs(sourceBottom - master.structuralBottom) / Math.max(1, master.height) * .5;
  const adjustedWidth = anatomy.width * effectiveScaleX;
  const adjustedHeight = anatomy.height * effectiveScaleY;
  const proportionError = Math.abs(Math.log(Math.max(.001, (adjustedWidth / Math.max(1, adjustedHeight)) / (master.width / Math.max(1, master.height)))));
  const profileError = adjustedProfileError(adjustedProfile(anatomy, effectiveScaleX, dx), master);
  const shape = clamp(100 - profileError * 900, 0, 100);
  const metrics = {
    stability: clamp(stability, 0, 100),
    scale: clamp(100 - scaleError * 700, 0, 100),
    position: clamp(100 - positionError * 400, 0, 100),
    proportion: clamp(100 - proportionError * 900, 0, 100),
    shape,
    neck: clamp(100 - Math.abs(Math.log(Math.max(.001, (anatomy.neckWidth * effectiveScaleX / Math.max(1, adjustedWidth)) / (master.neckWidth / Math.max(1, master.width))))) * 800, 0, 100),
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
