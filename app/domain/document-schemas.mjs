import { normalizeBasePackId } from "./base-model.mjs";
import { APP_STATE_VERSION, ROTEIROS_STATE_VERSION } from "./versions.mjs";
import { CATEGORIES, isModel } from "./character-values.mjs";
import { createDefaultRoteirosSettings } from "./roteiro-defaults.mjs";

const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false };

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSelections(value) {
  const source = record(value);
  return Object.fromEntries(CATEGORIES.map((category) => [category, typeof source[category] === "string" ? source[category] : null]));
}

function normalizeTransform(value) {
  const source = record(value);
  return { ...DEFAULT_TRANSFORM, ...source };
}

function normalizeAdjustments(value) {
  const source = record(value);
  return Object.fromEntries(CATEGORIES.map((category) => [category, normalizeTransform(source[category])]));
}

export function normalizeCharacterDocument(value) {
  const source = record(value);
  return {
    ...source,
    basePackId: normalizeBasePackId(source.basePackId),
    selections: normalizeSelections(source.selections),
    adjustments: normalizeAdjustments(source.adjustments),
  };
}

function normalizeCatalogItem(value) {
  const source = record(value);
  return {
    ...source,
    ...(source.basePackId !== undefined ? { basePackId: normalizeBasePackId(source.basePackId) } : {}),
    ...(source.outfitPoseId !== undefined ? { outfitPoseId: normalizeBasePackId(source.outfitPoseId) } : {}),
  };
}

function normalizeExpressionPack(value) {
  const source = record(value);
  return {
    ...source,
    basePackId: normalizeBasePackId(source.basePackId),
    frames: list(source.frames).map((frame) => ({ ...record(frame) })),
  };
}

function normalizeStudio(value) {
  const source = record(value);
  return {
    ...source,
    rosterIds: list(source.rosterIds),
    characters: list(source.characters),
    objects: list(source.objects),
    bubbles: list(source.bubbles),
    narrators: list(source.narrators),
  };
}

export function emptyAppState() {
  return { version: APP_STATE_VERSION, characters: [], catalog: [], expressionPacks: [], studios: [], studioAssets: [] };
}

export function normalizeAppState(value) {
  const source = record(value);
  return {
    ...source,
    version: APP_STATE_VERSION,
    characters: list(source.characters).map(normalizeCharacterDocument),
    catalog: list(source.catalog).map(normalizeCatalogItem),
    expressionPacks: list(source.expressionPacks).map(normalizeExpressionPack),
    studios: list(source.studios).map(normalizeStudio),
    studioAssets: list(source.studioAssets).map((asset) => ({ ...record(asset) })),
  };
}

export function emptyRoteirosState() {
  return { version: ROTEIROS_STATE_VERSION, profiles: [], scripts: [], globalRules: [], settings: createDefaultRoteirosSettings() };
}

function normalizeRoteiroProfile(value) {
  const source = record(value);
  return {
    ...source,
    characterId: typeof source.characterId === "string" ? source.characterId : "",
    personality: typeof source.personality === "string" ? source.personality : "",
    backstory: typeof source.backstory === "string" ? source.backstory : "",
    fynRelationship: typeof source.fynRelationship === "string" ? source.fynRelationship : "",
    speakingStyle: typeof source.speakingStyle === "string" ? source.speakingStyle : "",
    additionalRules: typeof source.additionalRules === "string" ? source.additionalRules : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    relationships: list(source.relationships).map((relationship) => {
      const item = record(relationship);
      return { ...item, id: typeof item.id === "string" ? item.id : "", targetCharacterId: typeof item.targetCharacterId === "string" ? item.targetCharacterId : "", description: typeof item.description === "string" ? item.description : "" };
    }),
  };
}

function normalizeReactionBlock(value) {
  const source = record(value);
  const type = ["speech", "thought", "silent"].includes(source.type) ? source.type : "speech";
  return {
    ...source,
    id: typeof source.id === "string" ? source.id : "",
    characterId: typeof source.characterId === "string" ? source.characterId : "",
    type,
    emotion: typeof source.emotion === "string" ? source.emotion : "",
    text: typeof source.text === "string" ? source.text : "",
    englishText: typeof source.englishText === "string" ? source.englishText : "",
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

function normalizeVideoReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = record(value);
  return {
    ...source,
    name: typeof source.name === "string" ? source.name : "video.mp4",
    storedPath: typeof source.storedPath === "string" ? source.storedPath : "",
    ...(typeof source.url === "string" ? { url: source.url } : {}),
    contentType: typeof source.contentType === "string" ? source.contentType : "video/mp4",
    size: Number.isFinite(Number(source.size)) ? Math.max(0, Number(source.size)) : 0,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    ...(Number.isFinite(Number(source.durationSeconds)) && Number(source.durationSeconds) >= 0 ? { durationSeconds: Number(source.durationSeconds) } : {}),
  };
}

function normalizeRoteiroSection(value) {
  const source = record(value);
  const timeline = ["unspecified", "past", "present", "future"].includes(source.timeline) ? source.timeline : "unspecified";
  const video = normalizeVideoReference(source.video);
  return {
    ...source,
    id: typeof source.id === "string" ? source.id : "",
    title: typeof source.title === "string" ? source.title : "",
    description: typeof source.description === "string" ? source.description : "",
    timeline,
    sceneGoal: typeof source.sceneGoal === "string" ? source.sceneGoal : "",
    userInstruction: typeof source.userInstruction === "string" ? source.userInstruction : "",
    specificRules: typeof source.specificRules === "string" ? source.specificRules : "",
    shortLines: Boolean(source.shortLines),
    ...(Number.isFinite(Number(source.sceneEndSeconds)) && Number(source.sceneEndSeconds) >= 0 ? { sceneEndSeconds: Number(source.sceneEndSeconds) } : {}),
    ...(video ? { video } : {}),
    reactionBlocks: list(source.reactionBlocks).map(normalizeReactionBlock),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

function normalizeRoteiroScript(value) {
  const source = record(value);
  return {
    ...source,
    id: typeof source.id === "string" ? source.id : "",
    title: typeof source.title === "string" ? source.title : "Roteiro sem título",
    generalContext: typeof source.generalContext === "string" ? source.generalContext : "",
    participants: list(source.participants).map((participant) => {
      const item = record(participant);
      return { ...item, characterId: typeof item.characterId === "string" ? item.characterId : "", active: item.active !== false };
    }),
    tiktoks: list(source.tiktoks).map(normalizeRoteiroSection),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

export function normalizeRoteirosState(value) {
  const source = record(value);
  return {
    ...source,
    version: ROTEIROS_STATE_VERSION,
    profiles: list(source.profiles).map(normalizeRoteiroProfile),
    scripts: list(source.scripts).map(normalizeRoteiroScript),
    globalRules: list(source.globalRules).map((rule) => ({ ...record(rule), id: typeof record(rule).id === "string" ? record(rule).id : "", title: typeof record(rule).title === "string" ? record(rule).title : "Nova regra", description: typeof record(rule).description === "string" ? record(rule).description : "", enabled: record(rule).enabled !== false, priority: ["low", "normal", "high"].includes(record(rule).priority) ? record(rule).priority : "normal" })),
    settings: { ...createDefaultRoteirosSettings(), ...record(source.settings) },
  };
}

function validateIdentity(item, path, issues) {
  if (typeof item.id !== "string" || !item.id) issues.push(`${path}.id deve ser uma string não vazia`);
}

export function validateAppState(value) {
  const source = record(value);
  const issues = [];
  if (source.version !== undefined && source.version !== APP_STATE_VERSION) issues.push(`version deve ser ${APP_STATE_VERSION}`);
  for (const key of ["characters", "catalog", "expressionPacks", "studios", "studioAssets"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) issues.push(`${key} deve ser uma lista`);
  }
  list(source.characters).forEach((character, index) => {
    const item = record(character);
    validateIdentity(item, `characters[${index}]`, issues);
    if (!isModel(item.model)) issues.push(`characters[${index}].model inválido`);
  });
  list(source.catalog).forEach((item, index) => validateIdentity(record(item), `catalog[${index}]`, issues));
  list(source.studios).forEach((item, index) => validateIdentity(record(item), `studios[${index}]`, issues));
  return issues;
}

export function validateRoteirosState(value) {
  const source = record(value);
  const issues = [];
  if (source.version !== undefined && source.version !== ROTEIROS_STATE_VERSION) issues.push(`version deve ser ${ROTEIROS_STATE_VERSION}`);
  for (const key of ["profiles", "scripts", "globalRules"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) issues.push(`${key} deve ser uma lista`);
  }
  list(source.scripts).forEach((script, index) => {
    const item = record(script);
    validateIdentity(item, `scripts[${index}]`, issues);
    list(item.participants).forEach((participant, participantIndex) => { if (typeof record(participant).characterId !== "string") issues.push(`scripts[${index}].participants[${participantIndex}].characterId inválido`); });
    list(item.tiktoks).forEach((section, sectionIndex) => {
      validateIdentity(record(section), `scripts[${index}].tiktoks[${sectionIndex}]`, issues);
      list(record(section).reactionBlocks).forEach((block, blockIndex) => validateIdentity(record(block), `scripts[${index}].tiktoks[${sectionIndex}].reactionBlocks[${blockIndex}]`, issues));
    });
  });
  return issues;
}

export function validateRoteiroExportDocument(value) {
  const source = record(value);
  const issues = [];
  if (source.app !== "GACHA_PREMIUM_ROTEIROS_V1") issues.push("app inválido");
  if (source.version !== 1) issues.push("version deve ser 1");
  if (!source.script || typeof source.script !== "object" || Array.isArray(source.script)) issues.push("script deve ser um objeto");
  else issues.push(...validateRoteirosState({ version: 1, profiles: [], scripts: [source.script], globalRules: [], settings: {} }).filter((issue) => issue.startsWith("scripts[0]")));
  return issues;
}

export function parseAppState(value) {
  const issues = validateAppState(value);
  return { success: issues.length === 0, data: normalizeAppState(value), issues };
}

export function parseRoteirosState(value) {
  const issues = validateRoteirosState(value);
  return { success: issues.length === 0, data: normalizeRoteirosState(value), issues };
}
