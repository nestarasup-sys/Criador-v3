import { localDataFetch } from "../../lib/local-data-client";
import type { ChromaSettings } from "./core/eye-processing";
import { DEFAULT_PRESET_PROFILE_ID, type PresetProfile, type PresetProfilesDocument } from "./fabricador-config";
import type { AssetPlacement, FaceEffectKind, FacePresetCollection, ManpuGrid } from "./types/eye-model";

export type FabricatorAssetKind = "eyes" | "eyebrows" | "mouths" | "mouths-talk" | FaceEffectKind;

export type FabricatorAsset = {
  id: string;
  name: string;
  kind: FabricatorAssetKind;
  contentType: string;
  fileUrl: string;
  createdAt: string;
  chroma?: ChromaSettings;
  grid?: ManpuGrid;
  placement?: AssetPlacement;
  localOnly?: boolean;
  pendingSync?: boolean;
  volatileOnly?: boolean;
};

const FALLBACK_KEY = "nymi-fabricador-modelos";
const PRESETS_FALLBACK_KEY = "nymi-fabricador-presets";
const PRESETS_DIRTY_KEY = "nymi-fabricador-presets-dirty";
const PRESET_PROFILES_FALLBACK_KEY = "nymi-fabricador-preset-profiles";
const PRESET_PROFILES_DIRTY_KEY = "nymi-fabricador-preset-profiles-dirty";
const volatileAssetIds = new Set<string>();

function readFallback() {
  if (typeof window === "undefined") return [] as FabricatorAsset[];
  try {
    const value = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
    return Array.isArray(value) ? value as FabricatorAsset[] : [];
  } catch {
    return [];
  }
}

function writeFallback(assets: FabricatorAsset[]) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(assets));
    return true;
  } catch {
    return false;
  }
}

function mergeAssets(serverAssets: FabricatorAsset[], localAssets: FabricatorAsset[]) {
  const serverIds = new Set(serverAssets.map((asset) => asset.id));
  return [
    ...serverAssets,
    ...localAssets.filter((asset) => asset.localOnly && !serverIds.has(asset.id)),
  ].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function readPresetFallbackState(): { presets: FacePresetCollection; valid: boolean } {
  if (typeof window === "undefined") return { presets: {}, valid: false };
  try {
    const raw = localStorage.getItem(PRESETS_FALLBACK_KEY);
    if (raw === null) return { presets: {}, valid: false };
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { presets: value as FacePresetCollection, valid: true }
      : { presets: {}, valid: false };
  } catch {
    return { presets: {}, valid: false };
  }
}

function writePresetFallback(presets: FacePresetCollection) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(PRESETS_FALLBACK_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

function readPresetProfilesFallbackState(): { document: PresetProfilesDocument; valid: boolean } {
  if (typeof window === "undefined") return { document: { version: 1, activeProfileId: DEFAULT_PRESET_PROFILE_ID, profiles: [] }, valid: false };
  try {
    const raw = localStorage.getItem(PRESET_PROFILES_FALLBACK_KEY);
    if (raw === null) return { document: { version: 1, activeProfileId: DEFAULT_PRESET_PROFILE_ID, profiles: [] }, valid: false };
    const value = JSON.parse(raw) as Partial<PresetProfilesDocument>;
    return value && value.version === 1 && typeof value.activeProfileId === "string" && Array.isArray(value.profiles)
      ? { document: value as PresetProfilesDocument, valid: true }
      : { document: { version: 1, activeProfileId: DEFAULT_PRESET_PROFILE_ID, profiles: [] }, valid: false };
  } catch {
    return { document: { version: 1, activeProfileId: DEFAULT_PRESET_PROFILE_ID, profiles: [] }, valid: false };
  }
}

function writePresetProfilesFallback(document: PresetProfilesDocument) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(PRESET_PROFILES_FALLBACK_KEY, JSON.stringify(document));
    return true;
  } catch {
    return false;
  }
}

function presetsAreDirty() {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(PRESETS_DIRTY_KEY) === "1"; } catch { return false; }
}

function markPresetsDirty(dirty: boolean) {
  if (typeof window === "undefined") return false;
  try {
    if (dirty) localStorage.setItem(PRESETS_DIRTY_KEY, "1");
    else localStorage.removeItem(PRESETS_DIRTY_KEY);
    return true;
  } catch {
    return false;
  }
}

function presetProfilesAreDirty() {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(PRESET_PROFILES_DIRTY_KEY) === "1"; } catch { return false; }
}

function markPresetProfilesDirty(dirty: boolean) {
  if (typeof window === "undefined") return false;
  try {
    if (dirty) localStorage.setItem(PRESET_PROFILES_DIRTY_KEY, "1");
    else localStorage.removeItem(PRESET_PROFILES_DIRTY_KEY);
    return true;
  } catch {
    return false;
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function persistAsset(asset: FabricatorAsset, body: Blob | File) {
  const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(asset.id)}`, {
    method: "POST",
    headers: {
      "Content-Type": asset.contentType,
      "X-Gacha-Meta": encodeURIComponent(JSON.stringify({
        name: asset.name,
        kind: asset.kind,
        contentType: asset.contentType,
        createdAt: asset.createdAt,
        chroma: asset.chroma,
        placement: asset.placement,
        grid: asset.grid,
      })),
    },
    body,
  });
  if (!response.ok) throw new Error("Upload rejeitado");
  const result = await response.json() as { fileUrl: string };
  volatileAssetIds.delete(asset.id);
  return { ...asset, fileUrl: result.fileUrl, localOnly: false, pendingSync: false, volatileOnly: false } satisfies FabricatorAsset;
}

async function syncLocalAsset(asset: FabricatorAsset) {
  if (!asset.localOnly || !asset.fileUrl.startsWith("data:")) return asset;
  const response = await fetch(asset.fileUrl);
  if (!response.ok) throw new Error("Não foi possível reabrir o asset local.");
  return persistAsset(asset, await response.blob());
}

export async function loadFabricatorAssets() {
  const localAssets = readFallback();
  try {
    const response = await localDataFetch("/fabricador-modelos", { cache: "no-store" });
    if (!response.ok) throw new Error("Biblioteca indisponível");
    const serverAssets = await response.json() as FabricatorAsset[];

    const recovered: FabricatorAsset[] = [];
    for (const localAsset of localAssets.filter((asset) => asset.localOnly)) {
      if (serverAssets.some((asset) => asset.id === localAsset.id)) continue;
      try { recovered.push(await syncLocalAsset(localAsset)); }
      catch { recovered.push(localAsset); }
    }

    const reconciledServerAssets = await Promise.all(serverAssets.map(async (serverAsset) => {
      const localAsset = localAssets.find((asset) => asset.id === serverAsset.id && asset.pendingSync && !asset.localOnly);
      if (!localAsset) return serverAsset;
      const updates = { chroma: localAsset.chroma, placement: localAsset.placement, grid: localAsset.grid };
      try {
        const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(serverAsset.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!response.ok) throw new Error("PATCH pendente rejeitado");
        return { ...serverAsset, ...updates, pendingSync: false };
      } catch {
        return { ...serverAsset, ...updates, pendingSync: true };
      }
    }));

    const merged = mergeAssets([...reconciledServerAssets, ...recovered.filter((asset) => !asset.localOnly)], recovered);
    writeFallback(merged);
    return merged;
  } catch {
    return localAssets;
  }
}

export async function uploadFabricatorAsset(file: File, kind: FabricatorAssetKind, chroma: ChromaSettings, grid?: ManpuGrid) {
  const id = crypto.randomUUID();
  const asset: FabricatorAsset = {
    id,
    name: file.name || (kind === "eyes" ? "Folha de olhos" : kind === "eyebrows" ? "Folha de sobrancelhas" : "Asset do Fabricador"),
    kind,
    contentType: file.type || "image/png",
    fileUrl: "",
    createdAt: new Date().toISOString(),
    chroma,
    ...(kind === "manpu" && grid ? { grid } : {}),
  };
  try {
    const saved = await persistAsset(asset, file);
    writeFallback([...readFallback().filter((entry) => entry.id !== id), saved]);
    return saved;
  } catch {
    const localOnly: FabricatorAsset = { ...asset, fileUrl: await fileToDataUrl(file), localOnly: true };
    const localSaved = writeFallback([...readFallback().filter((entry) => entry.id !== id), localOnly]);
    if (localSaved) {
      volatileAssetIds.delete(id);
      return localOnly;
    }
    volatileAssetIds.add(id);
    return { ...localOnly, volatileOnly: true };
  }
}

export async function updateFabricatorAsset(assetId: string, updates: { chroma?: ChromaSettings; placement?: AssetPlacement; grid?: ManpuGrid }) {
  if (volatileAssetIds.has(assetId)) {
    return { ...updates, pcSaved: false, localSaved: false, volatileOnly: true };
  }

  const currentAssets = readFallback();
  const localAsset = currentAssets.find((asset) => asset.id === assetId);
  let serverSaved = false;

  if (!localAsset?.localOnly) {
    try {
      const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      serverSaved = response.ok;
    } catch {
      serverSaved = false;
    }
  }

  if (!localAsset) {
    if (!serverSaved) throw new Error("Não foi possível persistir o ajuste deste asset.");
    return { ...updates, pcSaved: true, localSaved: false };
  }

  const assets = currentAssets.map((asset) => asset.id === assetId ? {
    ...asset,
    ...updates,
    pendingSync: asset.localOnly ? asset.pendingSync : !serverSaved,
  } : asset);
  const localSaved = writeFallback(assets);
  if (!serverSaved && !localSaved) throw new Error("Não foi possível persistir o ajuste no PC nem no navegador.");
  return { ...updates, pcSaved: serverSaved, localSaved };
}

export async function deleteFabricatorAsset(asset: FabricatorAsset) {
  if (asset.volatileOnly || volatileAssetIds.has(asset.id)) {
    volatileAssetIds.delete(asset.id);
    return;
  }
  if (!asset.localOnly) {
    const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Não foi possível excluir o arquivo salvo.");
  }
  writeFallback(readFallback().filter((entry) => entry.id !== asset.id));
  volatileAssetIds.delete(asset.id);
}

async function persistPresets(presets: FacePresetCollection) {
  const response = await localDataFetch("/fabricador-modelos/presets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(presets),
  });
  if (!response.ok) throw new Error("Presets rejeitados");
}

export async function loadFabricatorPresets() {
  const localState = readPresetFallbackState();
  const localPresets = localState.presets;
  if (presetsAreDirty()) {
    if (localState.valid) {
      try {
        await persistPresets(localPresets);
        markPresetsDirty(false);
        return localPresets;
      } catch {
        return localPresets;
      }
    }
    // Nunca envie {} só porque a cópia local sumiu/corrompeu. Desarme o
    // marcador e recupere a fonte persistente do PC.
    markPresetsDirty(false);
  }

  try {
    const response = await localDataFetch("/fabricador-modelos/presets", { cache: "no-store" });
    if (!response.ok) throw new Error("Presets indisponíveis");
    const presets = await response.json() as FacePresetCollection;
    writePresetFallback(presets);
    return presets;
  } catch {
    return localPresets;
  }
}

export async function saveFabricatorPresets(presets: FacePresetCollection) {
  const localWritten = writePresetFallback(presets);
  const dirtyMarked = localWritten ? markPresetsDirty(true) : false;
  let pcSaved = false;
  try {
    await persistPresets(presets);
    markPresetsDirty(false);
    pcSaved = true;
  } catch {
    // Só é recuperação durável offline quando tanto o JSON quanto o marcador
    // pendente foram gravados; caso contrário a UI deve avisar que é sessão.
  }
  const localSaved = localWritten && (dirtyMarked || pcSaved);
  return { presets, pcSaved, localSaved };
}

async function persistPresetProfiles(document: PresetProfilesDocument) {
  const response = await localDataFetch("/fabricador-modelos/preset-profiles", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) throw new Error("Perfis de presets rejeitados");
}

function legacyProfile(presets: FacePresetCollection): PresetProfile {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_PRESET_PROFILE_ID,
    name: "Padrão",
    description: "Conjunto base finalizado do Fabricador.",
    createdAt: now,
    updatedAt: now,
    presets,
  };
}

export async function loadFabricatorPresetProfiles(): Promise<PresetProfilesDocument> {
  const localState = readPresetProfilesFallbackState();
  if (presetProfilesAreDirty() && localState.valid) {
    try {
      await persistPresetProfiles(localState.document);
      markPresetProfilesDirty(false);
      return localState.document;
    } catch {
      return localState.document;
    }
  }

  try {
    const response = await localDataFetch("/fabricador-modelos/preset-profiles", { cache: "no-store" });
    if (!response.ok) throw new Error("Perfis indisponíveis");
    const document = await response.json() as PresetProfilesDocument;
    writePresetProfilesFallback(document);
    return document;
  } catch {
    const legacyPresets = await loadFabricatorPresets();
    const document: PresetProfilesDocument = {
      version: 1,
      activeProfileId: DEFAULT_PRESET_PROFILE_ID,
      profiles: [legacyProfile(legacyPresets)],
    };
    writePresetProfilesFallback(document);
    return document;
  }
}

export async function saveFabricatorPresetProfiles(document: PresetProfilesDocument) {
  const localWritten = writePresetProfilesFallback(document);
  const dirtyMarked = localWritten ? markPresetProfilesDirty(true) : false;
  let pcSaved = false;
  try {
    await persistPresetProfiles(document);
    markPresetProfilesDirty(false);
    pcSaved = true;
  } catch {
    // Mantém uma cópia local pendente quando o servidor estiver indisponível.
  }
  const localSaved = localWritten && (dirtyMarked || pcSaved);
  return { document, pcSaved, localSaved };
}
