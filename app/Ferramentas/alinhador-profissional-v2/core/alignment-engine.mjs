export const STRUCTURAL_LANDMARKS = ["top", "left", "right", "chin", "neckLeft", "neckRight"];

function matchedPairs(source, target) {
  return source.map((point) => ({ source: point, target: target.find((candidate) => candidate.name === point.name) })).filter((pair) => pair.target && pair.source.enabled !== false && pair.target.enabled !== false);
}

function matrixSolve3(matrix, values) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-10) return [1, 0, 0];
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j < 4; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < 3; row += 1) if (row !== column) {
      const factor = augmented[row][column];
      for (let j = column; j < 4; j += 1) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

function residualFor(pairs, transform) {
  const errors = pairs.map((pair) => {
    const mapped = applyTransform(pair.source, transform);
    return { name: pair.source.name, kind: pair.source.kind ?? "unknown", distance: Math.hypot(mapped.x - pair.target.x, mapped.y - pair.target.y), source: pair.source, target: pair.target };
  });
  const rms = errors.length ? Math.sqrt(errors.reduce((sum, item) => sum + item.distance ** 2, 0) / errors.length) : Infinity;
  return { rms, max: errors.length ? Math.max(...errors.map((item) => item.distance)) : Infinity, errors };
}

export function solveWeightedSimilarity(source, target) {
  const pairs = matchedPairs(source, target);
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
  const transform = { a, b, c: -b, d: a, tx, ty, scale: Math.hypot(a, b), scaleX: Math.hypot(a, b), scaleY: Math.hypot(a, b), rotation: Math.atan2(b, a) * 180 / Math.PI };
  return { ...transform, ...residualFor(pairs, transform) };
}

export function solveAlignment(source, target, mode = "similarity") {
  const pairs = matchedPairs(source, target);
  if (mode === "affine" && pairs.length >= 3) {
    let xx = 0; let xy = 0; let x1 = 0; let yy = 0; let y1 = 0; let one = 0; let tx = 0; let ty = 0; let ux = 0; let uy = 0;
    for (const pair of pairs) { const weight = Math.max(0.001, pair.source.weight ?? 1); const x = pair.source.x; const y = pair.source.y; const targetX = pair.target.x; const targetY = pair.target.y; xx += weight * x * x; xy += weight * x * y; x1 += weight * x; yy += weight * y * y; y1 += weight * y; one += weight; tx += weight * x * targetX; ty += weight * y * targetX; ux += weight * targetY * x; uy += weight * targetY * y; }
    const matrix = [[xx, xy, x1], [xy, yy, y1], [x1, y1, one]];
    const [a, c, e] = matrixSolve3(matrix, [tx, ty, pairs.reduce((sum, pair) => sum + Math.max(0.001, pair.source.weight ?? 1) * pair.target.x, 0)]);
    const [b, d, f] = matrixSolve3(matrix, [ux, uy, pairs.reduce((sum, pair) => sum + Math.max(0.001, pair.source.weight ?? 1) * pair.target.y, 0)]);
    const transform = { a, b, c, d, tx: e, ty: f, scale: Math.sqrt(Math.abs(a * d - b * c)), scaleX: Math.hypot(a, b), scaleY: Math.hypot(c, d), rotation: Math.atan2(b, a) * 180 / Math.PI };
    return { ...transform, ...residualFor(pairs, transform) };
  }
  const similarity = solveWeightedSimilarity(source, target);
  if (mode !== "rigid" || !pairs.length) return similarity;
  const angle = similarity.rotation * Math.PI / 180; const a = Math.cos(angle); const b = Math.sin(angle); const sourceCenter = { x: pairs.reduce((sum, pair) => sum + pair.source.x, 0) / pairs.length, y: pairs.reduce((sum, pair) => sum + pair.source.y, 0) / pairs.length }; const targetCenter = { x: pairs.reduce((sum, pair) => sum + pair.target.x, 0) / pairs.length, y: pairs.reduce((sum, pair) => sum + pair.target.y, 0) / pairs.length };
  const transform = { a, b, c: -b, d: a, tx: targetCenter.x - a * sourceCenter.x + b * sourceCenter.y, ty: targetCenter.y - b * sourceCenter.x - a * sourceCenter.y, scale: 1, scaleX: 1, scaleY: 1, rotation: similarity.rotation };
  return { ...transform, ...residualFor(pairs, transform) };
}

export function applyTransform(point, transform) {
  return { x: transform.a * point.x + (transform.c ?? -transform.b) * point.y + transform.tx, y: transform.b * point.x + (transform.d ?? transform.a) * point.y + transform.ty };
}

export function invertTransform(transform) {
  const c = transform.c ?? -transform.b; const d = transform.d ?? transform.a; const determinant = transform.a * d - transform.b * c;
  if (Math.abs(determinant) < 1e-10) return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const a = d / determinant; const b = -transform.b / determinant; const inverseC = -c / determinant; const inverseD = transform.a / determinant;
  return { a, b, c: inverseC, d: inverseD, tx: -a * transform.tx - inverseC * transform.ty, ty: -b * transform.tx - inverseD * transform.ty };
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
