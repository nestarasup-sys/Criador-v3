import { createId, createOpeningSection, createReactionBlock, createTikTokSection, nowIso } from "./defaults";
import type { OpeningSection, ReactionBlock, RoteirosState, ScriptProject, TikTokSection } from "./types";

export type ScriptRecipe = (script: ScriptProject) => ScriptProject;

export function updateScript(state: RoteirosState, scriptId: string, recipe: ScriptRecipe): RoteirosState {
  return {
    ...state,
    scripts: state.scripts.map((script) => script.id === scriptId ? { ...recipe(script), updatedAt: nowIso() } : script),
  };
}

export function patchTikTok(state: RoteirosState, scriptId: string, sectionId: string, patch: Partial<TikTokSection>): RoteirosState {
  return updateScript(state, scriptId, (script) => ({
    ...script,
    tiktoks: script.tiktoks.map((section) => section.id === sectionId ? { ...section, ...patch, updatedAt: nowIso() } : section),
  }));
}

export function addTikTok(state: RoteirosState, scriptId: string, blockCount: number, shortLines: boolean) {
  const section = createTikTokSection(blockCount, shortLines);
  return { state: updateScript(state, scriptId, (script) => ({ ...script, tiktoks: [...script.tiktoks, section] })), section };
}

export function addOpening(state: RoteirosState, scriptId: string, blockCount: number, shortLines: boolean) {
  const opening = createOpeningSection(blockCount, shortLines);
  return { state: updateScript(state, scriptId, (script) => script.opening ? script : { ...script, opening }), opening };
}

export function patchOpening(state: RoteirosState, scriptId: string, patch: Partial<OpeningSection>) {
  return updateScript(state, scriptId, (script) => script.opening ? { ...script, opening: { ...script.opening, ...patch, updatedAt: nowIso() } } : script);
}

export function removeOpening(state: RoteirosState, scriptId: string) {
  return updateScript(state, scriptId, (script) => {
    const next = { ...script };
    delete next.opening;
    return next;
  });
}

function findOpening(state: RoteirosState, scriptId: string) {
  return state.scripts.find((script) => script.id === scriptId)?.opening?.reactionBlocks ?? [];
}

export function patchOpeningReactionBlock(state: RoteirosState, scriptId: string, blockId: string, patch: Partial<ReactionBlock>) {
  const timestamp = nowIso();
  return patchOpening(state, scriptId, { reactionBlocks: findOpening(state, scriptId).map((block) => block.id === blockId ? { ...block, ...patch, updatedAt: timestamp } : block) });
}

export function addOpeningReactionBlock(state: RoteirosState, scriptId: string, type: ReactionBlock["type"] = "speech") {
  const block = createReactionBlock(type);
  return { state: patchOpening(state, scriptId, { reactionBlocks: findOpening(state, scriptId).concat(block) }), block };
}

export function moveOpeningReactionBlock(state: RoteirosState, scriptId: string, blockId: string, direction: -1 | 1) {
  const blocks = findOpening(state, scriptId);
  const index = blocks.findIndex((block) => block.id === blockId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= blocks.length) return state;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return patchOpening(state, scriptId, { reactionBlocks: next });
}

export function duplicateOpeningReactionBlock(state: RoteirosState, scriptId: string, blockId: string) {
  const blocks = findOpening(state, scriptId);
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return state;
  const timestamp = nowIso();
  const copy = { ...structuredClone(blocks[index]), id: createId(), createdAt: timestamp, updatedAt: timestamp };
  return patchOpening(state, scriptId, { reactionBlocks: [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)] });
}

export function removeOpeningReactionBlock(state: RoteirosState, scriptId: string, blockId: string) {
  return patchOpening(state, scriptId, { reactionBlocks: findOpening(state, scriptId).filter((block) => block.id !== blockId) });
}

export function moveTikTok(state: RoteirosState, scriptId: string, sectionId: string, direction: -1 | 1) {
  return updateScript(state, scriptId, (script) => {
    const index = script.tiktoks.findIndex((section) => section.id === sectionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= script.tiktoks.length) return script;
    const tiktoks = [...script.tiktoks];
    [tiktoks[index], tiktoks[target]] = [tiktoks[target], tiktoks[index]];
    return { ...script, tiktoks };
  });
}

export function removeTikTok(state: RoteirosState, scriptId: string, sectionId: string) {
  return updateScript(state, scriptId, (script) => ({ ...script, tiktoks: script.tiktoks.filter((section) => section.id !== sectionId) }));
}

export function patchReactionBlock(state: RoteirosState, scriptId: string, sectionId: string, blockId: string, patch: Partial<ReactionBlock>) {
  const timestamp = nowIso();
  return patchReactionBlocks(state, scriptId, sectionId, findBlocks(state, scriptId, sectionId).map((block) => block.id === blockId ? { ...block, ...patch, updatedAt: timestamp } : block));
}

export function patchReactionBlocks(state: RoteirosState, scriptId: string, sectionId: string, reactionBlocks: ReactionBlock[]) {
  return patchTikTok(state, scriptId, sectionId, { reactionBlocks });
}

export function addReactionBlock(state: RoteirosState, scriptId: string, sectionId: string, type: ReactionBlock["type"] = "speech") {
  const block = createReactionBlock(type);
  return { state: patchTikTok(state, scriptId, sectionId, { reactionBlocks: findBlocks(state, scriptId, sectionId).concat(block) }), block };
}

export function moveReactionBlock(state: RoteirosState, scriptId: string, sectionId: string, blockId: string, direction: -1 | 1) {
  const blocks = findBlocks(state, scriptId, sectionId);
  const index = blocks.findIndex((block) => block.id === blockId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= blocks.length) return state;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return patchReactionBlocks(state, scriptId, sectionId, next);
}

export function duplicateReactionBlock(state: RoteirosState, scriptId: string, sectionId: string, blockId: string) {
  const blocks = findBlocks(state, scriptId, sectionId);
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return state;
  const timestamp = nowIso();
  const copy = { ...structuredClone(blocks[index]), id: createId(), createdAt: timestamp, updatedAt: timestamp };
  return patchReactionBlocks(state, scriptId, sectionId, [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
}

export function removeReactionBlock(state: RoteirosState, scriptId: string, sectionId: string, blockId: string) {
  return patchReactionBlocks(state, scriptId, sectionId, findBlocks(state, scriptId, sectionId).filter((block) => block.id !== blockId));
}

function findBlocks(state: RoteirosState, scriptId: string, sectionId: string) {
  return state.scripts.find((script) => script.id === scriptId)?.tiktoks.find((section) => section.id === sectionId)?.reactionBlocks ?? [];
}
