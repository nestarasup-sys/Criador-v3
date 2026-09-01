import type { FaceAnatomy, HeadMaster, StructuralProfilePoint } from "../types/face-model";
import { mad, median, robustZ, std, mean } from "../utils/statistics";

function medianProfile(anatomies: readonly FaceAnatomy[], indices: readonly number[]): StructuralProfilePoint[] {
  return Array.from({ length: 32 }, (_, index) => {
    const points = indices.map((item) => anatomies[item]?.profile[index]).filter((point): point is StructuralProfilePoint => Boolean(point && point.widthNorm > 0));
    return points.length ? { y: Math.round(median(points.map((point) => point.y))), widthNorm: median(points.map((point) => point.widthNorm)), centerOffset: median(points.map((point) => point.centerOffset)) } : { y: index, widthNorm: 0, centerOffset: 0 };
  });
}

function profileError(first: readonly StructuralProfilePoint[], second: readonly StructuralProfilePoint[]) {
  let widthError = 0; let centerError = 0; let count = 0;
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    if (!first[index].widthNorm || !second[index].widthNorm) continue;
    widthError += Math.abs(Math.log(Math.max(.001, first[index].widthNorm / second[index].widthNorm)));
    centerError += Math.abs(first[index].centerOffset - second[index].centerOffset);
    count += 1;
  }
  return count ? widthError / count + centerError / count * .45 : 1;
}

export function buildHeadMaster(anatomies: readonly FaceAnatomy[]): HeadMaster {
  if (!anatomies.length) throw new Error("Não há anatomias para construir o Head Master.");
  const widths = anatomies.map((anatomy) => anatomy.width);
  const heights = anatomies.map((anatomy) => anatomy.height);
  const widthMedian = median(widths); const heightMedian = median(heights);
  const widthMad = mad(widths, widthMedian); const heightMad = mad(heights, heightMedian);
  const outlierIndices = anatomies.map((_, index) => index).filter((index) => robustZ(widths[index], widthMedian, widthMad, widthMedian * .012) > 3.5 || robustZ(heights[index], heightMedian, heightMad, heightMedian * .012) > 3.5);
  const usableIndices = anatomies.map((_, index) => index).filter((index) => !outlierIndices.includes(index));
  const usable = usableIndices.length ? usableIndices : anatomies.map((_, index) => index);
  const structuralLeft = median(usable.map((index) => anatomies[index].structuralBounds.x - anatomies[index].neckCenterX));
  const structuralRight = median(usable.map((index) => anatomies[index].structuralBounds.x + anatomies[index].structuralBounds.width - 1 - anatomies[index].neckCenterX));
  const structuralBottom = median(usable.map((index) => anatomies[index].structuralBottom - anatomies[index].neckBaseY));
  const profile = medianProfile(anatomies, usable);
  let bestTrioColumn = 0; let bestTrioScore = Number.POSITIVE_INFINITY;
  for (let column = 0; column < Math.min(7, anatomies.length); column += 1) {
    const trio = [column, column + 7, column + 14].filter((index) => index < anatomies.length);
    const trioProfile = medianProfile(anatomies, trio);
    const score = std(trio.map((index) => anatomies[index].width)) / Math.max(1, mean(trio.map((index) => anatomies[index].width)))
      + std(trio.map((index) => anatomies[index].height)) / Math.max(1, mean(trio.map((index) => anatomies[index].height)))
      + profileError(trioProfile, profile) * 1.5;
    if (score < bestTrioScore) { bestTrioScore = score; bestTrioColumn = column; }
  }
  return {
    width: widthMedian,
    height: heightMedian,
    centerX: median(usable.map((index) => anatomies[index].centerX)),
    neckCenterX: median(usable.map((index) => anatomies[index].neckCenterX)),
    neckWidth: median(usable.map((index) => anatomies[index].neckWidth)),
    neckBaseY: median(usable.map((index) => anatomies[index].neckBaseY)),
    structuralLeft,
    structuralRight,
    structuralBottom,
    structuralWidth: Math.max(1, structuralRight - structuralLeft + 1),
    profile,
    usableIndices: usable,
    outlierIndices,
    referenceIndex: usable.reduce((best, index) => {
      const current = anatomies[index]; const candidate = anatomies[best];
      const currentDistance = Math.abs(current.width - widthMedian) + Math.abs(current.height - heightMedian) + profileError(current.profile, profile) * widthMedian;
      const bestDistance = Math.abs(candidate.width - widthMedian) + Math.abs(candidate.height - heightMedian) + profileError(candidate.profile, profile) * widthMedian;
      return currentDistance < bestDistance ? index : best;
    }, usable[0] ?? 0),
    bestTrioColumn,
    stabilityScore: Math.max(0, Math.min(100, 100 - bestTrioScore * 500)),
  };
}

export function compareProfiles(first: readonly StructuralProfilePoint[], second: readonly StructuralProfilePoint[], start = 0, end = 1) {
  let width = 0; let center = 0; let count = 0;
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    const ratio = index / Math.max(1, first.length - 1);
    if (ratio < start || ratio > end || !first[index].widthNorm || !second[index].widthNorm) continue;
    width += Math.abs(Math.log(Math.max(.001, first[index].widthNorm / second[index].widthNorm)));
    center += Math.abs(first[index].centerOffset - second[index].centerOffset);
    count += 1;
  }
  return count ? { width: width / count, center: center / count, total: width / count + center / count * .45 } : { width: 1, center: 1, total: 1 };
}
