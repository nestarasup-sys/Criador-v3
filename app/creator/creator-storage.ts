import { normalizeBasePackId } from "../domain/base-model.mjs";
import { ALL_BASE_EXPRESSION_KEYS, type ExpressionKey } from "../domain/expression-contract";
import type { Character } from "../domain/character-contract";
import type { BasePackCollection } from "./base-packs";
import type {
  CatalogItem,
  ExpressionFrame,
  ExpressionPack,
  PcCatalogItem,
  PcExpressionPack,
} from "../domain/catalog-contract";
import type { Model } from "../domain/character-primitives";
import { DEFAULT_BASE_PACKS } from "./base-packs";
import { localDataFetch } from "../lib/local-data-client";

const DB_NAME = "gacha-maker";
const DB_VERSION = 2;
const STORE_NAME = "catalog";
const PACK_STORE_NAME = "expressionPacks";
export const CHARACTER_KEY = "gacha-maker-characters";

export type PcState = {
  characters: Character[];
  catalog: PcCatalogItem[];
  expressionPacks: PcExpressionPack[];
};

type PcBasePackDefinition = {
  id: string;
  name: string;
  expressionKeys: string[];
  source: string;
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
  const response = await pcRequest("/models");
  const discovered = await response.json() as PcBasePackCollection;
  return Object.fromEntries((['feminino', 'masculino'] as Model[]).map((gender) => {
    const validModels = (discovered[gender] ?? []).map((pack) => ({
      ...pack,
      expressionKeys: pack.expressionKeys.filter((key): key is ExpressionKey =>
        (ALL_BASE_EXPRESSION_KEYS as readonly string[]).includes(key),
      ),
    })).filter((pack) => pack.expressionKeys.includes("normal"));
    return [gender, validModels.length > 0 ? validModels : DEFAULT_BASE_PACKS[gender]];
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

export async function saveCharactersToPc(characters: Character[]) {
  const charactersWithoutPhotos = characters.map(({ photoUrl: _photoUrl, photoDataUrl: _photoDataUrl, ...character }) => {
    void _photoUrl;
    void _photoDataUrl;
    return character;
  });
  await pcRequest("/characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(charactersWithoutPhotos) });
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

export async function saveExpressionPackToPc(pack: ExpressionPack) {
  await Promise.all(pack.frames.map((frame) => pcRequest(`/packs/${encodeURIComponent(pack.id)}/${encodeURIComponent(frame.key)}`, {
    method: "POST",
    headers: { "Content-Type": "image/png", "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ name: pack.name, model: pack.model, basePackId: normalizeBasePackId(pack.basePackId), createdAt: pack.createdAt, width: frame.width, height: frame.height })) },
    body: frame.blob,
  })));
}

export async function deleteExpressionPackFromPc(id: string) {
  await pcRequest(`/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
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
  const catalog = (await mapWithConcurrency(normalizedPcCatalog, 6, async (item) => {
    try {
      const response = await fetch(item.fileUrl, { cache: "no-store" });
      if (!response.ok) return null;
      const blob = await response.blob();
      const { fileUrl: _fileUrl, ...metadata } = item;
      void _fileUrl;
      return { ...metadata, blob, url: URL.createObjectURL(blob) } as CatalogItem;
    } catch {
      return null;
    }
  })).filter((item): item is CatalogItem => item !== null);
  const expressionPacks: ExpressionPack[] = (await mapWithConcurrency(pcState.expressionPacks ?? [], 4, async (pack) => {
    const frames = (await mapWithConcurrency(pack.frames ?? [], 6, async (frame) => {
      try {
        const response = await fetch(frame.fileUrl, { cache: "no-store" });
        if (!response.ok) return null;
        const blob = await response.blob();
        const { fileUrl: _fileUrl, ...metadata } = frame;
        void _fileUrl;
        return { ...metadata, blob, url: URL.createObjectURL(blob) } as ExpressionFrame;
      } catch {
        return null;
      }
    })).filter((frame): frame is ExpressionFrame => frame !== null);
    return frames.length > 0 ? { ...pack, frames } : null;
  })).filter((pack): pack is ExpressionPack => pack !== null);
  return {
    characters: (pcState.characters ?? []).map((character) => ({ ...character, basePackId: normalizeBasePackId(character.basePackId) })),
    catalog,
    expressionPacks: expressionPacks.map((pack) => ({ ...pack, basePackId: normalizeBasePackId(pack.basePackId) })),
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

export async function storeCatalogItem(item: CatalogItem) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ ...item, url: undefined });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  await saveCatalogItemToPc(item).catch(() => undefined);
}

export async function deleteCatalogItem(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  await deleteCatalogItemFromPc(id).catch(() => undefined);
}

export async function loadExpressionPacks() {
  const db = await openDatabase();
  return new Promise<ExpressionPack[]>((resolve, reject) => {
    const request = db.transaction(PACK_STORE_NAME, "readonly").objectStore(PACK_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as ExpressionPack[]);
    request.onerror = () => reject(request.error);
  });
}

export async function storeExpressionPack(pack: ExpressionPack) {
  const db = await openDatabase();
  const storedPack = { ...pack, frames: pack.frames.map((frame) => ({ key: frame.key, blob: frame.blob, width: frame.width, height: frame.height })) };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE_NAME, "readwrite");
    transaction.objectStore(PACK_STORE_NAME).put(storedPack);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  await saveExpressionPackToPc(pack).catch(() => undefined);
}

export async function deleteExpressionPack(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PACK_STORE_NAME, "readwrite");
    transaction.objectStore(PACK_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  await deleteExpressionPackFromPc(id).catch(() => undefined);
}
