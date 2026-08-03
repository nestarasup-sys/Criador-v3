import sharp from "sharp";

export async function comparePngs(referencePath, candidatePath, options = {}) {
  const threshold = Number(options.threshold ?? 0.02);
  const [reference, candidate] = await Promise.all([sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(candidatePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })]);
  if (reference.info.width !== candidate.info.width || reference.info.height !== candidate.info.height) throw new Error(`Dimensões diferentes: referência ${reference.info.width}x${reference.info.height}, candidato ${candidate.info.width}x${candidate.info.height}.`);
  let changedPixels = 0;
  let totalDifference = 0;
  for (let index = 0; index < reference.data.length; index += 4) {
    const difference = Math.max(Math.abs(reference.data[index] - candidate.data[index]), Math.abs(reference.data[index + 1] - candidate.data[index + 1]), Math.abs(reference.data[index + 2] - candidate.data[index + 2]), Math.abs(reference.data[index + 3] - candidate.data[index + 3]));
    totalDifference += difference / 255;
    if (difference > 0) changedPixels += 1;
  }
  const pixels = reference.info.width * reference.info.height;
  return { width: reference.info.width, height: reference.info.height, changedPixels, changedRatio: changedPixels / pixels, meanDifference: totalDifference / pixels, pass: changedPixels / pixels <= threshold };
}

if (process.argv[1]?.endsWith("compare-png.mjs")) {
  const [, , referencePath, candidatePath, threshold] = process.argv;
  if (!referencePath || !candidatePath) { console.error("Uso: npm run visual:compare -- referencia.png candidato.png [limite]"); process.exit(2); }
  const result = await comparePngs(referencePath, candidatePath, { threshold });
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}
