export const STRUCTURAL_LANDMARKS = ["top", "left", "right", "chin", "neckLeft", "neckRight"];

export function solveWeightedSimilarity(source, target) {
  const pairs = source.map((point) => ({ source: point, target: target.find((candidate) => candidate.name === point.name) })).filter((pair) => pair.target && pair.source.enabled !== false && pair.target.enabled !== false);
  if (pairs.length < 2) return { a: 1, b: 0, tx: 0, ty: 0, scale: 1, rotation: 0, rms: Infinity };
  const totalWeight = pairs.reduce((sum, pair) => sum + Math.max(0.001, pair.source.weight ?? 1), 0);
  const centroid = (side) => ({
    x: pairs.reduce((sum, pair) => sum + pair[side].x * Math.max(0.001, pair.source.weight ?? 1), 0) / totalWeight,
    y: pairs.reduce((sum, pair) => sum + pair[side].y * Math.max(0.001, pair.source.weight ?? 1), 0) / totalWeight,
  });
  const sourceCenter = centroid("source");
  const targetCenter = centroid("target");
  let dot = 0;
  let cross = 0;
  let denominator = 0;
  for (const pair of pairs) {
    const weight = Math.max(0.001, pair.source.weight ?? 1);
    const sx = pair.source.x - sourceCenter.x;
    const sy = pair.source.y - sourceCenter.y;
    const tx = pair.target.x - targetCenter.x;
    const ty = pair.target.y - targetCenter.y;
    dot += weight * (sx * tx + sy * ty);
    cross += weight * (sx * ty - sy * tx);
    denominator += weight * (sx * sx + sy * sy);
  }
  if (denominator < 1e-8) return { a: 1, b: 0, tx: targetCenter.x - sourceCenter.x, ty: targetCenter.y - sourceCenter.y, scale: 1, rotation: 0, rms: Infinity };
  const a = dot / denominator;
  const b = cross / denominator;
  const tx = targetCenter.x - a * sourceCenter.x + b * sourceCenter.y;
  const ty = targetCenter.y - b * sourceCenter.x - a * sourceCenter.y;
  const transform = { a, b, tx, ty, scale: Math.hypot(a, b), rotation: Math.atan2(b, a) * 180 / Math.PI };
  const error = pairs.reduce((sum, pair) => {
    const mapped = applyTransform(pair.source, transform);
    return sum + (mapped.x - pair.target.x) ** 2 + (mapped.y - pair.target.y) ** 2;
  }, 0);
  return { ...transform, rms: Math.sqrt(error / pairs.length) };
}

export function applyTransform(point, transform) {
  return { x: transform.a * point.x - transform.b * point.y + transform.tx, y: transform.b * point.x + transform.a * point.y + transform.ty };
}

export function invertTransform(transform) {
  const determinant = transform.a * transform.a + transform.b * transform.b;
  if (determinant < 1e-10) return { a: 1, b: 0, tx: 0, ty: 0 };
  const a = transform.a / determinant;
  const b = -transform.b / determinant;
  return { a, b, tx: -a * transform.tx + b * transform.ty, ty: -b * transform.tx - a * transform.ty };
}

export function localSourceAt(targetPoint, sourcePoints, targetPoints, radius = 80) {
  let sumWeight = 0;
  let dx = 0;
  let dy = 0;
  for (const target of targetPoints) {
    const source = sourcePoints.find((point) => point.name === target.name);
    if (!source || source.kind !== "detail" || source.enabled === false || target.enabled === false) continue;
    const distanceSquared = (targetPoint.x - target.x) ** 2 + (targetPoint.y - target.y) ** 2;
    const weight = 1 / Math.max(16, distanceSquared / Math.max(0.2, radius / 80));
    sumWeight += weight;
    dx += (source.x - target.x) * weight;
    dy += (source.y - target.y) * weight;
  }
  if (!sumWeight) return { ...targetPoint };
  return { x: targetPoint.x + dx / sumWeight, y: targetPoint.y + dy / sumWeight };
}
