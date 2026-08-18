import { createId, createScriptAiContext, nowIso } from "./defaults";
import type { BaseDadosVideo } from "../base de dados/types";
import type { PremiumCharacter, ReactionBlock, RoteirosState, ScriptProject, TikTokSection } from "./types";

export const IMPORTABLE_SCRIPT_FORMAT = "NYMI_IMPORTABLE_SCRIPT_V1";

export type ImportableVideoChoice = { videoId: string; order: number };
export type ImportableCharacterChoice = { characterId: string; role?: string };
export type ImportableBlock = { type: "speech" | "thought"; characterId: string; videoId: string; text: string; startAt?: number };
export type ImportableScriptDocument = {
  format: typeof IMPORTABLE_SCRIPT_FORMAT;
  title: string;
  videos: ImportableVideoChoice[];
  characters: ImportableCharacterChoice[];
  blocks: ImportableBlock[];
};

export type ImportIssue = { level: "error" | "warning"; path: string; message: string };
export type ImportValidation = { success: boolean; data?: ImportableScriptDocument; issues: ImportIssue[] };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value);
}

function isAbsolutePath(value: unknown) {
  return typeof value === "string" && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/"));
}

export function validateImportableScript(value: unknown, videos: BaseDadosVideo[], characters: PremiumCharacter[]): ImportValidation {
  const source = record(value);
  const issues: ImportIssue[] = [];
  if (source.format !== IMPORTABLE_SCRIPT_FORMAT) issues.push({ level: "error", path: "format", message: `O formato precisa ser ${IMPORTABLE_SCRIPT_FORMAT}.` });
  const title = stringValue(source.title) || "Roteiro importado";
  if (!stringValue(source.title)) issues.push({ level: "warning", path: "title", message: "O título não foi informado; será usado um título padrão." });
  const videoMap = new Map(videos.map((video) => [video.id, video]));
  const characterMap = new Map(characters.map((character) => [character.id, character]));
  const rawVideos = Array.isArray(source.videos) ? source.videos : [];
  const rawCharacters = Array.isArray(source.characters) ? source.characters : [];
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks : [];
  if (!rawVideos.length) issues.push({ level: "error", path: "videos", message: "O roteiro precisa escolher pelo menos um vídeo." });
  if (!Array.isArray(source.videos)) issues.push({ level: "error", path: "videos", message: "videos precisa ser uma lista." });
  if (!Array.isArray(source.characters)) issues.push({ level: "error", path: "characters", message: "characters precisa ser uma lista." });
  if (!Array.isArray(source.blocks)) issues.push({ level: "error", path: "blocks", message: "blocks precisa ser uma lista." });

  const seenVideos = new Set<string>();
  const seenOrders = new Set<number>();
  const normalizedVideos: ImportableVideoChoice[] = [];
  rawVideos.forEach((entry, index) => {
    const item = record(entry);
    const videoId = stringValue(item.videoId);
    const order = finiteNumber(item.order);
    if (!videoId) issues.push({ level: "error", path: `videos[${index}].videoId`, message: "ID do vídeo ausente." });
    else if (!videoMap.has(videoId)) issues.push({ level: "error", path: `videos[${index}].videoId`, message: `O vídeo ${videoId} não existe na Base de dados local.` });
    if (!Number.isInteger(order) || order < 1) issues.push({ level: "error", path: `videos[${index}].order`, message: "A ordem do vídeo precisa ser um inteiro positivo." });
    if (videoId && seenVideos.has(videoId)) issues.push({ level: "error", path: `videos[${index}].videoId`, message: `O vídeo ${videoId} foi repetido.` });
    if (Number.isInteger(order) && order > 0 && seenOrders.has(order)) issues.push({ level: "error", path: `videos[${index}].order`, message: `A ordem ${order} foi repetida.` });
    if (videoId) seenVideos.add(videoId);
    if (Number.isInteger(order) && order > 0) seenOrders.add(order);
    const localVideo = videoId ? videoMap.get(videoId) : undefined;
    if (localVideo) {
      if (!Number.isFinite(localVideo.durationSeconds) || localVideo.durationSeconds <= 0) issues.push({ level: "error", path: `videos[${index}].videoId`, message: `O vídeo ${videoId} não possui duração calculada localmente.` });
      if (!isAbsolutePath(localVideo.absolutePath)) issues.push({ level: "error", path: `videos[${index}].videoId`, message: `O caminho local absoluto do vídeo ${videoId} não está disponível.` });
      if (localVideo.fileAvailable === false) issues.push({ level: "error", path: `videos[${index}].videoId`, message: `O arquivo local do vídeo ${videoId} não existe mais na Base de dados.` });
      if (!Number.isFinite(localVideo.sceneEndSeconds) || localVideo.sceneEndSeconds < 0) issues.push({ level: "error", path: `videos[${index}].videoId`, message: `O tempo final da cena do vídeo ${videoId} é inválido.` });
      else if (localVideo.sceneEndSeconds > localVideo.durationSeconds) issues.push({ level: "warning", path: `videos[${index}].videoId`, message: `O fim da descrição do vídeo ${videoId} ultrapassa sua duração total.` });
    }
    if (videoId && Number.isInteger(order) && order > 0 && localVideo) normalizedVideos.push({ videoId, order });
  });

  const seenCharacters = new Set<string>();
  const normalizedCharacters: ImportableCharacterChoice[] = [];
  rawCharacters.forEach((entry, index) => {
    const item = record(entry);
    const characterId = stringValue(item.characterId);
    if (!characterId) issues.push({ level: "error", path: `characters[${index}].characterId`, message: "ID do personagem ausente." });
    else if (!characterMap.has(characterId)) issues.push({ level: "error", path: `characters[${index}].characterId`, message: `O personagem ${characterId} não existe no Criador.` });
    if (characterId && seenCharacters.has(characterId)) issues.push({ level: "error", path: `characters[${index}].characterId`, message: `O personagem ${characterId} foi repetido.` });
    if (characterId) seenCharacters.add(characterId);
    if (characterId && characterMap.has(characterId)) normalizedCharacters.push({ characterId, ...(stringValue(item.role) ? { role: stringValue(item.role) } : {}) });
  });

  const allowedVideoIds = new Set(normalizedVideos.map((video) => video.videoId));
  const allowedCharacterIds = new Set(normalizedCharacters.map((character) => character.characterId));
  const normalizedBlocks: ImportableBlock[] = [];
  rawBlocks.forEach((entry, index) => {
    const item = record(entry);
    const type = item.type === "speech" || item.type === "thought" ? item.type : "";
    const characterId = stringValue(item.characterId);
    const videoId = stringValue(item.videoId);
    const text = stringValue(item.text);
    const startAt = item.startAt === undefined ? undefined : finiteNumber(item.startAt);
    if (!type) issues.push({ level: "error", path: `blocks[${index}].type`, message: "O bloco precisa ser speech ou thought." });
    if (!text) issues.push({ level: "error", path: `blocks[${index}].text`, message: "O bloco precisa conter texto." });
    if (!allowedCharacterIds.has(characterId)) issues.push({ level: "error", path: `blocks[${index}].characterId`, message: "O bloco usa um personagem que não foi selecionado." });
    if (!allowedVideoIds.has(videoId)) issues.push({ level: "error", path: `blocks[${index}].videoId`, message: "O bloco usa um vídeo que não foi selecionado." });
    if (startAt !== undefined && (!Number.isFinite(startAt) || startAt < 0)) issues.push({ level: "error", path: `blocks[${index}].startAt`, message: "startAt precisa ser um número igual ou maior que zero." });
    if (type && text && allowedCharacterIds.has(characterId) && allowedVideoIds.has(videoId) && (startAt === undefined || (Number.isFinite(startAt) && startAt >= 0))) normalizedBlocks.push({ type, characterId, videoId, text, ...(startAt === undefined ? {} : { startAt }) });
  });

  const selectedVideoMap = new Map(videos.filter((video) => allowedVideoIds.has(video.id)).map((video) => [video.id, video]));
  normalizedBlocks.forEach((block, index) => {
    const video = selectedVideoMap.get(block.videoId);
    if (video && block.startAt !== undefined && block.startAt < video.sceneEndSeconds) issues.push({ level: "warning", path: `blocks[${index}].startAt`, message: `O bloco começará no fim da descrição do vídeo (${video.sceneEndSeconds.toFixed(2)}s), porque o horário informado é anterior.` });
  });

  normalizedVideos.sort((left, right) => left.order - right.order);
  const data: ImportableScriptDocument = { format: IMPORTABLE_SCRIPT_FORMAT, title, videos: normalizedVideos, characters: normalizedCharacters, blocks: normalizedBlocks };
  return { success: !issues.some((issue) => issue.level === "error"), data, issues };
}

export type ImportedScriptDraft = { script: ScriptProject; sections: Array<{ section: TikTokSection; sourceVideo: BaseDadosVideo }> };

export function createScriptFromImport(document: ImportableScriptDocument, videos: BaseDadosVideo[], characters: PremiumCharacter[], state: RoteirosState): ImportedScriptDraft {
  const timestamp = nowIso();
  const videoMap = new Map(videos.map((video) => [video.id, video]));
  const characterIds = document.characters.map((character) => character.characterId);
  const blocksByVideo = new Map<string, Array<{ block: ImportableBlock; index: number }>>();
  document.blocks.forEach((block, index) => blocksByVideo.set(block.videoId, [...(blocksByVideo.get(block.videoId) ?? []), { block, index }]));
  const sections = document.videos.map((choice) => {
    const sourceVideo = videoMap.get(choice.videoId)!;
    const sectionId = createId();
    const reactionBlocks: ReactionBlock[] = (blocksByVideo.get(choice.videoId) ?? []).sort((left, right) => {
      const leftTime = left.block.startAt ?? sourceVideo.sceneEndSeconds;
      const rightTime = right.block.startAt ?? sourceVideo.sceneEndSeconds;
      return leftTime - rightTime || left.index - right.index;
    }).map(({ block }) => {
      const startAt = Math.max(sourceVideo.sceneEndSeconds, block.startAt ?? sourceVideo.sceneEndSeconds);
      return { id: createId(), characterId: block.characterId, type: block.type, emotion: "", text: block.text, englishText: "", startAt, createdAt: timestamp, updatedAt: timestamp };
    });
    const section: TikTokSection = {
      id: sectionId,
      title: `Vídeo ${String(choice.order).padStart(2, "0")}`,
      description: sourceVideo.description,
      timeline: "unspecified",
      sceneGoal: "",
      sceneEndSeconds: sourceVideo.sceneEndSeconds,
      userInstruction: "",
      specificRules: "",
      shortLines: false,
      reactionBlocks,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return { section, sourceVideo };
  });
  const script: ScriptProject = {
    id: createId(),
    title: document.title,
    generalContext: "",
    participants: characterIds.map((characterId) => ({ characterId, active: true })),
    aiOrderingMode: "none",
    aiContext: createScriptAiContext(characterIds, state.profiles, state.globalRules),
    tiktoks: sections.map(({ section }) => section),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  void characters;
  return { script, sections };
}
