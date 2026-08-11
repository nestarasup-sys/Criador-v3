import type { EditorProject } from "./types";

export type EditorHistory = { past: EditorProject[]; present: EditorProject; future: EditorProject[]; limit: number };

export function createEditorHistory(project: EditorProject, limit = 80): EditorHistory { return { past: [], present: project, future: [], limit: Math.max(1, limit) }; }

export function commitEditorChange(history: EditorHistory, next: EditorProject): EditorHistory {
  if (next === history.present) return history;
  return { ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: [] };
}

export function undoEditorChange(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, history.limit) };
}

export function redoEditorChange(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return { ...history, past: [...history.past, history.present].slice(-history.limit), present: next, future: history.future.slice(1) };
}

export function scheduleEditorAutosave(save: (project: EditorProject) => Promise<void>, delayMs = 650) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: EditorProject | undefined;
  let pending: Promise<void> = Promise.resolve();
  return {
    schedule(project: EditorProject) { latest = project; if (timer) clearTimeout(timer); timer = setTimeout(() => { const value = latest; if (value) pending = pending.catch(() => undefined).then(() => save(value)); }, Math.max(0, delayMs)); },
    async flush() { if (timer) { clearTimeout(timer); timer = undefined; } const value = latest; if (value) pending = pending.catch(() => undefined).then(() => save(value)); await pending; },
    cancel() { if (timer) clearTimeout(timer); timer = undefined; latest = undefined; },
  };
}
