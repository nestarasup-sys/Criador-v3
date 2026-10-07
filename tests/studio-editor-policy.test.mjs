import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_DATA,
  emotionOptionsForCharacter,
  inspectorSideForCharacter,
  resolveStudioSelection,
} from "../app/studio/editor-policy.ts";

test("studio editor policy keeps empty data immutable by convention", () => {
  assert.deepEqual(EMPTY_DATA, {
    characters: [],
    catalog: [],
    expressionPacks: [],
    studios: [],
    studioAssets: [],
  });
});

test("studio inspector opens opposite the selected character", () => {
  assert.equal(inspectorSideForCharacter(.2), "right");
  assert.equal(inspectorSideForCharacter(.5), "left");
  assert.equal(inspectorSideForCharacter(.9), "left");
});

test("studio expression options exclude blink and talk frames", () => {
  const character = {
    id: "c1",
    name: "Fyn",
    model: "feminino",
    faceMode: "pack",
    expressionPackId: "pack-1",
    selections: {},
    adjustments: {},
    updatedAt: "2026-10-06",
  };
  const options = emotionOptionsForCharacter(character, [{
    id: "pack-1",
    name: "Pack",
    model: "feminino",
    frames: [
      { key: "normal" },
      { key: "bravo" },
      { key: "normal_blink" },
      { key: "normal_talk" },
    ],
  }], {});
  const keys = options.map(([key]) => key);
  assert.ok(keys.includes("normal"));
  assert.ok(keys.includes("bravo"));
  assert.equal(keys.includes("normal_blink"), false);
  assert.equal(keys.includes("normal_talk"), false);
});

test("studio selection resolution centralizes inspector context", () => {
  const character = { id: "base-1", name: "Fyn" };
  const studio = {
    background: { id: "bg" },
    characters: [{ id: "scene-1", characterId: "base-1" }],
    objects: [{ id: "obj-1" }],
    bubbles: [{ id: "bubble-1", characterInstanceId: "scene-1" }],
    narrators: [{ id: "narrator-1" }],
  };
  const map = new Map([["base-1", character]]);
  const selected = resolveStudioSelection(studio, { kind: "bubble", id: "bubble-1" }, map, false);
  assert.equal(selected.selectedBubble?.id, "bubble-1");
  assert.equal(selected.selectedBubbleCharacter?.id, "scene-1");
  assert.equal(selected.selectedBubbleCharacterName, "Fyn");
  assert.equal(selected.inspectorHasContent, true);

  const background = resolveStudioSelection(studio, null, map, false);
  assert.equal(background.inspectorHasContent, true);
  const collapsed = resolveStudioSelection(studio, null, map, true);
  assert.equal(collapsed.inspectorHasContent, false);
});
