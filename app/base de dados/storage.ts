import { LOCAL_DATA_URL, localDataFetch } from "../lib/local-data-client";
import type { Character } from "../domain/character-contract";
import type { NarrativeProfile } from "../domain/roteiro-contract";
import type { BaseDadosState, BaseDadosVideo } from "./types";

function metadata(value: unknown) {
  return { "X-Gacha-Meta": encodeURIComponent(JSON.stringify(value)) };
}

async function request(path: string, init?: RequestInit) {
  const response = await localDataFetch(path, { cache: "no-store", ...init });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.error || `Serviço local indisponível (${response.status})`));
  return result;
}

export async function loadBaseDados() {
  const result = await request("/base-dados/state");
  return result as unknown as BaseDadosState;
}

export async function loadBaseDadosCharacterData() {
  const [appState, roteirosState] = await Promise.all([
    request("/state"),
    request("/roteiros/state").catch(() => ({} as Record<string, unknown>)),
  ]);
  return {
    characters: Array.isArray(appState.characters) ? appState.characters as Character[] : [],
    profiles: Array.isArray(roteirosState.profiles) ? roteirosState.profiles as NarrativeProfile[] : [],
  };
}

export function baseDadosVideoUrl(video: BaseDadosVideo) {
  const path = video.url || `${LOCAL_DATA_URL}/base-dados/videos/${encodeURIComponent(video.id)}`;
  return `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(video.updatedAt)}`;
}

export async function uploadBaseDadosVideo(file: File, durationSeconds: number) {
  const response = await localDataFetch("/base-dados/videos", {
    method: "POST",
    headers: { "Content-Type": file.type || "video/mp4", ...metadata({ name: file.name, contentType: file.type || "video/mp4", durationSeconds }) },
    body: file,
  });
  const result = await response.json().catch(() => ({})) as { error?: string; video?: BaseDadosVideo; state?: BaseDadosState };
  if (!response.ok || !result.video || !result.state) throw new Error(result.error || "Não foi possível salvar o vídeo no PC.");
  return { video: result.video, state: result.state };
}

export async function patchBaseDadosVideo(id: string, patch: Pick<BaseDadosVideo, "description" | "sceneEndSeconds">, signal?: AbortSignal) {
  const result = await request(`/base-dados/videos/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), signal });
  return result as unknown as { video: BaseDadosVideo; state: BaseDadosState };
}

export async function removeBaseDadosVideo(id: string) {
  const result = await request(`/base-dados/videos/${encodeURIComponent(id)}`, { method: "DELETE" });
  return result as unknown as { state: BaseDadosState };
}

export async function openBaseDadosFolder() {
  const result = await request("/base-dados/open-folder", { method: "POST" });
  return String(result.folder || "dados-locais-premium/base-de-dados");
}

export function downloadText(fileName: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
