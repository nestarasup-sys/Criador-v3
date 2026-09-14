import { normalizeBasePackId } from "../domain/base-model.mjs";
import { isExpressionKey, type ExpressionKey } from "../domain/expression-contract";
import type { Character } from "../domain/character-contract";
import type { BasePackCollection } from "./base-packs";
import type {
  CatalogItem,
  ExpressionFrame,
  ExpressionPack,
  PcCatalogItem,
  PcExpressionFrame,
  PcExpressionPack,
} from "../domain/catalog-contract";
import type { Model } from "../domain/character-primitives";
import { localDataFetch } from "../lib/local-data-client";

const DB_NAME = "gacha-maker";
const DB_VERSION = 2;
const STORE_NAME = "catalog";
const PACK_STORE_NAME = "expressionPacks";
export const CHARACTER_KEY = "gacha-maker-characters";
const CATALOG_TOMBSTONES_KEY = "gacha-maker-catalog-tombstones";
const PACK_TOMBSTONES_KEY = "gacha-maker-expression-pack-tombstones";
let pcPersistenceDegraded = false;

export type LocalDeletionTombstone = { id: string; deletedAt: string };
export type LocalPersistenceResult = { pcSaved: boolean };

export type PcState = {
  characters: Character[];
  catalog: PcCatalogItem[];
  expressionPacks: PcExpressionPack[];
};

function readTombstones(key: string): LocalDeletionTombstone[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is LocalDeletionTombstone =>
      Boolean(entry)
      && typeof entry.id === "string"
      && typeof entry.deletedAt === "string",
    );
  } catch {
    return [];
  }
}

function writeTombstones(key: string, tombstones: LocalDeletionTombstone[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(tombstones));
  } catch {
    // A quota/privacidade restrita não pode transformar uma exclusão local em erro fatal.
  }
}

function recordTombstone(key: string, id: string) {
  const next = readTombstones(key).filter((entry) => entry.id !== id);
  next.push({ id, deletedAt: new Date().toISOString() });
  writeTombstones(key, next);
}

function clearTombstone(key: string, id: string) {
  writeTombstones(key, readTombstones(key).filter((entry) => entry.id !== id));
}

export function loadCatalogTombstones() {
  return readTombstones(CATALOG_TOMBSTONES_KEY);
}

export function loadExpressionPackTombstones() {
  return readTombstones(PACK_TOMBSTONES_KEY);
}

export function clearCatalogTombstone(id: string) {
  clearTombstone(CATALOG_TOMBSTONES_KEY, id);
}

export function clearExpressionPackTombstone(id: string) {
  clearTombstone(PACK_TOMBSTONES_KEY, id);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function catalogComparable(item: CatalogItem | PcCatalogItem) {
  const { blob: _blob, url: _url, fileUrl: _fileUrl, ...metadata } = item as CatalogItem & PcCatalogItem;
  void _blob;
  void _url;
  void _fileUrl;
  return metadata;
}

export function catalogItemNeedsMigration(localItem: CatalogItem, pcItem: PcCatalogItem | CatalogItem | undefined) {
  if (!pcItem) return true;
  const localRevision = Date.parse(localItem.updatedAt ?? "");
  const pcRevision = Date.parse(pcItem.updatedAt ?? "");
  if (Number.isFinite(localRevision) && (!Number.isFinite(pcRevision) || localRevision > pcRevision)) return true;
  return stableSerialize(catalogComparable(localItem)) !== stableSerialize(catalogComparable(pcItem));
}

export function expressionPackNeedsMigration(localPack: ExpressionPack, pcPack: PcExpressionPack | ExpressionPack | undefined) {
  if (!pcPack) return true;
  const localRevision = Date.parse(localPack.updatedAt ?? "");
  const pcRevision = Date.parse(pcPack.updatedAt ?? "");
  if (Number.isFinite(localRevision) && (!Number.isFinite(pcRevision) || localRevision > pcRevision)) return true;
  const localFrames = localPack.frames.map((entry) => {
    const { blob: _blob, url: _url, ...frame } = entry as ExpressionFrame & PcExpressionFrame;
    void _blob;
    void _url;
    return frame;
  });
  const pcFrames = pcPack.frames.map((entry) => {
    const { fileUrl: _fileUrl, ...frame } = entry as ExpressionFrame & PcExpressionFrame;
    void _fileUrl;
    return frame;
  });
  return stableSerialize({ ...localPack, frames: localFrames }) !== stableSerialize({ ...pcPack, frames: pcFrames });
}

function notifyPcPersistenceFailure(kind: "catalog" | "expressionPack", error: unknown) {
  if (typeof window === "undefined") return;
  pcPersistenceDegraded = true;
  const message = error instanceof Error ? error.message : "serviço local indisponível";
  window.setTimeout(() => window.dispatchEvent(new CustomEvent("nymi:pc-persistence-failed", {
    detail: { kind, message },
  })), 0);
}

function notifyPcPersistenceRecovered() {
  if (typeof window === "undefined" || !pcPersistenceDegraded) return;
  pcPersistenceDegraded = false;
  window.setTimeout(() => window.dispatchEvent(new CustomEvent("nymi:pc-persistence-recovered")), 0);
}

type PcBasePackDefinition = {
  id: string;
  name: string;
  expressionKeys: string[];
  expressionAliases?: Record<string, string>;
  source: string;
  version?: string;
  catalogVersion?: "v0" | "v1";
};
type PcBasePackCollection = Record<Model, PcBasePackDefinition[]>;

async function pcRequest(path: string, init?: RequestInit) {
  const response = await localDataFetch(path, init);
  if (!response.ok) throw new Error(`Armazenamento local indisponível (${response.status})`);
  return response;
}

export async function loadPcState(): Promise<PcState> {
  const response = await pcRequest("/state");
  return response.json();
}

export async function loadPcModels(): Promise<BasePackCollection> {
  const response = await pcRequest("/models", { cache: "no-store" });
  const discovered = await response.json() as PcBasePackCollection;
  return Object.fromEntries((['feminino', 'masculino'] as Model[]).map((gender) => {
    const validModels = (discovered[gender] ?? []).map((pack) => ({
      ...pack,
      expressionKeys: pack.expressionKeys.filter((key): key is ExpressionKey => isExpressionKey(key)),
    })).filter((pack) => pack.expressionKeys.includes("normal"));
    return [gender, validModels];
  })) as unknown as BasePackCollection;
}

function legacyOutfitOrder(item: Pick<CatalogItem, "outfitVariantIndex" | "outfitPoseId" | "basePackId" | "outfitCover">) {
  if (typeof item.outfitVariantIndex === "number") return item.outfitVariantIndex;
  const legacyId = item.outfitPoseId ?? item.basePackId;
  if (legacyId === "padrao" || legacyId === "modelo-1") return 0;
  const legacyPack = legacyId?.match(/^(?:pack|modelo)-(\d+)$/);
  if (legacyPack) return legacyId?.startsWith("pack-") ? Number(legacyPack[1]) : Math.max(0, Number(legacyPack[1]) - 1);
  return item.outfitCover ? 0 : Number.MAX_SAFE_INTEGER;
}

export function normalizeOutfitCatalog<T extends CatalogItem | PcCatalogItem>(items: T[]): T[] {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    if (item.category === "roupas" && item.outfitGroupId) grouped.set(item.outfitGroupId, [...(grouped.get(item.outfitGroupId) ?? []), item]);
  });
  const variantIndexes = new Map<string, number>();
  grouped.forEach((groupItems) => {
    groupItems.sort((left, right) => legacyOutfitOrder(left) - legacyOutfitOrder(right)).forEach((item, index) => variantIndexes.set(item.id, index));
  });
  return items.map((item) => {
    if (item.category !== "roupas") return item;
    return {
      ...item,
      basePackId: undefined,
      outfitPoseId: undefined,
      outfitVariantIndex: item.outfitGroupId ? variantIndexes.get(item.id) ?? 0 : undefined,
      outfitCover: item.outfitGroupId ? (variantIndexes.get(item.id) ?? 0) === 0 : undefined,
    } as T;
  });
}

let characterSaveQueue: Promise<void> = Promise.resolve();

export function saveCharactersToPc(characters: Character[]) {
  const charactersWithoutPhotos = characters.map(({ photoUrl: _photoUrl, photoDataUrl: _photoDataUrl, ...character }) => {
    void _photoUrl;
    void _photoDataUrl;
    return character;
  });
  const body = JSON.stringify(charactersWithoutPhotos);
  const operation = characterSaveQueue
    .catch(() => undefined)
    .then(async () => {
      await pcRequest("/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    });
  characterSaveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function uploadCharacterPhotoToPc(characterId: string, blob: Blob) {
  const response = await pcRequest(`/characters/${encodeURIComponent(characterId)}/photo`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
  const result = await response.json() as { photoUrl?: string };
  if (!result.photoUrl) throw new Error("O servidor não retornou a foto salva");
  return result.photoUrl;
}

export async function saveCatalogItemToPc(item: CatalogItem) {
  const { blob, url: _url, ...metadata } = item;
  void _url;
  await pcRequest(`/catalog/${encodeURIComponent(item.id)}`, { method: "POST", headers: { "Content-Type": "image/png", "X-Gacha-Meta": encodeURIComponent(JSON.stringify(metadata)) }, body: blob });
}

export async function deleteCatalogItemFromPc(id: string) {
  await pcRequest(`/catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
}

let expressionPackPcQueue: Promise<void> = Promise.resolve();

function enqueueExpressionPackPc<T>(operation: () => Promise<T>) {
  const result = expressionPackPcQueue.catch(() => undefined).then(operation);
  expressionPackPcQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function expressionPackFrameKeysToDelete(previousKeys: readonly string[], nextKeys: readonly string[]) {
  const next = new Set(nextKeys);
  return previousKeys.filter((key) => !next.has(key));
}

export function saveExpressionPackToPc(pack: ExpressionPack) {
  // A pack is persisted one frame at a time because each request updates the
  // same state.json record. Serialize all pack operations and remove frames
  // that no longer belong to the current snapshot; otherwise editing a pack
  // from 3 frames to 2 silently leaves the old third frame on disk.
  return enqueueExpressionPackPc(async () => {
    const currentState = await loadPcState();
    const previousPack = currentState.expressionPacks.find((entry) => entry.id === pack.id);
    const obsoleteKeys = expressionPackFrameKeysToDelete(
      previousPack?.frames.map((frame) => frame.key) ?? [],
      pack.frames.map((frame) => frame.key),
    );
    for (const key of obsoleteKeys) {
      await pcRequest(`/packs/${encodeURIComponent(pack.id)}/${encodeURIComponent(key)}`, { method: "DELETE" });
    }
    for (const frame of pack.frames) await pcRequest(`/packs/${encodeURIComponent(pack.id)}/${encodeURIComponent(frame.key)}`, {
      method: "POST",
      headers: { "Content-Type": "image/png", "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ name: pack.name, model: pack.model, basePackId: normalizeBasePackId(pack.basePackId), createdAt: pack.createdAt, width: frame.width, height: frame.height })) },
      body: frame.blob,
    });
  });
}

export function deleteExpressionPackFromPc(id: string) {
  return enqueueExpressionPackPc(async () => {
    await pcRequest(`/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
  });
}

export async function deleteBaseModelFromPc(gender: Model, id: string) {
  await pcRequest(`/models/modelos/${encodeURIComponent(gender)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateBaseModelCatalogVersion(gender: Model, id: string, catalogVersion: "v0" | "v1") {
  const response = await pcRequest(`/models/modelos/${encodeURIComponent(gender)}/${encodeURIComponent(id)}/catalog`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalogVersion }),
  });
  return response.json() as Promise<{ ok: true; gender: Model; id: string; catalogVersion: "v0" | "v1" }>;
}

export async function saveModelColorMapToPc(gender: Model, modelId: string, expressionKey: string, blob: Blob) {
  await pcRequest(`/models/modelos/${encodeURIComponent(gender)}/${encodeURIComponent(modelId)}/color-map/${encodeURIComponent(expressionKey)}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });
}

/**
 * Hydrates local assets without opening hundreds of image requests at once.
 * A small fixed concurrency keeps startup responsive and avoids a large
 * transient memory spike when a catalog contains many sheets/variants.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

export async function hydratePcState(pcState: PcState) {
  const normalizedPcCatalog = normalizeOutfitCatalog(pcState.catalog);
  const missingCatalogIds: string[] = [];
  const catalog = (await mapWithConcurrency(normalizedPcCatalog, 6, async (item) => {
    try {
      const response = await fetch(item.fileUrl, { cache: "no-store" });
      if (!response.ok) {
        missingCatalogIds.push(item.id);
        return null;
      }
      const blob = await response.blob();
      const { fileUrl: _fileUrl, ...metadata } = item;
      void _fileUrl;
      return { ...metadata, blob, url: URL.createObjectURL(blob) } as CatalogItem;
    } catch {
      missingCatalogIds.push(item.id);
      return null;
    }
  })).filter((item): item is CatalogItem => item !== null);
  const missingExpressionPackFrames: string[] = [];
  const expressionPacks: ExpressionPack[] = (await mapWithConcurrency(pcState.expressionPacks ?? [], 4, async (pack) => {
    const frames = (await mapWithConcurrency(pack.frames ?? [], 6, async (frame) => {
      try {
        const response = await fetch(frame.fileUrl, { cache: "no-store" });
        if (!response.ok) {
          missingExpressionPackFrames.push(`${pack.id}:${frame.key}`);
          return null;
        }
        const blob = await response.blob();
        const { fileUrl: _fileUrl, ...metadata } = frame;
        void _fileUrl;
        return { ...metadata, blob, url: URL.createObjectURL(blob) } as ExpressionFrame;
      } catch {
        missingExpressionPackFrames.push(`${pack.id}:${frame.key}`);
        return null;
      }
    })).filter((frame): frame is ExpressionFrame => frame !== null);
    return frames.length > 0 ? { ...pack, frames } : null;
  })).filter((pack): pack is ExpressionPack => pack !== null);
  return {
    characters: (pcState.characters ?? []).map((character) => ({ ...character, basePackId: normalizeBasePackId(character.basePackId) })),
    catalog,
    expressionPacks: expressionPacks.map((pack) => ({ ...pack, basePackId: normalizeBasePackId(pack.basePackId) })),
    missingCatalogIds,
    missingExpressionPackFrames,
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PACK_STORE_NAME)) db.createObjectStore(PACK_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

export async function loadCatalog() {
  const db = await openDatabase();
  return new Promise<CatalogItem[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as CatalogItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function storeCatalogItem(item: CatalogItem): Promise<CatalogItem & LocalPersistenceResult> {
  const persistedItem: CatalogItem = { ...item, updatedAt: new Date().toISOString() };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ ...persistedItem, url: undefined });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  try {
    await saveCatalogItemToPc(persistedItem);
    clearCatalogTombstone(persistedItem.id);
    notifyPcPersistenceRecovered();
    return Object.assign(persistedItem, { pcSaved: true });
  } catch (error) {
    notifyPcPersistenceFailure("catalog", error);
    return Object.assign(persistedItem, { pcSaved: false });
  }
}

export async function deleteCatalogItem(id: string): Promise<LocalPersistenceResult> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  recordTombstone(CATALOG_TOMBSTONES_KEY, id);
  try {
    await deleteCatalogItemFromPc(id);
    clearCatalogTombstone(id);
    notifyPcPersistenceRecovered();
    return { pcSaved: true };
  } catch (error) {
    notifyPcPersistenceFailure("catalog", error);
    return { pcSaved: false };
  }
}

export async function loadExpressionPacks() {
  const db = await openDatabase();
  return new Promise<ExpressionPack[]>((resolve, reject) => {
    const request = db.transaction(PACK_STORE_NAME, "readonly").objectStore(PACK_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as ExpressionPack[]);
    request.onerror = () => reject(request.error);
  });
}

export async function storeExpressionPack(pack: ExpressionPack): Promise<ExpressionPack & LocalPersistenceResult> {
  const persistedPack: ExpressionPack = { ...pack, updatedAt: new Date().toISOString() };
  const db = await openDatabase();
  const storedPack = { ...persistedPack, frames: persistedPack.frames.map((frame) => ({ key: frame.key, blob: frame.blob, width: frame.width, height: frame.height })) };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE_NAME, "readwrite");
    transaction.objectStore(PACK_STORE_NAME).put(storedPack);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  try {
    await saveExpressionPackToPc(persistedPack);
    clearExpressionPackTombstone(persistedPack.id);
    notifyPcPersistenceRecovered();
    return Object.assign(persistedPack, { pcSaved: true });
  } catch (error) {
    notifyPcPersistenceFailure("expressionPack", error);
    return Object.assign(persistedPack, { pcSaved: false });
  }
}

export async function deleteExpressionPack(id: string): Promise<LocalPersistenceResult> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE_NAME, "readwrite");
    transaction.objectStore(PACK_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  recordTombstone(PACK_TOMBSTONES_KEY, id);
  try {
    await deleteExpressionPackFromPc(id);
    clearExpressionPackTombstone(id);
    notifyPcPersistenceRecovered();
    return { pcSaved: true };
  } catch (error) {
    notifyPcPersistenceFailure("expressionPack", error);
    return { pcSaved: false };
  }
}
