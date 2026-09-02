import type { CompatibilityMetrics, FaceAnatomy, HeadMaster, QualityMetrics, SpriteAdjustment } from "../types/face-model";
import { clamp, mad, median, robustZ } from "../utils/statistics";
import { compareProfiles } from "./head-master";
import { scoreFace } from "./quality";

export type CalibrationOutput = { adjustments: SpriteAdjustment[]; metrics: QualityMetrics[]; trioTargets: Array<{ width: number; height: number }>; outlierIndices: number[]; compatibility?: CompatibilityMetrics };

function medianProfile(anatomies: readonly FaceAnatomy[], indices: readonly number[]) {
  return Array.from({ length: 32 }, (_, pointIndex) => {
    const points = indices.map((index) => anatomies[index]?.profile[pointIndex]).filter((point) => Boolean(point && point.widthNorm > 0));
    return points.length ? {
      y: Math.round(median(points.map((point) => point.y))),
      widthNorm: median(points.map((point) => point.widthNorm)),
      centerOffset: median(points.map((point) => point.centerOffset)),
    } : { y: pointIndex, widthNorm: 0, centerOffset: 0 };
  });
}

function usableForTrio(anatomies: readonly FaceAnatomy[], indices: number[]) {
  const widths = indices.map((index) => anatomies[index].width); const heights = indices.map((index) => anatomies[index].height);
  const widthCenter = median(widths); const heightCenter = median(heights);
  const widthMad = mad(widths, widthCenter); const heightMad = mad(heights, heightCenter);
  return indices.filter((index) => robustZ(anatomies[index].width, widthCenter, widthMad, widthCenter * .012) <= 3.5 && robustZ(anatomies[index].height, heightCenter, heightMad, heightCenter * .012) <= 3.5);
}

type AlignmentFrame = { left: number; right: number; top: number; bottom: number };

function frameOf(anatomy: FaceAnatomy): AlignmentFrame {
  return {
    left: anatomy.structuralBounds.x - anatomy.neckCenterX,
    right: anatomy.structuralBounds.x + anatomy.structuralBounds.width - 1 - anatomy.neckCenterX,
    top: anatomy.structuralTop - anatomy.neckBaseY,
    bottom: anatomy.structuralBottom - anatomy.neckBaseY,
  };
}

function medianFrame(anatomies: readonly FaceAnatomy[], indices: readonly number[]): AlignmentFrame {
  const frames = indices.map((index) => frameOf(anatomies[index])).filter(Boolean);
  return frames.length ? {
    left: median(frames.map((frame) => frame.left)),
    right: median(frames.map((frame) => frame.right)),
    top: median(frames.map((frame) => frame.top)),
    bottom: median(frames.map((frame) => frame.bottom)),
  } : { left: -1, right: 1, top: -1, bottom: 0 };
}

function blendFrame(local: AlignmentFrame, master: HeadMaster, localWeight: number): AlignmentFrame {
  const weight = clamp(localWeight, 0, 1);
  return {
    left: local.left * weight + master.structuralLeft * (1 - weight),
    right: local.right * weight + master.structuralRight * (1 - weight),
    // The legacy statistical calibrators do not have a reliable global top;
    // they only consume the side and neck-base coordinates below.
    top: local.top,
    bottom: local.bottom * weight + master.structuralBottom * (1 - weight),
  };
}

function sideScale(frame: AlignmentFrame, target: AlignmentFrame) {
  return target.right - target.left > 0 ? (target.right - target.left) / Math.max(1, frame.right - frame.left) : 1;
}

function medianScale(values: number[]) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  return usable.length ? median(usable) : 1;
}

function sideOffset(frame: AlignmentFrame, target: AlignmentFrame, scaleX: number) {
  const leftCorrection = target.left - frame.left * scaleX;
  const rightCorrection = target.right - frame.right * scaleX;
  return (leftCorrection + rightCorrection) / 2;
}

type ProfileAlignment = { scaleX: number; dx: number };

/**
 * Measures the silhouette at several normalized heights. A single bounding
 * box can be identical while the forehead, cheek and jaw still drift by a few
 * pixels. This keeps the correction affine (scaleX + translation only), but
 * makes those measurements participate in the same robust fit.
 */
function profileAlignment(source: FaceAnatomy, target: FaceAnatomy): ProfileAlignment | null {
  const samples = source.profile.map((point, index) => {
    const counterpart = target.profile[index];
    if (!counterpart || point.widthNorm <= 0 || counterpart.widthNorm <= 0) return null;
    const sourceWidth = point.widthNorm * Math.max(1, source.cranialWidth);
    const targetWidth = counterpart.widthNorm * Math.max(1, target.cranialWidth);
    return {
      scale: targetWidth / Math.max(1, sourceWidth),
      sourceCenter: point.centerOffset * Math.max(1, source.cranialWidth),
      targetCenter: counterpart.centerOffset * Math.max(1, target.cranialWidth),
      sourceWidth,
      targetWidth,
    };
  }).filter((sample): sample is NonNullable<typeof sample> => Boolean(sample) && Number.isFinite(sample.scale) && sample.scale > 0);
  if (samples.length < 4) return null;
  const scaleX = medianScale(samples.map((sample) => sample.scale));
  const offsets = samples.map((sample) => sample.targetCenter - sample.sourceCenter * scaleX);
  const dx = median(offsets);
  return { scaleX, dx };
}

function structuralHeight(anatomy: FaceAnatomy) {
  return Math.max(1, anatomy.structuralBottom - anatomy.structuralTop + 1);
}

function subpixelOffset(value: number) {
  return Number(value.toFixed(2));
}

/**
 * Produces the automatic adjustment for one face against the canonical face.
 *
 * The side frame is the primary measurement. Cranial and neck widths are
 * independent checks, so a noisy silhouette measurement cannot move the whole
 * sheet by itself. Vertical placement matches the structural top first and
 * uses the neck-base frame as a softer secondary constraint.
 */
export function canonicalAdjustment(source: FaceAnatomy, canonical: FaceAnatomy): SpriteAdjustment {
  const sourceFrame = frameOf(source);
  const targetFrame = frameOf(canonical);
  const profile = profileAlignment(source, canonical);
  const scaleX = medianScale([
    sideScale(sourceFrame, targetFrame),
    canonical.cranialWidth / Math.max(1, source.cranialWidth),
    canonical.neckWidth / Math.max(1, source.neckWidth),
    ...(profile ? [profile.scaleX] : []),
  ]);
  const scaleY = (targetFrame.bottom - targetFrame.top) / Math.max(1, sourceFrame.bottom - sourceFrame.top);
  const sideCorrection = sideOffset(sourceFrame, targetFrame, scaleX);
  const horizontalCorrection = profile ? median([sideCorrection, sideCorrection, profile.dx]) : sideCorrection;
  const topCorrection = targetFrame.top - sourceFrame.top * scaleY;
  const bottomCorrection = targetFrame.bottom - sourceFrame.bottom * scaleY;
  return {
    scale: 1,
    scaleX,
    scaleY,
    dx: subpixelOffset(horizontalCorrection),
    dy: subpixelOffset(topCorrection * .65 + bottomCorrection * .35),
    reviewed: false,
  };
}

/**
 * Aligns every extracted face to one concrete canonical face instead of to a
 * statistical average. The first default expression of the primary sheet is
 * the canonical face used by the Fabricador, including for the extension
 * sheet. This preserves a sheet that was already aligned manually and makes
 * every output share the same left/right/bottom frame.
 */
export function calibrateToCanonical(
  anatomies: readonly FaceAnatomy[],
  canonical: FaceAnatomy,
  compatibility?: number,
): CalibrationOutput {
  const targetFrame = frameOf(canonical);
  const canonicalMaster: HeadMaster = {
    width: canonical.width,
    height: canonical.height,
    centerX: canonical.centerX,
    neckCenterX: canonical.neckCenterX,
    neckWidth: canonical.neckWidth,
    neckBaseY: canonical.neckBaseY,
    structuralLeft: targetFrame.left,
    structuralRight: targetFrame.right,
    structuralBottom: targetFrame.bottom,
    structuralWidth: Math.max(1, targetFrame.right - targetFrame.left + 1),
    profile: canonical.profile,
    usableIndices: [],
    outlierIndices: [],
    referenceIndex: 0,
    bestTrioColumn: 0,
    stabilityScore: 100,
  };
  const adjustments = anatomies.map((anatomy) => {
    return canonicalAdjustment(anatomy, canonical);
  });
  const metrics = anatomies.map((anatomy, index) => scoreFace(anatomy, canonicalMaster, adjustments[index], 100, compatibility));
  return {
    adjustments,
    metrics,
    trioTargets: Array.from({ length: 7 }, () => ({ width: canonical.width, height: canonical.height })),
    outlierIndices: [],
  };
}

export function calibratePrimary(anatomies: readonly FaceAnatomy[], master: HeadMaster, maximumCorrection = .07, strength = .75): CalibrationOutput {
  const globalUsable = master.usableIndices.length ? master.usableIndices : anatomies.map((_, index) => index);
  const globalWidth = median(globalUsable.map((index) => anatomies[index].width));
  const globalHeight = median(globalUsable.map((index) => anatomies[index].height));
  const trioTargets = Array.from({ length: 7 }, (_, column) => {
    const indices = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    const usable = usableForTrio(anatomies, indices);
    const source = usable.length ? usable : indices;
    return { width: median(source.map((index) => anatomies[index].width)), height: median(source.map((index) => anatomies[index].height)) };
  });
  const trioFrames = Array.from({ length: 7 }, (_, column) => {
    const indices = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    return medianFrame(anatomies, indices);
  });
  const adjustments = anatomies.map((anatomy, index) => {
    const trio = trioTargets[index % 7];
    const target = { width: trio.width * strength + globalWidth * (1 - strength), height: trio.height * strength + globalHeight * (1 - strength) };
    const targetFrame = blendFrame(trioFrames[index % 7], master, strength);
    const sourceFrame = frameOf(anatomy);
    const scaleX = clamp(sideScale(sourceFrame, targetFrame), 1 - maximumCorrection, 1 + maximumCorrection);
    const scaleY = clamp(target.height / Math.max(1, anatomy.height), 1 - maximumCorrection, 1 + maximumCorrection);
    return { scale: 1, scaleX, scaleY, dx: Math.round(sideOffset(sourceFrame, targetFrame, scaleX)), dy: Math.round(targetFrame.bottom - sourceFrame.bottom * scaleY), reviewed: false };
  });
  const metrics = anatomies.map((anatomy, index) => scoreFace(anatomy, master, adjustments[index], 100 - Math.max(Math.abs(anatomy.width - globalWidth) / Math.max(1, globalWidth), Math.abs(anatomy.height - globalHeight) / Math.max(1, globalHeight)) * 100));
  return { adjustments, metrics, trioTargets, outlierIndices: master.outlierIndices };
}

export function calibrateExtension(anatomies: readonly FaceAnatomy[], master: HeadMaster, maximumCorrection = .08, microAdjustment = .02, referenceAnatomies: readonly FaceAnatomy[] = []): { adjustments: SpriteAdjustment[]; metrics: QualityMetrics[]; compatibility: CompatibilityMetrics; trioTargets: Array<{ width: number; height: number }>; outlierIndices: number[] } {
  const widths = anatomies.map((anatomy) => anatomy.width); const heights = anatomies.map((anatomy) => anatomy.height);
  const structuralWidths = anatomies.map((anatomy) => Math.max(1, anatomy.structuralBounds.width));
  const sourceWidth = median(structuralWidths); const sourceHeight = median(heights);
  const rawGlobalX = master.structuralWidth / Math.max(1, sourceWidth); const rawGlobalY = master.height / Math.max(1, sourceHeight);
  const globalX = clamp(rawGlobalX, 1 - maximumCorrection, 1 + maximumCorrection); const globalY = clamp(rawGlobalY, 1 - maximumCorrection, 1 + maximumCorrection);
  const trioTargets = Array.from({ length: 7 }, (_, column) => {
    const indices = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    const usable = usableForTrio(anatomies, indices); const source = usable.length ? usable : indices;
    return { width: median(source.map((index) => anatomies[index].width)), height: median(source.map((index) => anatomies[index].height)) };
  });
  const trioFrames = Array.from({ length: 7 }, (_, column) => {
    const indices = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    return medianFrame(anatomies, indices);
  });
  const adjustments = anatomies.map((anatomy, index) => {
    const paired = referenceAnatomies[index];
    // Expressions can change the visible eyes/mouth, so the pair is aligned
    // using only the stable structure: cranium, jaw/neck silhouette and the
    // structural top-to-bottom span. The neck anchor remains the compositor's
    // positional reference; these values only correct framing scale.
    const anatomyStructuralHeight = Math.max(1, anatomy.structuralBottom - anatomy.structuralTop + 1);
    const targetStructuralHeight = paired ? Math.max(1, paired.structuralBottom - paired.structuralTop + 1) : trioTargets[index % 7].height;
    const targetCranialWidth = paired ? paired.cranialWidth * .78 + master.width * .22 : trioTargets[index % 7].width;
    const targetFrame = paired ? blendFrame(frameOf(paired), master, .78) : blendFrame(trioFrames[index % 7], master, .78);
    const sourceFrame = frameOf(anatomy);
    const pairedSideScale = sideScale(sourceFrame, targetFrame);
    const targetHeight = paired ? targetStructuralHeight * .78 + master.height * .22 : targetStructuralHeight;
    const pairedX = clamp(pairedSideScale * .78 + (targetCranialWidth / Math.max(1, anatomy.cranialWidth)) * .22, 1 - maximumCorrection, 1 + maximumCorrection);
    const pairedY = clamp(targetHeight / Math.max(1, paired ? anatomyStructuralHeight : anatomy.height), 1 - maximumCorrection, 1 + maximumCorrection);
    const localX = clamp(pairedX / Math.max(.001, globalX), 1 - microAdjustment, 1 + microAdjustment);
    const localY = clamp(pairedY / Math.max(.001, globalY), 1 - microAdjustment, 1 + microAdjustment);
    const scaleX = clamp(globalX * localX, 1 - maximumCorrection, 1 + maximumCorrection);
    const scaleY = clamp(globalY * localY, 1 - maximumCorrection, 1 + maximumCorrection);
    return { scale: 1, scaleX, scaleY, dx: Math.round(sideOffset(sourceFrame, targetFrame, scaleX)), dy: Math.round(targetFrame.bottom - sourceFrame.bottom * scaleY), reviewed: false };
  });
  const rawMadW = mad(widths, sourceWidth); const rawMadH = mad(heights, sourceHeight);
  const usableIndices = anatomies.map((_, index) => index).filter((index) => robustZ(widths[index], sourceWidth, rawMadW, sourceWidth * .012) <= 3.5 && robustZ(heights[index], sourceHeight, rawMadH, sourceHeight * .012) <= 3.5);
  const usable = usableIndices.length >= 12 ? usableIndices : anatomies.map((_, index) => index);
  const extraProfile = medianProfile(anatomies, usable);
  const profile = compareProfiles(extraProfile, master.profile);
  const proportionError = Math.abs(Math.log(Math.max(.001, (sourceWidth / Math.max(1, sourceHeight)) / (master.width / Math.max(1, master.height)))));
  const neckWidth = median(anatomies.map((anatomy) => anatomy.neckWidth));
  const scores = {
    size: Math.round(clamp(100 - Math.max(Math.abs(Math.log(Math.max(.001, rawGlobalX))), Math.abs(Math.log(Math.max(.001, rawGlobalY)))) * 600, 0, 100)),
    proportion: Math.round(clamp(100 - proportionError * 900, 0, 100)),
    silhouette: Math.round(clamp(100 - profile.total * 900, 0, 100)),
    jaw: Math.round(clamp(100 - compareProfiles(extraProfile, master.profile, .64, .9).total * 1000, 0, 100)),
    neck: Math.round(clamp(100 - Math.abs(Math.log(Math.max(.001, (neckWidth / Math.max(1, sourceWidth)) / (master.neckWidth / Math.max(1, master.width))))) * 900, 0, 100)),
  };
  const overall = Math.round(scores.size * .18 + scores.proportion * .18 + scores.silhouette * .3 + scores.jaw * .18 + scores.neck * .16);
  const status = overall >= 95 ? "Excelente" : overall >= 90 ? "Muito bom" : overall >= 82 ? "Aceitável" : overall >= 70 ? "Revisar" : "Incompatível";
  const compatibility = { ...scores, overall, status };
  const metrics = anatomies.map((anatomy, index) => scoreFace(anatomy, master, adjustments[index], 100, overall));
  return { adjustments, metrics, compatibility, trioTargets, outlierIndices: anatomies.map((_, index) => index).filter((index) => !usable.includes(index)) };
}
