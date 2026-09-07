import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicRoot = join(root, "public");
const fixtureRoot = join(root, "tests", "alinhador-profissa", "fixtures");
const reportRoot = join(root, "tests", "alinhador-profissa", "reports");
const baselinePath = join(root, "tests", "alinhador-profissa", "baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const median = values => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mad = values => median(values.map(value => Math.abs(value - median(values))));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pct = (value, digits = 3) => Number(value.toFixed(digits));

function serve(req, res) {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const relative = normalize(url).replace(/^([/\\])+/, "");
  const file = resolve(publicRoot, relative);
  if (!file.startsWith(publicRoot) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
}

function scalarStats(values) {
  const finite = values.filter(Number.isFinite), m = median(finite), robust = mad(finite) * 1.4826;
  return { median: pct(m), mad: pct(mad(finite)), robustScale: pct(robust), min: pct(Math.min(...finite)), max: pct(Math.max(...finite)) };
}

function sampleIoU(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let intersection = 0, union = 0, changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
    if (a[i] !== b[i]) changed++;
  }
  return { iou: union ? intersection / union : 1, changedRatio: changed / a.length };
}

function analyzeSnapshot(snapshot, detectMs, canonicalMs) {
  const heads = snapshot.heads.filter(head => head.warpStats);
  const values = key => heads.map(head => Number(head.warpStats?.[key] ?? head.geom?.[key] ?? head.geometryMetrics?.[key]));
  const geom = key => heads.map(head => Number(head.geom?.[key]));
  const metric = {
    skullWidth: scalarStats(geom("skullWidth")),
    faceHeight: scalarStats(geom("faceHeight")),
    totalHeight: scalarStats(geom("totalHeight")),
    jawY: scalarStats(geom("jawY")),
    neckBottomY: scalarStats(geom("neckBottomY")),
    centerX: scalarStats(geom("cx")),
    xMedian: scalarStats(values("xMedian")),
    yHead: scalarStats(values("yHead")),
    yNeck: scalarStats(values("yNeck")),
    yTotal: scalarStats(values("yTotal")),
    localVariation: scalarStats(values("localVariation")),
    maxWarpX: scalarStats(values("xMax")),
    scaleX: scalarStats(values("globalX")),
    scaleY: scalarStats(values("yTotal"))
  };
  const raster = heads.map(head => head.warpedRaster).filter(Boolean);
  const alphaRatios = raster.map(item => item.alphaRatio);
  const alphaAreas = raster.map(item => item.alphaPixels);
  const frameDiffs = [];
  for (let i = 1; i < raster.length; i++) {
    const diff = sampleIoU(raster[i - 1].sample, raster[i].sample);
    if (diff) frameDiffs.push(diff);
  }
  const meanChanged = frameDiffs.length ? frameDiffs.reduce((sum, item) => sum + item.changedRatio, 0) / frameDiffs.length : 0;
  const meanIoU = frameDiffs.length ? frameDiffs.reduce((sum, item) => sum + item.iou, 0) / frameDiffs.length : 1;
  const stabilityScore = clamp(100 * (1 - meanChanged), 0, 100);
  const diagnostics = heads.map(head => ({
    label: head.label,
    classification: head.diagnostics?.classification || "unknown",
    score: head.diagnostics?.score ?? null,
    dominantReason: head.diagnostics?.dominantReason || null,
    jawConfidence: head.diagnostics?.jawConfidence ?? head.geom?.jawConfidence ?? null,
    neckConfidence: head.diagnostics?.neckConfidence ?? head.geom?.neckConfidence ?? null,
    localVariation: head.warpStats.localVariation,
    warpMax: head.warpStats.xMax,
    unexpectedTransparency: head.diagnostics?.metrics?.find(item => item.key === "unexpectedTransparency")?.value ?? null
  }));
  return {
    detectedHeads: snapshot.heads.length,
    canonical: snapshot.canonical,
    metrics: metric,
    alpha: { area: scalarStats(alphaAreas), ratio: scalarStats(alphaRatios), unexpectedTransparency: scalarStats(diagnostics.map(item => item.unexpectedTransparency ?? 0)) },
    frameStability: { pairs: frameDiffs.length, meanIoU: pct(meanIoU), meanChangedRatio: pct(meanChanged), silhouetteStabilityScore: pct(stabilityScore, 2) },
    diagnostics,
    timings: { detectMs: pct(detectMs, 2), canonicalMs: pct(canonicalMs, 2), pageTimings: snapshot.timings }
  };
}

function compareBaseline(current, baseline) {
  if (!baseline) return null;
  const previous = new Map(baseline.fixtures.map(item => [item.id, item.benchmark]));
  return current.fixtures.map(item => {
    const old = previous.get(item.id), now = item.benchmark;
    if (!old) return { id: item.id, status: "NEW_FIXTURE" };
    const stabilityDelta = now.frameStability.silhouetteStabilityScore - old.frameStability.silhouetteStabilityScore;
    const detectedDelta = now.detectedHeads - old.detectedHeads;
    const localVariationDelta = now.metrics.localVariation.median - old.metrics.localVariation.median;
    const alphaDelta = now.alpha.ratio.median - old.alpha.ratio.median;
    const warnings = [];
    if (detectedDelta < 0) warnings.push("detected-heads-decreased");
    if (stabilityDelta < -1) warnings.push("silhouette-stability-decreased");
    if (localVariationDelta > .03) warnings.push("local-variation-increased");
    if (alphaDelta < -.03) warnings.push("alpha-area-decreased");
    return { id: item.id, status: warnings.length ? "WARN" : "OK", detectedDelta, stabilityDelta: pct(stabilityDelta, 2), localVariationDelta: pct(localVariationDelta), alphaDelta: pct(alphaDelta), warnings };
  });
}

async function main() {
  const server = createServer(serve);
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const fixtureNames = ["pair-01", "pair-02"];
  const results = [];
  for (const id of fixtureNames) {
    const dir = join(fixtureRoot, id);
    const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const t0 = performance.now();
    await page.goto(`http://127.0.0.1:${port}/Ferramentas/alinhador-profissa/index.html`);
    await page.locator("#fileA").setInputFiles(join(dir, "sheet-a.png"));
    await page.locator("#fileB").setInputFiles(join(dir, "sheet-b.png"));
    await page.click("#detect");
    await page.waitForFunction(() => document.querySelector("#detectStatus")?.textContent?.startsWith("Pronto:"));
    const detectMs = performance.now() - t0;
    await page.click("#canonical");
    await page.waitForFunction(() => document.querySelector("#canonicalStatus")?.textContent?.includes("pronta"));
    const canonicalMs = performance.now() - t0 - detectMs;
    const snapshot = await page.evaluate(() => window.__ALINHADOR_DEBUG__?.snapshot());
    const result = { id, metadata, benchmark: analyzeSnapshot(snapshot, detectMs, canonicalMs) };
    results.push(result);
    await page.screenshot({ path: join(reportRoot, `${id}-ui.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
  const output = { version: 1, generatedAt: new Date().toISOString(), fixtures: results };
  const reportPath = join(reportRoot, "latest.json");
  writeFileSync(reportPath, JSON.stringify(output, null, 2));
  if (writeBaseline) writeFileSync(baselinePath, JSON.stringify(output, null, 2));
  const baseline = existsSync(baselinePath) && !writeBaseline ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  console.log(JSON.stringify({ reportPath, baselinePath, wroteBaseline: writeBaseline, summary: results.map(item => ({ id: item.id, detectedHeads: item.benchmark.detectedHeads, stability: item.benchmark.frameStability.silhouetteStabilityScore, detectMs: item.benchmark.timings.detectMs, canonicalMs: item.benchmark.timings.canonicalMs })), baselineAvailable: !!baseline, comparison: compareBaseline(output, baseline) }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
