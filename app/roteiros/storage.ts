import { emptyRoteirosState } from "./defaults";
import type { PremiumCharacter, RoteirosState, RoteiroBackgroundReference, RoteiroExportTarget, ScriptProject, TikTokVideoReference } from "./types";
import type { Character, PcCatalogItem, PcExpressionPack } from "../studio/types";
import { LOCAL_DATA_URL, localDataFetch } from "../lib/local-data-client";
import { normalizeRoteirosState as normalizeState } from "../domain/document-schemas.mjs";
import { appendRecoveryJournal, discardPendingRecovery, findRecoveryCandidate, latestRecoveryState, markRecoverySaved, readRecoveryJournal } from "./recovery.mjs";
import type { RecoveryJournalEntry } from "./recovery-types";

const MIRROR_KEY = "gacha-premium-roteiros-emergency-v1";
let saveQueue: Promise<void> = Promise.resolve();

function readMirror() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(MIRROR_KEY) ?? ""));
  } catch {
    return emptyRoteirosState();
  }
}

export function mirrorRoteirosState(state: RoteirosState) {
  localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
}

export { appendRecoveryJournal, discardPendingRecovery, markRecoverySaved, readRecoveryJournal };
export type { RecoveryJournalEntry } from "./recovery-types";

async function request(path: string, init?: RequestInit) {
  const response = await localDataFetch(path, { cache: "no-store", ...init });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.error || `Serviço local indisponível (${response.status})`));
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

export async function uploadRoteiroBackground(scriptId: string, file: File) {
  const response = await localDataFetch(`/roteiros/backgrounds/${encodeURIComponent(scriptId)}`, {
    method: "POST", headers: { "Content-Type": file.type || "image/png", ...localMeta({ name: file.name, contentType: file.type || "image/png" }) }, body: file,
  });
  const result = await response.json().catch(() => ({})) as { error?: string; background?: RoteiroBackgroundReference };
  if (!response.ok || !result.background) throw new Error(result.error || "Não foi possível salvar o fundo no PC.");
  return result.background;
}

export async function exportRoteiroBackground(script: ScriptProject, target: RoteiroExportTarget = "v1") {
  const response = await localDataFetch("/roteiros/export-background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, scriptId: script.id, scriptTitle: script.title }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar o fundo."));
  return result as { folder: string; path: string; relativePath: string; fileName: string; exportTarget: RoteiroExportTarget };
}

export async function exportRoteiroVideos(script: ScriptProject, target: RoteiroExportTarget = "v1") {
  const response = await localDataFetch("/roteiros/export-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, scriptId: script.id, scriptTitle: script.title, tiktoks: script.tiktoks.map((section) => ({ id: section.id, description: section.description, video: section.video })) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar os vídeos."));
  return result as { folder: string; exported: number; missing: string[]; descriptionFile: string };
}

export async function exportRoteiroText(script: ScriptProject, content: string, target: RoteiroExportTarget = "v1") {
  const response = await localDataFetch("/roteiros/export-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, scriptId: script.id, scriptTitle: script.title, content }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar o roteiro."));
  return result as { path: string; fileName: string };
}

export async function exportRoteiroCharacter(scriptTitle: string, characterId: string, characterName: string, bundle: Blob, target: RoteiroExportTarget = "v1") {
  const response = await localDataFetch(`/roteiros/export-characters/${encodeURIComponent(characterId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/zip", ...localMeta({ scriptTitle, characterName, exportTarget: target }) },
    body: bundle,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.error || "Não foi possível exportar este personagem."));
  return result as { folder: string; files: number };
}

export async function openRoteiroExportFolder(folderTarget: "characters" | "script", scriptTitle: string, target: RoteiroExportTarget = "v1") {
  const response = await localDataFetch("/roteiros/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: folderTarget, exportTarget: target, scriptTitle }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; folder?: string };
  if (!response.ok || !result.folder) throw new Error(result.error || "Não foi possível abrir a pasta no PC.");
  return result.folder;
}

export function saveRoteirosState(state: RoteirosState) {
  mirrorRoteirosState(state);
  const snapshot = structuredClone(state);
  const operation = saveQueue.catch(() => undefined).then(async () => {
    await request("/roteiros/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export type AiRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

export async function aiRequest<T>(path: string, body?: unknown, method = "POST", options: AiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 150_000);
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
