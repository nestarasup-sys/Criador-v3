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
  const adjustments = anatomies.map((anatomy, index) => {
    const trio = trioTargets[index % 7];
    const target = { width: trio.width * strength + globalWidth * (1 - strength), height: trio.height * strength + globalHeight * (1 - strength) };
    return { scale: 1, scaleX: clamp(target.width / Math.max(1, anatomy.width), 1 - maximumCorrection, 1 + maximumCorrection), scaleY: clamp(target.height / Math.max(1, anatomy.height), 1 - maximumCorrection, 1 + maximumCorrection), dx: 0, dy: 0, reviewed: false };
  });
  const metrics = anatomies.map((anatomy, index) => scoreFace(anatomy, master, adjustments[index], 100 - Math.max(Math.abs(anatomy.width - globalWidth) / Math.max(1, globalWidth), Math.abs(anatomy.height - globalHeight) / Math.max(1, globalHeight)) * 100));
  return { adjustments, metrics, trioTargets, outlierIndices: master.outlierIndices };
}

export function calibrateExtension(anatomies: readonly FaceAnatomy[], master: HeadMaster, maximumCorrection = .08, microAdjustment = .02, referenceAnatomies: readonly FaceAnatomy[] = []): { adjustments: SpriteAdjustment[]; metrics: QualityMetrics[]; compatibility: CompatibilityMetrics; trioTargets: Array<{ width: number; height: number }>; outlierIndices: number[] } {
  const widths = anatomies.map((anatomy) => anatomy.width); const heights = anatomies.map((anatomy) => anatomy.height);
  const sourceWidth = median(widths); const sourceHeight = median(heights);
  const rawGlobalX = master.width / Math.max(1, sourceWidth); const rawGlobalY = master.height / Math.max(1, sourceHeight);
  const globalX = clamp(rawGlobalX, 1 - maximumCorrection, 1 + maximumCorrection); const globalY = clamp(rawGlobalY, 1 - maximumCorrection, 1 + maximumCorrection);
  const trioTargets = Array.from({ length: 7 }, (_, column) => {
    const indices = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    const usable = usableForTrio(anatomies, indices); const source = usable.length ? usable : indices;
    return { width: median(source.map((index) => anatomies[index].width)), height: median(source.map((index) => anatomies[index].height)) };
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
    const targetHeight = paired ? targetStructuralHeight * .78 + master.height * .22 : targetStructuralHeight;
    const pairedX = clamp(targetCranialWidth / Math.max(1, anatomy.cranialWidth), 1 - maximumCorrection, 1 + maximumCorrection);
    const pairedY = clamp(targetHeight / Math.max(1, paired ? anatomyStructuralHeight : anatomy.height), 1 - maximumCorrection, 1 + maximumCorrection);
    const localX = clamp(pairedX / Math.max(.001, globalX), 1 - microAdjustment, 1 + microAdjustment);
    const localY = clamp(pairedY / Math.max(.001, globalY), 1 - microAdjustment, 1 + microAdjustment);
    return { scale: 1, scaleX: clamp(globalX * localX, 1 - maximumCorrection, 1 + maximumCorrection), scaleY: clamp(globalY * localY, 1 - maximumCorrection, 1 + maximumCorrection), dx: 0, dy: 0, reviewed: false };
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
