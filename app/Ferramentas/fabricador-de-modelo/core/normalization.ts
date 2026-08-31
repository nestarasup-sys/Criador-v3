import type { CompatibilityMetrics, FaceAnatomy, HeadMaster, QualityMetrics, SpriteAdjustment } from "../types/face-model";
import { clamp, mad, median, robustZ } from "../utils/statistics";
import { compareProfiles } from "./head-master";
import { scoreFace } from "./quality";

export type CalibrationOutput = { adjustments: SpriteAdjustment[]; metrics: QualityMetrics[]; trioTargets: Array<{ width: number; height: number }>; outlierIndices: number[]; compatibility?: CompatibilityMetrics };

function usableForTrio(anatomies: readonly FaceAnatomy[], indices: number[]) {
  const widths = indices.map((index) => anatomies[index].width); const heights = indices.map((index) => anatomies[index].height);
  const widthCenter = median(widths); const heightCenter = median(heights);
  const widthMad = mad(widths, widthCenter); const heightMad = mad(heights, heightCenter);
  return indices.filter((index) => robustZ(anatomies[index].width, widthCenter, widthMad, widthCenter * .012) <= 3.5 && robustZ(anatomies[index].height, heightCenter, heightMad, heightCenter * .012) <= 3.5);
}

export function calibratePrimary(anatomies: readonly FaceAnatomy[], master: HeadMaster, maximumCorrection = .07): CalibrationOutput {
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
    const target = trioTargets[index % 7];
    return { scaleX: clamp(target.width / Math.max(1, anatomy.width), 1 - maximumCorrection, 1 + maximumCorrection), scaleY: clamp(target.height / Math.max(1, anatomy.height), 1 - maximumCorrection, 1 + maximumCorrection), dx: 0, dy: 0, reviewed: false };
  });
  const metrics = anatomies.map((anatomy, index) => scoreFace(anatomy, master, adjustments[index], 100 - Math.max(Math.abs(anatomy.width - globalWidth) / Math.max(1, globalWidth), Math.abs(anatomy.height - globalHeight) / Math.max(1, globalHeight)) * 100));
  return { adjustments, metrics, trioTargets, outlierIndices: master.outlierIndices };
}

export function calibrateExtension(anatomies: readonly FaceAnatomy[], master: HeadMaster, maximumCorrection = .08, microAdjustment = .02): { adjustments: SpriteAdjustment[]; metrics: QualityMetrics[]; compatibility: CompatibilityMetrics; trioTargets: Array<{ width: number; height: number }>; outlierIndices: number[] } {
  const widths = anatomies.map((anatomy) => anatomy.width); const heights = anatomies.map((anatomy) => anatomy.height);
  const sourceWidth = median(widths); const sourceHeight = median(heights);
  const rawGlobalX = master.width / Math.max(1, sourceWidth); const rawGlobalY = master.height / Math.max(1, sourceHeight);
  const globalX = clamp(rawGlobalX, 1 - maximumCorrection, 1 + maximumCorrection); const globalY = clamp(rawGlobalY, 1 - maximumCorrection, 1 + maximumCorrection);
  const trioTargets = Array.from({ length: 7 }, (_, column) => {
    const indices = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    const usable = usableForTrio(anatomies, indices); const source = usable.length ? usable : indices;
    return { width: median(source.map((index) => anatomies[index].width)), height: median(source.map((index) => anatomies[index].height)) };
  });
  const adjustments = anatomies.map((anatomy, index) => ({ scaleX: globalX * clamp(trioTargets[index % 7].width / Math.max(1, anatomy.width), 1 - microAdjustment, 1 + microAdjustment), scaleY: globalY * clamp(trioTargets[index % 7].height / Math.max(1, anatomy.height), 1 - microAdjustment, 1 + microAdjustment), dx: 0, dy: 0, reviewed: false }));
  const profile = compareProfiles(anatomies[0]?.profile ?? [], master.profile);
  const proportionError = Math.abs(Math.log(Math.max(.001, (sourceWidth / Math.max(1, sourceHeight)) / (master.width / Math.max(1, master.height)))));
  const neckWidth = median(anatomies.map((anatomy) => anatomy.neckWidth));
  const scores = {
    size: Math.round(clamp(100 - Math.max(Math.abs(Math.log(Math.max(.001, rawGlobalX))), Math.abs(Math.log(Math.max(.001, rawGlobalY)))) * 600, 0, 100)),
    proportion: Math.round(clamp(100 - proportionError * 900, 0, 100)),
    silhouette: Math.round(clamp(100 - profile.total * 900, 0, 100)),
    jaw: Math.round(clamp(100 - compareProfiles(anatomies[0].profile, master.profile, .64, .9).total * 1000, 0, 100)),
    neck: Math.round(clamp(100 - Math.abs(Math.log(Math.max(.001, (neckWidth / Math.max(1, sourceWidth)) / (master.neckWidth / Math.max(1, master.width))))) * 900, 0, 100)),
  };
  const overall = Math.round(scores.size * .18 + scores.proportion * .18 + scores.silhouette * .3 + scores.jaw * .18 + scores.neck * .16);
  const status = overall >= 95 ? "Excelente" : overall >= 90 ? "Muito bom" : overall >= 82 ? "Aceitável" : overall >= 70 ? "Revisar" : "Incompatível";
  const compatibility = { ...scores, overall, status };
  const metrics = anatomies.map((anatomy, index) => scoreFace(anatomy, master, adjustments[index], 100, overall));
  return { adjustments, metrics, compatibility, trioTargets, outlierIndices: [] };
}
