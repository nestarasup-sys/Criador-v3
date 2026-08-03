import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { comparePngs } from "../scripts/compare-png.mjs";

test("compara PNGs com dimensão e métrica de diferença reproduzíveis", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-visual-"));
  try {
    const reference = join(root, "reference.png");
    const identical = join(root, "identical.png");
    const changed = join(root, "changed.png");
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 114, g: 87, b: 217, alpha: 1 } } }).png().toFile(reference);
    await sharp(reference).toFile(identical);
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 220, g: 80, b: 100, alpha: 1 } } }).png().toFile(changed);
    const same = await comparePngs(reference, identical);
    const different = await comparePngs(reference, changed, { threshold: 0.01 });
    assert.equal(same.changedPixels, 0);
    assert.equal(same.pass, true);
    assert.equal(different.pass, false);
    assert.equal(different.changedPixels, 64);
  } finally { await rm(root, { recursive: true, force: true }); }
});
