import { localDataFetch } from "../../lib/local-data-client";
import type { ChromaSettings } from "./core/eye-processing";

export type FabricatorAssetKind = "eyes" | "eyebrows";

export type FabricatorAsset = {
  id: string;
  name: string;
  kind: FabricatorAssetKind;
  contentType: string;
  fileUrl: string;
  createdAt: string;
  chroma?: ChromaSettings;
  localOnly?: boolean;
};

const FALLBACK_KEY = "nymi-fabricador-modelos";

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
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(assets)); } catch { /* o arquivo principal continua no PC quando disponível */ }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function loadFabricatorAssets() {
  try {
    const response = await localDataFetch("/fabricador-modelos", { cache: "no-store" });
    if (!response.ok) throw new Error("Biblioteca indisponível");
    const assets = await response.json() as FabricatorAsset[];
    writeFallback(assets);
    return assets;
  } catch {
    return readFallback();
  }
}

export async function uploadFabricatorAsset(file: File, kind: FabricatorAssetKind, chroma: ChromaSettings) {
  const id = crypto.randomUUID();
  const asset: FabricatorAsset = {
    id,
    name: file.name || (kind === "eyes" ? "Folha de olhos" : "Folha de sobrancelhas"),
    kind,
    contentType: file.type || "image/png",
    fileUrl: "",
    createdAt: new Date().toISOString(),
    chroma,
  };
  try {
    const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": asset.contentType,
        "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ name: asset.name, kind, contentType: asset.contentType, createdAt: asset.createdAt, chroma })),
      },
      body: file,
    });
    if (!response.ok) throw new Error("Upload rejeitado");
    const result = await response.json() as { fileUrl: string };
    const saved = { ...asset, fileUrl: result.fileUrl };
    writeFallback([...readFallback().filter((entry) => entry.id !== id), saved]);
    return saved;
  } catch {
    const localOnly = { ...asset, fileUrl: await fileToDataUrl(file), localOnly: true };
    writeFallback([...readFallback().filter((entry) => entry.id !== id), localOnly]);
    return localOnly;
  }
}

export async function updateFabricatorAsset(assetId: string, chroma: ChromaSettings) {
  const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chroma }),
  });
  if (!response.ok) throw new Error("Não foi possível salvar o chroma do arquivo.");
  const assets = readFallback().map((asset) => asset.id === assetId ? { ...asset, chroma } : asset);
  writeFallback(assets);
  return chroma;
}

export async function deleteFabricatorAsset(asset: FabricatorAsset) {
  if (!asset.localOnly) {
    const response = await localDataFetch(`/fabricador-modelos/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Não foi possível excluir o arquivo salvo.");
  }
  writeFallback(readFallback().filter((entry) => entry.id !== asset.id));
}
