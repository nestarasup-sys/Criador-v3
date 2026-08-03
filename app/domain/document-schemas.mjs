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

export function normalizeRoteirosState(value) {
  const source = record(value);
  return {
    ...source,
    version: ROTEIROS_STATE_VERSION,
    profiles: list(source.profiles).map((profile) => ({ ...record(profile), relationships: list(record(profile).relationships) })),
    scripts: list(source.scripts).map((script) => {
      const item = record(script);
      return {
        ...item,
        participants: list(item.participants),
        tiktoks: list(item.tiktoks).map((section) => ({
          ...record(section),
          reactionBlocks: list(record(section).reactionBlocks),
        })),
      };
    }),
    globalRules: list(source.globalRules),
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
  list(source.scripts).forEach((script, index) => validateIdentity(record(script), `scripts[${index}]`, issues));
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
