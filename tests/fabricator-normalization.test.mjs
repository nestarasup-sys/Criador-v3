import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFabricatorChroma,
  normalizeFabricatorGrid,
  normalizeFabricatorPlacement,
  normalizeFabricatorPresetProfiles,
  normalizeFabricatorPresets,
} from "../services/fabricator/normalization.mjs";

test("fabricator chroma normalization clamps numeric input and keeps valid seeds", () => {
  assert.deepEqual(normalizeFabricatorChroma({
    strength: 200,
    tolerance: -2,
    softness: 999,
    manualSeeds: [
      { side: "right", x: 2, y: -1 },
      { side: "invalid", x: .25, y: .75 },
    ],
  }), {
    strength: 100,
    tolerance: 2,
    softness: 80,
    manualSeeds: [
      { side: "right", x: 1, y: 0 },
      { side: "left", x: .25, y: .75 },
    ],
  });
  assert.equal(normalizeFabricatorChroma(null), undefined);
});

test("fabricator grid only accepts supported sheet layouts", () => {
  assert.equal(normalizeFabricatorGrid("7x3"), "7x3");
  assert.equal(normalizeFabricatorGrid("5x8"), "5x8");
  assert.equal(normalizeFabricatorGrid("21x1"), undefined);
});

test("fabricator placement normalizes both single and paired placement", () => {
  assert.deepEqual(normalizeFabricatorPlacement({ x: -50, y: 1500, scale: 99, rotation: 200 }), {
    x: 0,
    y: 1000,
    scale: 12,
    scaleX: 1,
    scaleY: 1,
    rotation: 80,
    gap: 0,
  });
  const pair = normalizeFabricatorPlacement({
    left: { x: 100, y: 200, gap: 500 },
    right: { x: 900, y: 200, gap: 500 },
  });
  assert.equal(pair.left.gap, 0);
  assert.equal(pair.right.gap, 0);
  assert.equal(pair.left.x, 100);
  assert.equal(pair.right.x, 900);
});

test("fabricator preset documents reject malformed roots", () => {
  assert.deepEqual(normalizeFabricatorPresets(null), {});
  assert.deepEqual(normalizeFabricatorPresets([]), {});
  assert.deepEqual(normalizeFabricatorPresets({ "bad key!": {} }), {});
});

test("fabricator profile normalization produces a stable default profile", () => {
  const empty = normalizeFabricatorPresetProfiles(null, {});
  assert.equal(empty.version, 1);
  assert.equal(empty.activeProfileId, "padrao");
  assert.equal(empty.profiles.length, 1);
  assert.equal(empty.profiles[0].skinColor, "#fff0e7");

  const normalized = normalizeFabricatorPresetProfiles({
    activeProfileId: "não-existe",
    profiles: [{ id: " Perfil Á ", name: "  Meu   Perfil  ", presets: {} }],
  });
  assert.equal(normalized.activeProfileId, "perfil-a");
  assert.equal(normalized.profiles[0].id, "perfil-a");
  assert.equal(normalized.profiles[0].name, "Meu Perfil");
});
