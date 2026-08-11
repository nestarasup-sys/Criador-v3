import { localDataFetch } from "../lib/local-data-client";
import type { EditorProject } from "./types";

export type EditorAiProposal = { ok: true; proposal: EditorProject; model: string };

export async function requestEditorAi(project: EditorProject, instruction: string, options: { signal?: AbortSignal; model?: string } = {}) {
  const response = await localDataFetch("/editor-video/ai", {
    method: "POST", signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, instruction, model: options.model ?? "gemma4:e4b", provider: "ollama" }),
  });
  const result = await response.json().catch(() => ({})) as Partial<EditorAiProposal> & { error?: string };
  if (!response.ok || !result.proposal) throw new Error(result.error || "A IA local não retornou uma proposta válida.");
  return result as EditorAiProposal;
}
