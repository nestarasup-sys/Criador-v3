import { emptyRoteirosState } from "./defaults";
import type { AiUsageTotals, PremiumCharacter, RoteirosState, RoteiroBackgroundReference, ScriptProject, TikTokVideoReference } from "./types";
import type { Character, PcCatalogItem, PcExpressionPack } from "../studio/types";
import { LOCAL_DATA_URL, localDataFetch } from "../lib/local-data-client";
import { normalizeRoteirosState as normalizeState } from "../domain/document-schemas.mjs";
import { appendRecoveryJournal, discardPendingRecovery, findRecoveryCandidate, latestRecoveryState, markRecoverySaved, readRecoveryJournal } from "./recovery.mjs";
import type { RecoveryJournalEntry } from "./recovery-types";

const MIRROR_KEY = "gacha-premium-roteiros-emergency-v1";
let saveQueue: Promise<void> = Promise.resolve();

export type RoteiroExportTarget = "v4";

function readMirror() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(MIRROR_KEY) ?? ""));
  } catch {
    return emptyRoteirosState();
  }
}

export function mirrorRoteirosState(state: RoteirosState) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("[roteiros] Checkpoint do navegador indisponível", error);
    return false;
  }
}

export { appendRecoveryJournal, discardPendingRecovery, markRecoverySaved, readRecoveryJournal };
export type { RecoveryJournalEntry } from "./recovery-types";

async function request(path: string, init?: RequestInit) {
  const response = await localDataFetch(path, { cache: "no-store", ...init });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(String(result.error || `Serviço local indisponível (${response.status})`));
    if (result.diagnostics) Object.assign(error, { diagnostics: result.diagnostics });
    throw error;
  }
  return result;
}

export async function loadRoteirosState() {
  const journal = readRecoveryJournal();
  try {
    const result = await request("/roteiros/state");
    const state = normalizeState(result);
    const recoveryCandidate = findRecoveryCandidate(journal, state) as RecoveryJournalEntry | null;
    return { state, pcAvailable: true, recoveryCandidate };
  } catch {
    const journalState = latestRecoveryState(journal);
    return { state: journalState || readMirror(), pcAvailable: false, recoveryCandidate: null };
  }
}

export async function listRoteiroBackups() {
  const result = await request("/roteiros/backups");
  return result as { folder: string; backups: Array<{ fileName: string; createdAt: string; bytes: number }> };
}

export async function createRoteiroBackup() {
  const result = await request("/roteiros/backups/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  return result as { fileName: string; createdAt: string; bytes: number };
}

export async function restoreRoteiroBackup(fileName: string) {
  const result = await request("/roteiros/backups/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName }) });
  return result as { fileName: string; restoredAt: string; safetyBackup?: string };
}

export async function loadPremiumCharacters(): Promise<PremiumCharacter[]> {
  const result = await request("/state");
  return Array.isArray(result.characters) ? result.characters as PremiumCharacter[] : [];
}

export async function loadPremiumStudioData(): Promise<{
  characters: Character[];
  catalog: PcCatalogItem[];
  expressionPacks: PcExpressionPack[];
  modelPacks: Record<string, Array<{ id: string; name: string; expressionKeys: string[]; source: string }>>;
}> {
  const [result, models] = await Promise.all([
    request("/state") as Promise<{ characters?: Character[]; catalog?: PcCatalogItem[]; expressionPacks?: PcExpressionPack[] }>,
    request("/models") as Promise<Record<string, Array<{ id: string; name: string; expressionKeys: string[]; source: string }>>>,
  ]);
  return {
    characters: Array.isArray(result.characters) ? result.characters : [],
    catalog: Array.isArray(result.catalog) ? result.catalog : [],
    expressionPacks: Array.isArray(result.expressionPacks) ? result.expressionPacks : [],
    modelPacks: models || {},
  };
}

function localMeta(value: unknown) {
  return { "X-Gacha-Meta": encodeURIComponent(JSON.stringify(value)) };
}

export function roteiroVideoUrl(scriptId: string, tiktokId: string) {
  return `${LOCAL_DATA_URL}/roteiros/videos/${encodeURIComponent(scriptId)}/${encodeURIComponent(tiktokId)}`;
}

export async function uploadRoteiroVideo(scriptId: string, tiktokId: string, file: File) {
  const response = await localDataFetch(`/roteiros/videos/${encodeURIComponent(scriptId)}/${encodeURIComponent(tiktokId)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "video/mp4", ...localMeta({ name: file.name, contentType: file.type || "video/mp4" }) },
    body: file,
  });
  const result = await response.json().catch(() => ({})) as { error?: string; video?: TikTokVideoReference };
  if (!response.ok || !result.video) throw new Error(result.error || "Não foi possível salvar o vídeo no PC.");
  return result.video;
}

export async function removeRoteiroVideo(scriptId: string, tiktokId: string) {
  const response = await localDataFetch(`/roteiros/videos/${encodeURIComponent(scriptId)}/${encodeURIComponent(tiktokId)}`, { method: "DELETE" });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Não foi possível remover o vídeo do PC.");
}

export async function savePremiumCharacters(characters: Character[]) {
  await request("/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(characters),
  });
}

export async function copyRoteiroTikTokToBase(scriptId: string, tiktokId: string, metadata?: { description?: string; sceneEndSeconds?: number; firstGroupReactionSeconds?: number; durationSeconds?: number; name?: string }) {
  const response = await localDataFetch("/base-dados/import-from-roteiro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId, tiktokId, ...metadata }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; duplicate?: boolean; video?: { sequence: number; originalName: string } };
  if (!response.ok || !result.video) throw new Error(result.error || "Não foi possível enviar o TikTok para a Base de dados.");
  return result as { duplicate: boolean; video: { sequence: number; originalName: string } };
}

export async function removeRoteiro(scriptId: string, options: { deleteImportedCharacters?: boolean } = {}) {
  const query = options.deleteImportedCharacters ? "?deleteImportedCharacters=true" : "";
  const response = await localDataFetch(`/roteiros/scripts/${encodeURIComponent(scriptId)}${query}`, { method: "DELETE" });
  const result = await response.json().catch(() => ({})) as { error?: string; scriptId?: string; safetyBackup?: string | null; removedFolders?: string[]; removedCharacters?: string[]; keptCharacters?: string[] };
  if (!response.ok) throw new Error(result.error || "Não foi possível excluir o roteiro e suas pastas do PC.");
  return result;
}

export type RoteiroOrphans = {
  internal: { videos: string[]; backgrounds: string[] };
  exports: Array<{ kind: string; folder: string; scriptId: string; untracked?: boolean }>;
};

export async function listRoteiroOrphans() {
  const result = await request("/roteiros/orphans");
  return result as RoteiroOrphans;
}

export async function cleanupRoteiroOrphans() {
  const result = await request("/roteiros/orphans/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  return result as { ok: boolean; internal: RoteiroOrphans["internal"] & { removed: Array<{ kind: string; id: string }> }; exports: { orphans: RoteiroOrphans["exports"]; removed: string[] } };
}

export async function importBaseDadosVideoIntoRoteiro(scriptId: string, tiktokId: string, videoId: string) {
  const response = await localDataFetch("/roteiros/import-base-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId, tiktokId, videoId }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; video?: TikTokVideoReference };
  if (!response.ok || !result.video) throw new Error(result.error || "Não foi possível copiar o vídeo da Base de dados para o roteiro.");
  return result.video;
}

export async function uploadRoteiroBackground(scriptId: string, file: File) {
  const response = await localDataFetch(`/roteiros/backgrounds/${encodeURIComponent(scriptId)}`, {
    method: "POST", headers: { "Content-Type": file.type || "image/png", ...localMeta({ name: file.name, contentType: file.type || "image/png" }) }, body: file,
  });
  const result = await response.json().catch(() => ({})) as { error?: string; background?: RoteiroBackgroundReference };
  if (!response.ok || !result.background) throw new Error(result.error || "Não foi possível salvar o fundo no PC.");
  return result.background;
}

export async function exportRoteiroBackground(script: ScriptProject, exportTarget: RoteiroExportTarget = "v4") {
  const response = await localDataFetch("/roteiros/export-background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scriptId: script.id, scriptTitle: script.title, exportTarget }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar o fundo."));
  return result as { folder: string; path: string; relativePath: string; fileName: string };
}

export async function exportRoteiroVideos(script: ScriptProject, exportTarget: RoteiroExportTarget = "v4") {
  const response = await localDataFetch("/roteiros/export-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId: script.id, scriptTitle: script.title, exportTarget, tiktoks: script.tiktoks.map((section) => ({ id: section.id, description: section.description, sceneEndSeconds: section.sceneEndSeconds, firstGroupReactionSeconds: section.firstGroupReactionSeconds, video: section.video })) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar os vídeos."));
  return result as { folder: string; exported: number; copied: number; converted: number; missing: string[]; conversionFallbacks: string[]; audioRecoveries: string[]; audioCopied: string[]; descriptionFile: string };
}

export async function exportRoteiroText(script: ScriptProject, content: string, exportTarget: RoteiroExportTarget = "v4") {
  const response = await localDataFetch("/roteiros/export-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId: script.id, scriptTitle: script.title, exportTarget, content }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar o roteiro."));
  return result as { path: string; fileName: string };
}

export async function exportRoteiroCharacter(scriptId: string, scriptTitle: string, characterId: string, characterName: string, bundle: Blob, exportTarget: RoteiroExportTarget = "v4") {
  const response = await localDataFetch(`/roteiros/export-characters/${encodeURIComponent(characterId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/zip", ...localMeta({ scriptId, scriptTitle, characterName, exportTarget }) },
    body: bundle,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar este personagem."));
  return result as { folder: string; files: number };
}

export async function openRoteiroExportFolder(folderTarget: "characters" | "script" | "background", scriptTitle: string, exportTarget: RoteiroExportTarget = "v4") {
  const response = await localDataFetch("/roteiros/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: folderTarget, scriptTitle, exportTarget }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; folder?: string };
  if (!response.ok || !result.folder) throw new Error(result.error || "Não foi possível abrir a pasta no PC.");
  return result.folder;
}

export function saveRoteirosState(state: RoteirosState) {
  const checkpointSaved = mirrorRoteirosState(state);
  const snapshot = structuredClone(state);
  const operation = saveQueue.catch(() => undefined).then(async () => {
    await request("/roteiros/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation.catch((error) => { throw Object.assign(error instanceof Error ? error : new Error("Falha ao salvar Roteiros."), { checkpointSaved }); });
}

export type AiRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

export type AiPromptSnapshot = {
  operation: string;
  provider: string;
  model: string | null;
  instructions: string;
  input: string;
  variables: Record<string, unknown>;
  attempt: number;
  sentAt: string;
  durationMs: number | null;
  usage: Record<string, unknown> | null;
  status: string;
  error: string | null;
};

export type AiPromptCatalogEntry = {
  id: string;
  label: string;
  button: string;
  endpoint: string;
  promptKind: "technical" | "none" | "structured";
  description: string;
  editable: boolean;
  variables: string[];
  defaultPrompt: string;
  customizationMode: "replace-narrative";
  protectedRules: string[];
  promptVersion: "default" | "custom";
  customPrompt: string;
  lastExecution: AiPromptSnapshot | null;
  executions: AiPromptSnapshot[];
};

export type AiUsageSummary = AiUsageTotals;

export async function loadAiPromptCatalog() {
  return aiRequest<{ version: number; operations: AiPromptCatalogEntry[]; usage?: AiUsageSummary }>("prompts", undefined, "GET");
}

export async function saveAiPromptOverride(operation: string, prompt: string) {
  return aiRequest<{ operation: string; prompt: string; version: string }>(`prompts/${encodeURIComponent(operation)}`, { prompt }, "PUT");
}

export async function resetAiPromptOverride(operation: string) {
  return aiRequest<{ version: number; operations: AiPromptCatalogEntry[] }>(`prompts/${encodeURIComponent(operation)}/reset`, undefined, "POST");
}

export async function aiRequest<T>(path: string, body?: unknown, method = "POST", options: AiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 90_000);
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    return await request(`/roteiros/ai/${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    }) as T;
  } catch (error) {
    if (options.signal?.aborted) {
      const cancelled = new Error("Geração cancelada.");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    if (controller.signal.aborted) throw new Error("A IA demorou demais para responder.");
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function exportJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportTextFile(fileName: string, value: string) {
  const blob = new Blob([value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
