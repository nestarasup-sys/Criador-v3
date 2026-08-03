import type { AppData, Character, Studio, StudioAsset } from "./types";
import { localDataFetch } from "../lib/local-data-client";
import { normalizeBasePackId } from "../domain/base-model.mjs";

const STUDIO_KEY = "gacha-maker-studios";
const STUDIO_DELETION_KEY = "gacha-maker-studio-deletions";
const CHARACTER_KEY = "gacha-maker-characters";
let studioSaveQueue: Promise<void> = Promise.resolve();
type StudioDeletion = { id: string; deletedAt: string };

export type LoadedAppData = AppData & {
  pcStorageAvailable: boolean;
  migrationAvailable: boolean;
  browserStudios: Studio[];
  pcStudios: Studio[];
};

function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function normalizeCharacterModels(characters: Character[]) {
  return characters.map((character) => ({
    ...character,
    basePackId: normalizeBasePackId(character.basePackId),
  }));
}

function modifiedAt(studio: Studio) {
  const time = new Date(studio.updatedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergeStudios(pcStudios: Studio[], browserStudios: Studio[], deletions: StudioDeletion[] = []) {
  const merged = new Map<string, Studio>();
  for (const studio of [...pcStudios, ...browserStudios]) {
    const current = merged.get(studio.id);
    if (!current || modifiedAt(studio) > modifiedAt(current)) merged.set(studio.id, studio);
  }
  for (const deletion of deletions) {
    const studio = merged.get(deletion.id);
    if (studio && new Date(deletion.deletedAt).getTime() >= modifiedAt(studio)) merged.delete(deletion.id);
  }
  return [...merged.values()].sort((a, b) => modifiedAt(b) - modifiedAt(a));
}

function hasBrowserChanges(pcStudios: Studio[], browserStudios: Studio[], deletions: StudioDeletion[]) {
  return deletions.some((deletion) => pcStudios.some((studio) => studio.id === deletion.id && new Date(deletion.deletedAt).getTime() >= modifiedAt(studio)))
    || browserStudios.some((browserStudio) => {
    const pcStudio = pcStudios.find((studio) => studio.id === browserStudio.id);
    return !pcStudio || modifiedAt(browserStudio) > modifiedAt(pcStudio);
  });
}

async function pcRequest(path: string, init?: RequestInit) {
  const response = await localDataFetch(path, init);
  if (!response.ok) throw new Error(`Armazenamento do PC indisponível (${response.status})`);
  return response;
}

export function mirrorStudios(studios: Studio[]) {
  localStorage.setItem(STUDIO_KEY, JSON.stringify(studios));
}

export function recordStudioDeletion(id: string) {
  const deletions = readLocal<StudioDeletion[]>(STUDIO_DELETION_KEY, []).filter((entry) => entry.id !== id);
  localStorage.setItem(STUDIO_DELETION_KEY, JSON.stringify([...deletions, { id, deletedAt: new Date().toISOString() }]));
}

async function uploadAssetPayload(id: string, body: Blob, name: string, contentType: string) {
  const response = await pcRequest(`/studio-assets/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType || body.type || "application/octet-stream",
      "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ name, contentType: contentType || body.type })),
    },
    body,
  });
  const result = await response.json() as { fileUrl: string };
  return result.fileUrl;
}

async function persistEmbeddedAssets(studios: Studio[]) {
  const synchronized = structuredClone(studios);
  const uploaded = new Map<string, string>();

  async function permanentUrl(assetId: string, source: string, name: string) {
    if (!source.startsWith("data:")) return source;
    const existing = uploaded.get(assetId);
    if (existing) return existing;
    const blob = await fetch(source).then((response) => response.blob());
    const fileUrl = await uploadAssetPayload(assetId, blob, name, blob.type || "image/png");
    uploaded.set(assetId, fileUrl);
    return fileUrl;
  }

  for (const studio of synchronized) {
    if (studio.background) {
      studio.background.src = await permanentUrl(studio.background.assetId, studio.background.src, `fundo-${studio.name}`);
    }
    for (const object of studio.objects) {
      object.src = await permanentUrl(object.assetId, object.src, object.name || `objeto-${studio.name}`);
    }
  }
  return synchronized;
}

async function saveSnapshotToPc(studios: Studio[]) {
  const synchronized = await persistEmbeddedAssets(studios);
  await pcRequest("/studios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(synchronized),
  });
  localStorage.removeItem(STUDIO_DELETION_KEY);
  mirrorStudios(synchronized);
  return synchronized;
}

export async function loadAppData(): Promise<LoadedAppData> {
  const localCharacters = normalizeCharacterModels(readLocal<Character[]>(CHARACTER_KEY, []));
  const browserStudios = readLocal<Studio[]>(STUDIO_KEY, []);
  const browserDeletions = readLocal<StudioDeletion[]>(STUDIO_DELETION_KEY, []);
  try {
    const response = await pcRequest("/state", { cache: "no-store" });
    const data = await response.json() as Partial<AppData>;
    const pcStudios = data.studios ?? [];
    const migrationAvailable = hasBrowserChanges(pcStudios, browserStudios, browserDeletions);
    const studios = migrationAvailable ? mergeStudios(pcStudios, browserStudios, browserDeletions) : pcStudios;
    mirrorStudios(studios);
    return {
      characters: data.characters?.length ? normalizeCharacterModels(data.characters) : localCharacters,
      catalog: data.catalog ?? [],
      expressionPacks: data.expressionPacks ?? [],
      studios,
      studioAssets: data.studioAssets ?? [],
      pcStorageAvailable: true,
      migrationAvailable,
      browserStudios,
      pcStudios,
    };
  } catch {
    return {
      characters: localCharacters,
      studios: browserStudios,
      catalog: [],
      expressionPacks: [],
      studioAssets: [],
      pcStorageAvailable: false,
      migrationAvailable: browserStudios.length > 0,
      browserStudios,
      pcStudios: [],
    };
  }
}

export async function saveStudios(studios: Studio[]) {
  mirrorStudios(studios);
  const operation = studioSaveQueue
    .catch(() => undefined)
    .then(() => saveSnapshotToPc(studios));
  studioSaveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function migrateBrowserStudiosToPc(pcStudios: Studio[], browserStudios: Studio[]) {
  const deletions = readLocal<StudioDeletion[]>(STUDIO_DELETION_KEY, []);
  return saveStudios(mergeStudios(pcStudios, browserStudios, deletions));
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadStudioAsset(file: File): Promise<StudioAsset> {
  const id = crypto.randomUUID();
  try {
    const fileUrl = await uploadAssetPayload(id, file, file.name, file.type);
    return { id, name: file.name, contentType: file.type, fileUrl };
  } catch {
    return { id, name: file.name, contentType: file.type, fileUrl: await fileToDataUrl(file), localOnly: true };
  }
}

export async function saveStudioPrint(blob: Blob, studioName: string) {
  const response = await pcRequest("/prints", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ studioName })),
    },
    body: blob,
  });
  return response.json() as Promise<{ ok: true; fileName: string; filePath: string; bytes: number }>;
}

export async function openStudioPrintsFolder() {
  const response = await pcRequest("/prints/open", { method: "POST" });
  return response.json() as Promise<{ ok: true; folder: string }>;
}
