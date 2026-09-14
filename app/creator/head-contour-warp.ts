import type { HeadContourWarp, HeadContourWarpKnot, ItemTransform } from "../domain/character-primitives";
import type { HeadContourRow, HeadMeasurement } from "./head-fit";

const SAMPLE_COUNT = 41;
const MAX_VERTICAL_DRIFT = 0.13;
const MAX_SIDE_DISPLACEMENT = 0.09;
const MIN_IMPROVEMENT = 0.12;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function movingMedian(values: number[], radius = 2) {
  return values.map((_, index) => median(values.slice(Math.max(0, index - radius), index + radius + 1)));
}

function contourAtY(measurement: HeadMeasurement, y: number) {
  const rows = measurement.contour?.filter((row) => row.right > row.left) ?? [];
  if (rows.length < 2) return null;
  let lower = rows[0];
  let upper = rows[rows.length - 1];
  for (const row of rows) {
    if (row.y <= y) lower = row;
    if (row.y >= y) {
      upper = row;
      break;
    }
  }
  const span = upper.y - lower.y;
  const ratio = span > 0 ? (y - lower.y) / span : 0;
  const left = lower.left + (upper.left - lower.left) * ratio;
  const right = lower.right + (upper.right - lower.right) * ratio;
  return { left, right, center: (left + right) / 2, width: Math.max(1, right - left) };
}

function contourRowsAtY(rows: HeadContourRow[], y: number) {
  if (rows.length < 2) return null;
  let lower = rows[0];
  let upper = rows[rows.length - 1];
  for (const row of rows) {
    if (row.y <= y) lower = row;
    if (row.y >= y) {
      upper = row;
      break;
    }
  }
  const span = upper.y - lower.y;
  const ratio = span > 0 ? (y - lower.y) / span : 0;
  const left = lower.left + (upper.left - lower.left) * ratio;
  const right = lower.right + (upper.right - lower.right) * ratio;
  return { left, right, width: Math.max(1, right - left), center: (left + right) / 2 };
}

function structuralBottom(measurement: HeadMeasurement) {
  return measurement.neckY ?? measurement.bottom;
}

type ProfileSample = { y: number; left: number; right: number; width: number; center: number };

function normalizedProfile(measurement: HeadMeasurement): ProfileSample[] | null {
  const bottom = structuralBottom(measurement);
  const span = bottom - measurement.top;
  if (span < 12 || !measurement.contour?.length) return null;
  const raw = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const y = measurement.top + span * (index / (SAMPLE_COUNT - 1));
    const row = contourAtY(measurement, y);
    return row ? { y, ...row } : null;
  });
  if (raw.filter(Boolean).length < SAMPLE_COUNT * 0.8) return null;
  const usable = raw.map((sample, index) => sample ?? raw.slice(0, index).reverse().find(Boolean) ?? raw.slice(index).find(Boolean)) as ProfileSample[];
  const left = movingMedian(usable.map((sample) => sample.left));
  const right = movingMedian(usable.map((sample) => sample.right));
  return usable.map((sample, index) => ({
    y: sample.y,
    left: left[index],
    right: right[index],
    width: Math.max(1, right[index] - left[index]),
    center: (left[index] + right[index]) / 2,
  }));
}

/**
 * Alinha a posição vertical das curvas externas com DTW limitado. O limite
 * impede que uma bochecha artisticamente diferente arraste olhos/boca para
 * outra altura; esta correspondência só será usada nas faixas laterais.
 */
function matchVerticalProfile(source: ProfileSample[], target: ProfileSample[]) {
  const count = source.length;
  const band = Math.max(2, Math.round((count - 1) * MAX_VERTICAL_DRIFT));
  const sourceWidth = median(source.slice(5, 32).map((sample) => sample.width));
  const targetWidth = median(target.slice(5, 32).map((sample) => sample.width));
  const sourceCenter = median(source.map((sample) => sample.center));
  const targetCenter = median(target.map((sample) => sample.center));
  const costs = Array.from({ length: count }, () => new Array<number>(count).fill(Infinity));
  const previous = Array.from({ length: count }, () => new Array<[number, number] | null>(count).fill(null));
  costs[0][0] = 0;
  for (let targetIndex = 0; targetIndex < count; targetIndex += 1) {
    for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
      if (Math.abs(targetIndex - sourceIndex) > band || (targetIndex === 0 && sourceIndex === 0)) continue;
      const widthCost = Math.abs(source[sourceIndex].width / sourceWidth - target[targetIndex].width / targetWidth);
      const centerCost = Math.abs(
        (source[sourceIndex].center - sourceCenter) / sourceWidth
        - (target[targetIndex].center - targetCenter) / targetWidth,
      );
      const localCost = widthCost + centerCost * 0.35;
      const options: Array<{ y: number; x: number; penalty: number }> = [
        { y: targetIndex - 1, x: sourceIndex - 1, penalty: 0 },
        { y: targetIndex - 1, x: sourceIndex, penalty: 0.018 },
        { y: targetIndex, x: sourceIndex - 1, penalty: 0.018 },
      ].filter((entry) => entry.y >= 0 && entry.x >= 0);
      const best = options.sort((left, right) => costs[left.y][left.x] + left.penalty - costs[right.y][right.x] - right.penalty)[0];
      if (!best || !Number.isFinite(costs[best.y][best.x])) continue;
      costs[targetIndex][sourceIndex] = costs[best.y][best.x] + best.penalty + localCost;
      previous[targetIndex][sourceIndex] = [best.y, best.x];
    }
  }

  const matches = Array.from({ length: count }, () => [] as number[]);
  let cursor: [number, number] | null = [count - 1, count - 1];
  while (cursor) {
    matches[cursor[0]].push(cursor[1]);
    cursor = previous[cursor[0]][cursor[1]];
  }
  const mapped = matches.map((indices, index) => indices.length ? median(indices) : index);
  const smooth = movingMedian(mapped, 2);
  smooth[0] = 0;
  smooth[count - 1] = count - 1;
  for (let index = 1; index < count; index += 1) smooth[index] = Math.max(smooth[index], smooth[index - 1]);
  return smooth;
}

function localCoordinateX(sceneX: number, transform: ItemTransform, item: { width: number; defaultX?: number }) {
  const scaleX = transform.scale * transform.scaleX * (transform.flipX ? -1 : 1);
  const centerX = item.defaultX ?? item.width / 2;
  return item.width / 2 + (sceneX - centerX - transform.x) / scaleX;
}

function localCoordinateY(sceneY: number, transform: ItemTransform, item: { height: number; defaultY?: number }) {
  const scaleY = transform.scale * transform.scaleY;
  const centerY = item.defaultY ?? item.height / 2;
  return item.height / 2 + (sceneY - centerY - transform.y) / scaleY;
}

export function buildHeadContourWarp(
  source: HeadMeasurement,
  target: HeadMeasurement,
  item: { width: number; height: number; defaultX?: number; defaultY?: number },
  transform: ItemTransform,
): HeadContourWarp | null {
  if (Math.abs(transform.rotation) > 0.25 || transform.flipX) return null;
  const sourceProfile = normalizedProfile(source);
  const targetProfile = normalizedProfile(target);
  if (!sourceProfile || !targetProfile) return null;
  const verticalMatches = matchVerticalProfile(sourceProfile, targetProfile);
  const sourceSpan = structuralBottom(source) - source.top;
  const maxSideShift = Math.max(2, source.width * MAX_SIDE_DISPLACEMENT);
  const knots: HeadContourWarpKnot[] = [];
  let baselineError = 0;
  let candidateError = 0;
  let maxDisplacement = 0;

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const targetSample = targetProfile[index];
    const sourcePosition = verticalMatches[index];
    const sourceIndex = clamp(Math.round(sourcePosition), 0, SAMPLE_COUNT - 1);
    const sourceSample = sourceProfile[sourceIndex];
    const targetLeft = localCoordinateX(targetSample.left, transform, item);
    const targetRight = localCoordinateX(targetSample.right, transform, item);
    const y = localCoordinateY(targetSample.y, transform, item);
    const rawLeftShift = targetLeft - sourceSample.left;
    const rawRightShift = targetRight - sourceSample.right;
    const leftShift = clamp(rawLeftShift, -maxSideShift, maxSideShift);
    const rightShift = clamp(rawRightShift, -maxSideShift, maxSideShift);
    const fade = index >= SAMPLE_COUNT * 0.82
      ? clamp((SAMPLE_COUNT - 1 - index) / (SAMPLE_COUNT * 0.18), 0, 1)
      : 1;
    const strength = 0.9 * fade;
    let safeTargetLeft = sourceSample.left + leftShift;
    let safeTargetRight = sourceSample.right + rightShift;
    const requestedWidth = safeTargetRight - safeTargetLeft;
    const safeWidth = clamp(requestedWidth, sourceSample.width * 0.75, sourceSample.width * 1.3);
    if (Math.abs(safeWidth - requestedWidth) > 0.001) {
      const requestedCenter = (safeTargetLeft + safeTargetRight) / 2;
      safeTargetLeft = requestedCenter - safeWidth / 2;
      safeTargetRight = requestedCenter + safeWidth / 2;
    }
    const finalLeft = sourceSample.left + (safeTargetLeft - sourceSample.left) * strength;
    const finalRight = sourceSample.right + (safeTargetRight - sourceSample.right) * strength;
    const norm = Math.max(1, sourceSample.width);
    baselineError += (Math.abs(rawLeftShift) + Math.abs(rawRightShift)) / norm;
    candidateError += (Math.abs(targetLeft - finalLeft) + Math.abs(targetRight - finalRight)) / norm;
    maxDisplacement = Math.max(maxDisplacement, Math.abs(leftShift * strength), Math.abs(rightShift * strength));
    knots.push({
      y,
      sourceY: source.top + sourceSpan * (sourcePosition / (SAMPLE_COUNT - 1)),
      sourceLeft: sourceSample.left,
      sourceRight: sourceSample.right,
      targetLeft: safeTargetLeft,
      targetRight: safeTargetRight,
      strength,
    });
  }

  const smoothedSourceY = movingMedian(knots.map((knot) => knot.sourceY), 1);
  const smoothedTargetLeft = movingMedian(knots.map((knot) => knot.targetLeft), 1);
  const smoothedTargetRight = movingMedian(knots.map((knot) => knot.targetRight), 1);
  smoothedSourceY[0] = source.top;
  smoothedSourceY[smoothedSourceY.length - 1] = structuralBottom(source);
  for (let index = 1; index < smoothedSourceY.length; index += 1) {
    smoothedSourceY[index] = Math.max(smoothedSourceY[index], smoothedSourceY[index - 1]);
  }
  knots.forEach((knot, index) => {
    knot.sourceY = smoothedSourceY[index];
    knot.targetLeft = smoothedTargetLeft[index];
    knot.targetRight = smoothedTargetRight[index];
  });

  baselineError /= SAMPLE_COUNT;
  candidateError /= SAMPLE_COUNT;
  const improvement = baselineError > 0 ? (baselineError - candidateError) / baselineError : 0;
  const cappedRows = knots.filter((knot) => (
    Math.abs(knot.targetLeft - knot.sourceLeft) >= maxSideShift * 0.98
    || Math.abs(knot.targetRight - knot.sourceRight) >= maxSideShift * 0.98
  )).length;
  const confidence = clamp(1 - cappedRows / SAMPLE_COUNT * 0.75, 0, 1);
  // Diferenças subpixel surgem da interpolação e da suavização mesmo quando
  // os dois contornos são equivalentes. Não grave nem renderize um warp que
  // seria visualmente neutro: além de evitar trabalho, isso impede shimmer.
  if (baselineError < 0.006 || maxDisplacement < 1.5) return null;
  if (improvement < MIN_IMPROVEMENT || confidence < 0.55) return null;
  return {
    version: 1,
    top: knots[0].y,
    bottom: knots[knots.length - 1].y,
    confidence: +confidence.toFixed(4),
    baselineError: +baselineError.toFixed(5),
    candidateError: +candidateError.toFixed(5),
    improvement: +improvement.toFixed(4),
    maxDisplacement: +maxDisplacement.toFixed(2),
    knots: knots.map((knot) => Object.fromEntries(
      Object.entries(knot).map(([key, value]) => [key, typeof value === "number" ? +value.toFixed(3) : value]),
    ) as unknown as HeadContourWarpKnot),
  };
}

/**
 * Corrige somente a curva da faixa cervical. A transformação global já
 * encaixa a largura mediana; este resíduo resolve inclinação/assimetria sem
 * deslocar novamente o topo da cabeça nem abrir uma costura na gola.
 */
export function buildNeckContourWarp(
  source: HeadMeasurement,
  target: HeadMeasurement,
  item: { width: number; height: number; defaultX?: number; defaultY?: number },
  transform: ItemTransform,
  options: { mode?: "default" | "balanced-neck" } = {},
): HeadContourWarp | null {
  if (Math.abs(transform.rotation) > 0.25 || transform.flipX) return null;
  const sourceRows = source.neckContour?.filter((row) => row.right > row.left) ?? [];
  const targetRows = target.neckContour?.filter((row) => row.right > row.left) ?? [];
  if (sourceRows.length < 5 || targetRows.length < 5) return null;
  const sourceTop = sourceRows[0].y;
  const sourceBottom = sourceRows[sourceRows.length - 1].y;
  const targetTop = targetRows[0].y;
  const targetBottom = targetRows[targetRows.length - 1].y;
  if (sourceBottom - sourceTop < 4 || targetBottom - targetTop < 4) return null;
  // O encaixe global alinha a entrada do pescoço, mas uma roupa pode ter uma
  // faixa cervical muito mais comprida que a do modelo. Nesse caso, a última
  // linha desejada do pescoço volta para o espaço local da roupa antes de o
  // warp ser renderizado; o restante recebe uma transição suave até voltar à
  // imagem original. Isso comprime somente a região cervical, sem levantar o
  // corpo inteiro nem mexer no envelope dos pés.
  const targetBottomInSourceSpace = localCoordinateY(targetBottom, transform, item);
  const verticalCompression = targetBottomInSourceSpace < sourceBottom - 2;

  const count = 15;
  const sourceNeckWidth = source.neckWidth ?? sourceRows[0].right - sourceRows[0].left;
  const balancedNeck = options.mode === "balanced-neck";
  // Em roupas com gola ou armadura, a largura cervical pode divergir muito
  // da cabeça. Nesse modo a escala global preserva a cabeça/corpo e este warp
  // recebe autorização para corrigir a faixa local com mais liberdade. O
  // limite continua finito para impedir que um landmark ruim deforme a roupa
  // inteira.
  const maxSideShift = Math.max(1.5, sourceNeckWidth * (balancedNeck ? 0.34 : 0.14));
  const knots: HeadContourWarpKnot[] = [];
  let baselineError = 0;
  let candidateError = 0;
  let maxDisplacement = 0;
  const verticalSpan = Math.max(1, sourceBottom - sourceTop);
  let cappedRows = 0;
  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    const sourceY = sourceTop + (sourceBottom - sourceTop) * ratio;
    const targetY = targetTop + (targetBottom - targetTop) * ratio;
    const sourceSample = contourRowsAtY(sourceRows, sourceY);
    const targetSample = contourRowsAtY(targetRows, targetY);
    if (!sourceSample || !targetSample) continue;
    const targetLeft = localCoordinateX(targetSample.left, transform, item);
    const targetRight = localCoordinateX(targetSample.right, transform, item);
    const outputY = localCoordinateY(targetY, transform, item);
    const rawLeftShift = targetLeft - sourceSample.left;
    const rawRightShift = targetRight - sourceSample.right;
    const leftShift = clamp(rawLeftShift, -maxSideShift, maxSideShift);
    const rightShift = clamp(rawRightShift, -maxSideShift, maxSideShift);
    if (Math.abs(rawLeftShift) > maxSideShift || Math.abs(rawRightShift) > maxSideShift) cappedRows += 1;
    const edgeFade = Math.sin(Math.PI * ratio);
    // Quando há encurtamento, não desfaça a correção justamente na base do
    // pescoço. O fade acontece depois dela, no trecho de transição abaixo.
    const strength = verticalCompression
      ? (index === 0 ? 0 : 0.88)
      : edgeFade * 0.88;
    let safeLeft = sourceSample.left + leftShift;
    let safeRight = sourceSample.right + rightShift;
    const requestedWidth = safeRight - safeLeft;
    const safeWidth = clamp(
      requestedWidth,
      sourceSample.width * (balancedNeck ? 0.58 : 0.82),
      sourceSample.width * (balancedNeck ? 1.5 : 1.2),
    );
    if (Math.abs(requestedWidth - safeWidth) > 0.001) {
      const center = (safeLeft + safeRight) / 2;
      safeLeft = center - safeWidth / 2;
      safeRight = center + safeWidth / 2;
    }
    const finalLeft = sourceSample.left + (safeLeft - sourceSample.left) * strength;
    const finalRight = sourceSample.right + (safeRight - sourceSample.right) * strength;
    const norm = Math.max(1, sourceSample.width);
    const verticalShift = Math.abs(sourceY - outputY);
    baselineError += (Math.abs(rawLeftShift) + Math.abs(rawRightShift)) / norm
      + verticalShift / verticalSpan;
    candidateError += (Math.abs(targetLeft - finalLeft) + Math.abs(targetRight - finalRight)) / norm;
    maxDisplacement = Math.max(
      maxDisplacement,
      Math.abs(finalLeft - sourceSample.left),
      Math.abs(finalRight - sourceSample.right),
      verticalShift,
    );
    knots.push({
      y: outputY,
      sourceY,
      sourceLeft: sourceSample.left,
      sourceRight: sourceSample.right,
      targetLeft: safeLeft,
      targetRight: safeRight,
      strength,
    });
  }
  if (knots.length < count * 0.8) return null;
  if (verticalCompression && sourceBottom > knots[knots.length - 1].y + 1) {
    const lastSourceRow = sourceRows[sourceRows.length - 1];
    knots.push({
      y: sourceBottom,
      sourceY: sourceBottom,
      sourceLeft: lastSourceRow.left,
      sourceRight: lastSourceRow.right,
      targetLeft: lastSourceRow.left,
      targetRight: lastSourceRow.right,
      strength: 0,
    });
  }
  baselineError /= knots.length;
  candidateError /= knots.length;
  const improvement = baselineError > 0 ? (baselineError - candidateError) / baselineError : 0;
  const confidence = clamp(1 - cappedRows / knots.length * 0.8, 0, 1);
  if (baselineError < 0.006 || maxDisplacement < 1 || improvement < MIN_IMPROVEMENT || confidence < 0.55) return null;
  return {
    version: 1,
    top: knots[0].y,
    bottom: knots[knots.length - 1].y,
    confidence: +confidence.toFixed(4),
    baselineError: +baselineError.toFixed(5),
    candidateError: +candidateError.toFixed(5),
    improvement: +improvement.toFixed(4),
    maxDisplacement: +maxDisplacement.toFixed(2),
    knots: knots.map((knot) => ({
      y: +knot.y.toFixed(3),
      sourceY: +knot.sourceY.toFixed(3),
      sourceLeft: +knot.sourceLeft.toFixed(3),
      sourceRight: +knot.sourceRight.toFixed(3),
      targetLeft: +knot.targetLeft.toFixed(3),
      targetRight: +knot.targetRight.toFixed(3),
      strength: +knot.strength.toFixed(3),
    })),
  };
}

export function mergeContourWarps(...warps: Array<HeadContourWarp | null | undefined>): HeadContourWarp | null {
  const available = warps.filter((warp): warp is HeadContourWarp => Boolean(warp?.knots?.length));
  if (!available.length) return null;
  if (available.length === 1) return available[0];
  const knots = available
    .flatMap((warp) => warp.knots)
    .sort((left, right) => left.y - right.y)
    .filter((knot, index, all) => index === 0 || knot.y - all[index - 1].y > 0.05);
  const weight = available.reduce((sum, warp) => sum + warp.knots.length, 0);
  return {
    version: 1,
    top: knots[0].y,
    bottom: knots[knots.length - 1].y,
    confidence: available.reduce((sum, warp) => sum + warp.confidence * warp.knots.length, 0) / weight,
    baselineError: available.reduce((sum, warp) => sum + warp.baselineError * warp.knots.length, 0) / weight,
    candidateError: available.reduce((sum, warp) => sum + warp.candidateError * warp.knots.length, 0) / weight,
    improvement: available.reduce((sum, warp) => sum + warp.improvement * warp.knots.length, 0) / weight,
    maxDisplacement: Math.max(...available.map((warp) => warp.maxDisplacement)),
    knots,
  };
}

function sampleKnot(warp: HeadContourWarp, y: number) {
  const knots = warp.knots;
  if (y <= knots[0].y) return knots[0];
  if (y >= knots[knots.length - 1].y) return knots[knots.length - 1];
  let upperIndex = 1;
  while (upperIndex < knots.length && knots[upperIndex].y < y) upperIndex += 1;
  const lower = knots[upperIndex - 1];
  const upper = knots[upperIndex];
  const ratio = upper.y > lower.y ? (y - lower.y) / (upper.y - lower.y) : 0;
  const interpolate = (key: keyof HeadContourWarpKnot) => Number(lower[key]) + (Number(upper[key]) - Number(lower[key])) * ratio;
  return {
    y,
    sourceY: interpolate("sourceY"),
    sourceLeft: interpolate("sourceLeft"),
    sourceRight: interpolate("sourceRight"),
    targetLeft: interpolate("targetLeft"),
    targetRight: interpolate("targetRight"),
    strength: interpolate("strength"),
  } satisfies HeadContourWarpKnot;
}

function drawSegment(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceY: number,
  sourceLeft: number,
  sourceRight: number,
  targetLeft: number,
  targetRight: number,
  targetY: number,
) {
  if (sourceRight - sourceLeft < 0.01 || targetRight - targetLeft < 0.01) return;
  context.drawImage(source, sourceLeft, sourceY, sourceRight - sourceLeft, 1, targetLeft, targetY, targetRight - targetLeft, 1);
}

/** Aplica somente o resíduo local; a escala/posição global continuam no renderer. */
export function renderHeadContourWarp(
  image: CanvasImageSource,
  width: number,
  height: number,
  warp?: HeadContourWarp,
) {
  if (!warp?.knots?.length) return image;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) return image;
  sourceContext.drawImage(image, 0, 0, width, height);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) return image;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0);

  const firstY = clamp(Math.floor(warp.top), 0, height - 1);
  const lastY = clamp(Math.ceil(warp.bottom), 0, height - 1);
  for (let y = firstY; y <= lastY; y += 1) {
    const knot = sampleKnot(warp, y);
    const strength = clamp(knot.strength, 0, 1);
    if (strength <= 0.001) continue;
    const sourceY = clamp(knot.sourceY * strength + y * (1 - strength), 0, height - 1);
    const sourceLeft = clamp(knot.sourceLeft, 0, width);
    const sourceRight = clamp(knot.sourceRight, sourceLeft + 1, width);
    const targetLeft = clamp(sourceLeft + (knot.targetLeft - sourceLeft) * strength, 0, width);
    const targetRight = clamp(sourceRight + (knot.targetRight - sourceRight) * strength, targetLeft + 1, width);
    const sourceWidth = sourceRight - sourceLeft;
    const innerLeft = sourceLeft + sourceWidth * 0.32;
    const innerRight = sourceRight - sourceWidth * 0.32;
    const sourceCenter = (sourceLeft + sourceRight) / 2;
    const targetCenter = (targetLeft + targetRight) / 2;
    const innerShift = (targetCenter - sourceCenter) * 0.22;
    const targetInnerLeft = innerLeft + innerShift;
    const targetInnerRight = innerRight + innerShift;

    context.clearRect(0, y, width, 1);
    drawSegment(context, source, y, 0, sourceLeft, 0, targetLeft, y);
    const sideSteps = 4;
    for (let step = 0; step < sideSteps; step += 1) {
      const t0 = step / sideSteps;
      const t1 = (step + 1) / sideSteps;
      const middle = (t0 + t1) / 2;
      drawSegment(
        context,
        source,
        sourceY * (1 - middle) + y * middle,
        sourceLeft + (innerLeft - sourceLeft) * t0,
        sourceLeft + (innerLeft - sourceLeft) * t1,
        targetLeft + (targetInnerLeft - targetLeft) * t0,
        targetLeft + (targetInnerLeft - targetLeft) * t1,
        y,
      );
    }
    drawSegment(context, source, y, innerLeft, innerRight, targetInnerLeft, targetInnerRight, y);
    for (let step = 0; step < sideSteps; step += 1) {
      const t0 = step / sideSteps;
      const t1 = (step + 1) / sideSteps;
      const middle = (t0 + t1) / 2;
      drawSegment(
        context,
        source,
        y * (1 - middle) + sourceY * middle,
        innerRight + (sourceRight - innerRight) * t0,
        innerRight + (sourceRight - innerRight) * t1,
        targetInnerRight + (targetRight - targetInnerRight) * t0,
        targetInnerRight + (targetRight - targetInnerRight) * t1,
        y,
      );
    }
    drawSegment(context, source, y, sourceRight, width, targetRight, width, y);
  }
  return output;
}

export function contourWarpCacheKey(warp?: HeadContourWarp) {
  if (!warp) return "none";
  return `v${warp.version}:${warp.top}:${warp.bottom}:${warp.improvement}:${warp.maxDisplacement}:${warp.knots.map((knot) => `${knot.y},${knot.sourceY},${knot.targetLeft},${knot.targetRight}`).join(";")}`;
}
