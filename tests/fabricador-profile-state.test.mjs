import assert from "node:assert/strict";
import test from "node:test";
import { buildPresetProfilesDocument, presetsWithEffectPlacements } from "../app/Ferramentas/fabricador-de-modelo/profile-state.ts";
import { defaultPresetForIndex } from "../app/Ferramentas/fabricador-de-modelo/fabricador-config.ts";

const placements = {
  blush: { x: 501, y: 520, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  shadow: { x: 500, y: 420, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  manpu: { x: 500, y: 360, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
};

test("profile state stamps current effect placements into every preset without sharing references", () => {
  const source = [defaultPresetForIndex(0), defaultPresetForIndex(1)];
  const next = presetsWithEffectPlacements(source, placements);
  assert.equal(next[0].effectPlacements.blush.x, 501);
  next[0].effectPlacements.blush.x = 999;
  assert.equal(next[1].effectPlacements.blush.x, 501);
  assert.equal(source[0].effectPlacements.blush.x === 999, false);
});

test("profile state creates a deterministic default profile when none exists", () => {
  const sourcePresets = [defaultPresetForIndex(0)];
  const doc = buildPresetProfilesDocument({
    sourceProfiles: [],
    sourcePresets,
    sourceProfileId: "ausente",
    effectPlacements: placements,
    templateSkinColor: "#ffeedd",
    now: "2026-10-06T12:00:00.000Z",
  });
  assert.equal(doc.version, 1);
  assert.equal(doc.activeProfileId, "padrao");
  assert.equal(doc.profiles.length, 1);
  assert.equal(doc.profiles[0].createdAt, "2026-10-06T12:00:00.000Z");
  assert.equal(doc.profiles[0].updatedAt, "2026-10-06T12:00:00.000Z");
  assert.equal(doc.profiles[0].skinColor, "#ffeedd");
});

test("profile state updates only the active profile and preserves siblings", () => {
  const sourcePresets = [defaultPresetForIndex(0)];
  const profiles = [
    { id: "padrao", name: "Padrão", description: "", createdAt: "a", updatedAt: "a", skinColor: "#ffffff", presets: {} },
    { id: "vilao", name: "Vilão", description: "", createdAt: "b", updatedAt: "b", skinColor: "#111111", presets: {} },
  ];
  const doc = buildPresetProfilesDocument({
    sourceProfiles: profiles,
    sourcePresets,
    sourceProfileId: "vilao",
    effectPlacements: placements,
    templateSkinColor: "#abcdef",
    now: "2026-10-06T13:00:00.000Z",
  });
  assert.equal(doc.activeProfileId, "vilao");
  assert.equal(doc.profiles[0], profiles[0]);
  assert.equal(doc.profiles[1].skinColor, "#abcdef");
  assert.equal(doc.profiles[1].updatedAt, "2026-10-06T13:00:00.000Z");
  assert.ok(Object.keys(doc.profiles[1].presets).length > 0);
});
