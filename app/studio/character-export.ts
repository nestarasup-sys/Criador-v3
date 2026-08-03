"use client";

import JSZip from "jszip";
import { renderStudioCharacter } from "./character-renderer";
import type { Character, ExpressionKey, PcCatalogItem, PcExpressionPack } from "./types";

const PACK_EXPRESSION_KEYS = [
  "normal", "normal_blink", "normal_talk",
  "serio", "serio_blink", "serio_talk",
  "raiva", "raiva_blink", "raiva_talk",
] as const satisfies readonly ExpressionKey[];

const STANDARD_BASE_EXPRESSION_KEYS = [
  ...PACK_EXPRESSION_KEYS,
  "assustado", "assustado_blink", "assustado_talk",
  "corado", "corado_blink", "corado_talk",
  "envergonhado", "envergonhado_blink", "envergonhado_talk",
  "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
  "surpreso", "surpreso_blink", "surpreso_talk",
] as const satisfies readonly ExpressionKey[];

const NEW_BASE_EXPRESSION_KEYS = [
  ...PACK_EXPRESSION_KEYS,
  "assustado", "assustado_blink", "assustado_talk",
  "assustado_2", "assustado_2_blink", "assustado_2_talk",
  "corado", "corado_blink", "corado_talk",
  "corado_2", "corado_2_blink", "corado_2_talk",
  "corado_3", "corado_3_blink", "corado_3_talk",
  "corado_4", "corado_4_blink", "corado_4_talk",
  "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
  "surpreso", "surpreso_blink", "surpreso_talk",
  "surpreso_2", "surpreso_2_blink", "surpreso_2_talk",
] as const satisfies readonly ExpressionKey[];

function normalizedPackId(value?: string) {
  if (!value || value === "padrao") return "modelo-1";
  const legacy = value.match(/^pack-(\d+)$/);
  return legacy ? `modelo-${Number(legacy[1]) + 1}` : value;
}

export function expressionKeysForCharacter(
  character: Character,
  packs: PcExpressionPack[] = [],
  modelPacks: Record<string, Array<{ id: string; expressionKeys: string[] }>> = {},
): readonly ExpressionKey[] {
  if (character.faceMode !== "base") {
    const pack = packs.find((item) => item.id === character.expressionPackId);
    if (pack?.frames.length) return pack.frames.map((frame) => frame.key);
    return PACK_EXPRESSION_KEYS;
  }
  const discovered = modelPacks[character.model]?.find((pack) => pack.id === normalizedPackId(character.basePackId));
  if (discovered?.expressionKeys?.includes("normal")) return discovered.expressionKeys as ExpressionKey[];
  return normalizedPackId(character.basePackId) === "modelo-1"
    ? STANDARD_BASE_EXPRESSION_KEYS
    : NEW_BASE_EXPRESSION_KEYS;
}

async function dataUrlBlob(dataUrl: string) {
  return fetch(dataUrl).then((response) => response.blob());
}

async function frameBlob(frame: { fileUrl: string }) {
  const response = await fetch(frame.fileUrl);
  if (!response.ok) throw new Error(`Não foi possível ler ${frame.fileUrl}`);
  return response.blob();
}

function safeFolderName(value: string) {
  const cleaned = String(value || "Sem nome")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "personagem";
}

export type CharacterBundleOptions = {
  folderName: string;
  character: { id?: string; name: string; model: string; basePackId?: string; basePackName?: string; faceMode?: string };
  usesBuiltInBase: boolean;
  expressions: readonly string[];
  renderPreview: () => Promise<Blob>;
  renderComplete: (key: string) => Promise<Blob>;
  renderWithoutFace?: () => Promise<Blob>;
  faceFrame?: (key: string) => Promise<Blob | null>;
};

/** Núcleo compartilhado do ZIP: o Criador e os Roteiros passam apenas seus renderizadores. */
export async function createCharacterBundle(options: CharacterBundleOptions) {
  const zip = new JSZip();
  const root = zip.folder(safeFolderName(options.folderName));
  if (!root) throw new Error("Falha ao criar pasta do personagem");
  const expressions = options.expressions;
  root.file("preview.png", await options.renderPreview());
  if (options.usesBuiltInBase) {
    for (const key of expressions) root.file(`${key}.png`, await options.renderComplete(key));
  } else {
    const facesFolder = root.folder("rostos");
    const completeFolder = root.folder("completos");
    const baseFolder = root.folder("base");
    if (!facesFolder || !completeFolder || !baseFolder || !options.renderWithoutFace || !options.faceFrame) throw new Error("Pack de rosto incompleto");
    baseFolder.file("personagem_sem_rosto.png", await options.renderWithoutFace());
    for (const key of expressions) {
      const face = await options.faceFrame(key);
      if (!face) throw new Error(`Expressão ausente: ${key}`);
      facesFolder.file(`${key}.png`, face);
      completeFolder.file(`${key}.png`, await options.renderComplete(key));
    }
  }
  root.file("manifest.json", JSON.stringify({
    format: "gacha-maker-expression-pack",
    version: 1,
    character: { id: options.character.id, name: options.character.name.trim() || "Sem nome", model: options.character.model, basePackId: options.character.basePackId, basePackName: options.character.basePackName, faceMode: options.character.faceMode },
    canvas: { width: 1920, height: 1080 },
    expressions,
    output: options.usesBuiltInBase ? "final-character-frames" : "faces-and-complete-frames",
    generatedAt: new Date().toISOString(),
  }, null, 2));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** Monta exatamente a estrutura de um ZIP do Criador, agora reutilizável pelos Roteiros. */
export async function buildCharacterBundle(character: Character, catalog: PcCatalogItem[], packs: PcExpressionPack[], modelPacks: Record<string, Array<{ id: string; expressionKeys: string[] }>> = {}) {
  const keys = expressionKeysForCharacter(character, packs, modelPacks);
  const usesBuiltInBase = character.faceMode === "base";
  const pack = packs.find((item) => item.id === character.expressionPackId);
  return createCharacterBundle({
    folderName: character.name,
    character: { ...character, id: character.id },
    usesBuiltInBase,
    expressions: keys,
    renderPreview: async () => dataUrlBlob(await renderStudioCharacter(character, keys[0], catalog, packs)),
    renderComplete: async (key) => dataUrlBlob(await renderStudioCharacter(character, key as ExpressionKey, catalog, packs)),
    renderWithoutFace: async () => dataUrlBlob(await renderStudioCharacter({ ...character, faceMode: "base" }, "normal", catalog, packs)),
    faceFrame: async (key) => {
      const frame = pack?.frames.find((item) => item.key === key);
      return frame ? frameBlob(frame) : null;
    },
  });
}
