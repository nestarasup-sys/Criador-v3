import { LOCAL_DATA_URL, localDataFetch } from "../lib/local-data-client";

export type EditorCharacterCatalogEntry = {
  id: string;
  characterId?: string;
  name: string;
  importedAt: string;
  files: string[];
  manifest?: Record<string, unknown>;
};

export type EditorMediaEntry = { id: string; name: string; contentType: string; extension: string; hash: string; bytes: number; path: string; createdAt: string };

async function jsonResponse(response: Response) {
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(value.error || "Serviço local do Editor indisponível."));
  return value;
}

export async function listEditorCharacters() {
  const response = await localDataFetch("/editor-video/characters", { cache: "no-store" });
  const result = await jsonResponse(response);
  return Array.isArray(result.characters) ? result.characters as EditorCharacterCatalogEntry[] : [];
}

export async function importEditorCharacterZip(file: Blob, metadata: { characterId?: string; characterName?: string } = {}) {
  const response = await localDataFetch("/editor-video/characters/import", {
    method: "POST",
    headers: { "Content-Type": "application/zip", "X-Gacha-Meta": encodeURIComponent(JSON.stringify(metadata)) },
    body: file,
  });
  const result = await jsonResponse(response);
  return result as { character: EditorCharacterCatalogEntry; folder: string; files: number };
}

export function editorCharacterAssetUrl(characterId: string, relativePath: string) {
  const encodedId = encodeURIComponent(characterId);
  const encodedPath = relativePath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${LOCAL_DATA_URL}/files/editor-video/characters/${encodedId}/${encodedPath}`;
}

export async function saveEditorProject(projectId: string, project: unknown) {
  const response = await localDataFetch(`/editor-video/projects/${encodeURIComponent(projectId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project),
  });
  return jsonResponse(response);
}

export async function uploadEditorVideo(file: File, id = `video-${Date.now()}`) {
  const response = await localDataFetch(`/editor-video/media/${encodeURIComponent(id)}`, {
    method: "POST", headers: { "Content-Type": file.type || "video/mp4", "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ name: file.name, contentType: file.type || "video/mp4" })) }, body: file,
  });
  const result = await jsonResponse(response);
  return result.media as EditorMediaEntry;
}

export function editorMediaUrl(id: string) { return `${LOCAL_DATA_URL}/files/editor-video/media/${encodeURIComponent(id)}`; }

export async function loadEditorProject(projectId: string) {
  const response = await localDataFetch(`/editor-video/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const result = await jsonResponse(response);
  return result.project;
}

export async function listEditorProjects() {
  const response = await localDataFetch("/editor-video/projects", { cache: "no-store" });
  const result = await jsonResponse(response);
  return Array.isArray(result.projects) ? result.projects as Array<{ projectId: string; project: unknown }> : [];
}
