import { cloneStudioValue } from "./scene-ops";
import type { Studio } from "./types";

export type StudioHistoryStack = Studio[][];
export type StudioHistoryResult = { studios: Studio[]; undo: StudioHistoryStack; redo: StudioHistoryStack };

export function pushStudioHistory(stack: StudioHistoryStack, snapshot: Studio[], limit = 30) {
  return [...stack.slice(-(limit - 1)), cloneStudioValue(snapshot)];
}

export function undoStudioHistory(undo: StudioHistoryStack, redo: StudioHistoryStack, current: Studio[]): StudioHistoryResult | null {
  const previous = undo.at(-1);
  if (!previous) return null;
  return { studios: previous, undo: undo.slice(0, -1), redo: [...redo, cloneStudioValue(current)] };
}

export function redoStudioHistory(undo: StudioHistoryStack, redo: StudioHistoryStack, current: Studio[]): StudioHistoryResult | null {
  const next = redo.at(-1);
  if (!next) return null;
  return { studios: next, undo: [...undo, cloneStudioValue(current)], redo: redo.slice(0, -1) };
}
