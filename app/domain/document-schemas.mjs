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
  const finiteOr = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  const positiveOr = (candidate, fallback) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  return {
    ...source,
    x: finiteOr(source.x, DEFAULT_TRANSFORM.x),
    y: finiteOr(source.y, DEFAULT_TRANSFORM.y),
    scale: positiveOr(source.scale, DEFAULT_TRANSFORM.scale),
    scaleX: positiveOr(source.scaleX, DEFAULT_TRANSFORM.scaleX),
    scaleY: positiveOr(source.scaleY, DEFAULT_TRANSFORM.scaleY),
    rotation: finiteOr(source.rotation, DEFAULT_TRANSFORM.rotation),
    flipX: source.flipX === true,
  };
}

function normalizeAdjustments(value) {
  const source = record(value);
  return Object.fromEntries(CATEGORIES.map((category) => [category, normalizeTransform(source[category])]));
}

export function normalizeCharacterDocument(value) {
  const source = record(value);
  const aliases = list(source.aliases).filter((alias) => typeof alias === "string" && alias.trim()).map((alias) => alias.trim());
  const importedFrom = record(source.importedFrom);
  const hasImportedFrom = typeof importedFrom.importId === "string" && typeof importedFrom.scriptId === "string";
  return {
    ...source,
    basePackId: normalizeBasePackId(source.basePackId),
    templateScaleX: source.templateScaleX !== undefined && source.templateScaleX !== null && Number.isFinite(Number(source.templateScaleX))
      ? Math.min(1.2, Math.max(.5, Number(source.templateScaleX)))
      : 1,
    selections: normalizeSelections(source.selections),
    adjustments: normalizeAdjustments(source.adjustments),
    ...(aliases.length ? { aliases } : {}),
    ...(hasImportedFrom ? { importedFrom: { importId: importedFrom.importId, scriptId: importedFrom.scriptId, importedAt: typeof importedFrom.importedAt === "string" ? importedFrom.importedAt : "", ...(typeof importedFrom.sourceTitle === "string" ? { sourceTitle: importedFrom.sourceTitle } : {}) } } : {}),
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
  const uiPreferences = record(source.uiPreferences);
  const backgroundSource = record(source.background);
  const hasBackground = source.background && typeof source.background === "object" && !Array.isArray(source.background);
  const background = hasBackground ? {
    ...backgroundSource,
    assetId: typeof backgroundSource.assetId === "string" ? backgroundSource.assetId : "",
    src: typeof backgroundSource.src === "string" ? backgroundSource.src : "",
    fit: backgroundSource.fit === "contain" ? "contain" : "cover",
    offsetX: Number.isFinite(Number(backgroundSource.offsetX)) ? Math.max(-10000, Math.min(10000, Number(backgroundSource.offsetX))) : 0,
    offsetY: Number.isFinite(Number(backgroundSource.offsetY)) ? Math.max(-10000, Math.min(10000, Number(backgroundSource.offsetY))) : 0,
    scale: Number.isFinite(Number(backgroundSource.scale)) ? Math.max(.1, Math.min(8, Number(backgroundSource.scale))) : 1,
  } : null;
  const characters = list(source.characters).map((character) => {
    const item = record(character);
    const { outfitGroupId: rawGroupId, outfitVariantIndex: rawVariantIndex, outfitVariantOffsets: rawOffsets, ...rest } = item;
    const outfitVariantOffsets = Object.fromEntries(
      Object.entries(record(rawOffsets)).flatMap(([id, value]) => {
        const offset = record(value);
        const x = Number(offset.x);
        const y = Number(offset.y);
        return id && Number.isFinite(x) && Number.isFinite(y)
          ? [[id, { x: Math.max(-1000, Math.min(1000, x)), y: Math.max(-1000, Math.min(1000, y)) }]]
          : [];
      }),
    );
    return {
      ...rest,
      ...(typeof rawGroupId === "string" && rawGroupId ? { outfitGroupId: rawGroupId } : {}),
      ...(Number.isInteger(rawVariantIndex) && rawVariantIndex >= 0 ? { outfitVariantIndex: rawVariantIndex } : {}),
      ...(Object.keys(outfitVariantOffsets).length ? { outfitVariantOffsets } : {}),
    };
  });
  return {
    ...source,
    background,
    rosterIds: list(source.rosterIds),
    characters,
    objects: list(source.objects),
    bubbles: list(source.bubbles),
    narrators: list(source.narrators),
    ...(source.uiPreferences !== undefined ? { uiPreferences: {
      characterPositionsLocked: uiPreferences.characterPositionsLocked === true,
      backgroundCollapsed: uiPreferences.backgroundCollapsed === true,
      rosterCompact: uiPreferences.rosterCompact === true,
      inspectorDockSide: uiPreferences.inspectorDockSide === "left" ? "left" : "right",
      characterInspectorExpanded: uiPreferences.characterInspectorExpanded !== false,
    } } : {}),
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
    studioAssets: list(source.studioAssets).map((asset) => {
      const item = record(asset);
      return { ...item, ...(item.kind === "background" || item.kind === "object" ? { kind: item.kind } : {}) };
    }),
  };
}

export function emptyRoteirosState() {
  return { version: ROTEIROS_STATE_VERSION, profiles: [], scripts: [], globalRules: [], settings: createDefaultRoteirosSettings() };
}

function normalizeRoteirosSettings(value) {
  const source = record(value);
  const defaults = createDefaultRoteirosSettings();
  const numeric = (name, min, max) => Number.isFinite(Number(source[name])) ? Math.max(min, Math.min(max, Number(source[name]))) : defaults[name];
  return {
    ...defaults,
    ...source,
    aiProvider: ["none", "lmstudio", "ollama", "openai"].includes(source.aiProvider) ? source.aiProvider : defaults.aiProvider,
    aiBaseUrl: typeof source.aiBaseUrl === "string" ? source.aiBaseUrl : defaults.aiBaseUrl,
    aiModel: typeof source.aiModel === "string" ? source.aiModel : defaults.aiModel,
    temperature: numeric("temperature", 0, 1.5),
    openAiModel: (() => {
      const model = typeof source.openAiModel === "string" && source.openAiModel.trim() ? source.openAiModel.trim() : defaults.openAiModel;
      return model === "gpt-5.4-mini" ? defaults.openAiModel : model;
    })(),
    openAiReasoningEffort: ["low", "medium", "high"].includes(source.openAiReasoningEffort) ? source.openAiReasoningEffort : defaults.openAiReasoningEffort,
    openAiMaxOutputTokens: numeric("openAiMaxOutputTokens", 256, 8000),
    openAiTimeoutMs: numeric("openAiTimeoutMs", 5_000, 180_000),
    generationMode: source.generationMode === "creative" ? "creative" : defaults.generationMode,
    fillEmptyPrompt: typeof source.fillEmptyPrompt === "string" ? source.fillEmptyPrompt.slice(0, 12_000) : defaults.fillEmptyPrompt,
    defaultBlockCount: Math.round(numeric("defaultBlockCount", 1, 24)),
    historyLimit: Math.round(numeric("historyLimit", 0, 10)),
    shortLinesByDefault: source.shortLinesByDefault === true,
  };
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

function normalizeGlobalRule(value) {
  const source = record(value);
  return {
    ...source,
    id: typeof source.id === "string" ? source.id : "",
    title: typeof source.title === "string" ? source.title : "Nova regra",
    description: typeof source.description === "string" ? source.description : "",
    enabled: source.enabled !== false,
    priority: ["low", "normal", "high"].includes(source.priority) ? source.priority : "normal",
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

function normalizeReactionBlock(value) {
  const source = record(value);
  const legacySilent = source.type === "silent";
  const type = legacySilent ? "thought" : (["auto", "speech", "thought"].includes(source.type) ? source.type : "auto");
  const sourceEmotion = typeof source.emotion === "string" ? source.emotion : "";
  const sourceText = typeof source.text === "string" ? source.text : "";
  return {
    ...source,
    id: typeof source.id === "string" ? source.id : "",
    characterId: typeof source.characterId === "string" ? source.characterId : "",
    type,
    emotion: legacySilent && !sourceText.trim() ? "" : sourceEmotion,
    text: legacySilent && !sourceText.trim() ? sourceEmotion : sourceText,
    englishText: typeof source.englishText === "string" ? source.englishText : "",
    ...(Number.isFinite(Number(source.startAt)) && Number(source.startAt) >= 0 ? { startAt: Number(source.startAt) } : {}),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

function normalizeAiUsage(value) {
  const source = record(value);
  return {
    calls: Number.isFinite(Number(source.calls)) ? Math.max(0, Math.round(Number(source.calls))) : 0,
    inputTokens: Number.isFinite(Number(source.inputTokens)) ? Math.max(0, Math.round(Number(source.inputTokens))) : 0,
    outputTokens: Number.isFinite(Number(source.outputTokens)) ? Math.max(0, Math.round(Number(source.outputTokens))) : 0,
    totalTokens: Number.isFinite(Number(source.totalTokens)) ? Math.max(0, Math.round(Number(source.totalTokens))) : 0,
    lastAt: typeof source.lastAt === "string" ? source.lastAt : null,
    lastOperation: typeof source.lastOperation === "string" ? source.lastOperation : null,
    lastModel: typeof source.lastModel === "string" ? source.lastModel : null,
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

function normalizeBackgroundReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = record(value);
  return {
    ...source,
    name: typeof source.name === "string" ? source.name : "fundo.png",
    storedPath: typeof source.storedPath === "string" ? source.storedPath : "",
    ...(typeof source.url === "string" ? { url: source.url } : {}),
    contentType: typeof source.contentType === "string" ? source.contentType : "image/png",
    size: Number.isFinite(Number(source.size)) ? Math.max(0, Number(source.size)) : 0,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    ...(typeof source.exportedPath === "string" ? { exportedPath: source.exportedPath } : {}),
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
    aiDirectives: Array.isArray(source.aiDirectives) ? [...new Set(source.aiDirectives.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 20) : [],
    specificRules: typeof source.specificRules === "string" ? source.specificRules : "",
    shortLines: Boolean(source.shortLines),
    ...(typeof source.orderLocked === "boolean" ? { orderLocked: source.orderLocked } : {}),
    ...(Number.isFinite(Number(source.sceneEndSeconds)) && Number(source.sceneEndSeconds) >= 0 ? { sceneEndSeconds: Number(source.sceneEndSeconds) } : {}),
    ...(Number.isFinite(Number(source.firstGroupReactionSeconds)) && Number(source.firstGroupReactionSeconds) >= 0 ? { firstGroupReactionSeconds: Number(source.firstGroupReactionSeconds) } : {}),
    ...(Number.isFinite(Number(source.secondGroupReactionSeconds)) && Number(source.secondGroupReactionSeconds) >= 0 ? { secondGroupReactionSeconds: Number(source.secondGroupReactionSeconds) } : {}),
    ...(video ? { video } : {}),
    reactionBlocks: list(source.reactionBlocks).map(normalizeReactionBlock),
    ...(source.aiUsage && typeof source.aiUsage === "object" ? { aiUsage: normalizeAiUsage(source.aiUsage) } : {}),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

function normalizeRoteiroOpening(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const normalized = normalizeRoteiroSection(value);
  const opening = { ...normalized };
  delete opening.video;
  return opening;
}

function normalizeRoteiroAiContext(value, fallback, participantIds) {
  const source = record(value);
  const participantIdSet = new Set(participantIds);
  const hasProfiles = Array.isArray(source.profiles);
  const hasRules = Array.isArray(source.rules);
  const fallbackProfiles = fallback.profiles.filter((profile) => participantIdSet.has(profile.characterId));
  return {
    profiles: (hasProfiles ? list(source.profiles) : fallbackProfiles).map(normalizeRoteiroProfile),
    rules: (hasRules ? list(source.rules) : fallback.rules).map(normalizeGlobalRule),
  };
}

function normalizeRoteiroScript(value, fallbackAiContext = { profiles: [], rules: [] }) {
  const source = record(value);
  const sourceWithoutLegacyExportTarget = { ...source };
  delete sourceWithoutLegacyExportTarget.exportTarget;
  const participants = list(source.participants).map((participant) => {
    const item = record(participant);
    return { ...item, characterId: typeof item.characterId === "string" ? item.characterId : "", active: item.active !== false };
  });
  return {
    ...sourceWithoutLegacyExportTarget,
    id: typeof source.id === "string" ? source.id : "",
    title: typeof source.title === "string" ? source.title : "Roteiro sem título",
    generalContext: typeof source.generalContext === "string" ? source.generalContext : "",
    participants,
    ...(["none", "suggest", "apply"].includes(source.aiOrderingMode) ? { aiOrderingMode: source.aiOrderingMode } : {}),
    aiContext: normalizeRoteiroAiContext(source.aiContext, fallbackAiContext, participants.map((participant) => participant.characterId)),
    ...(source.aiUsage && typeof source.aiUsage === "object" ? { aiUsage: normalizeAiUsage(source.aiUsage) } : {}),
    ...(source.opening ? { opening: normalizeRoteiroOpening(source.opening) } : {}),
    ...(source.background && normalizeBackgroundReference(source.background) ? { background: normalizeBackgroundReference(source.background) } : {}),
    ...(record(source.importOrigin).kind === "ai-json" && typeof source.importOrigin.importId === "string" ? { importOrigin: { kind: "ai-json", importId: source.importOrigin.importId, importedAt: typeof source.importOrigin.importedAt === "string" ? source.importOrigin.importedAt : "", createdCharacterIds: list(source.importOrigin.createdCharacterIds).filter((id) => typeof id === "string"), ...(typeof source.importOrigin.sourceTitle === "string" ? { sourceTitle: source.importOrigin.sourceTitle } : {}) } } : {}),
    tiktoks: list(source.tiktoks).map(normalizeRoteiroSection),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

export function normalizeRoteirosState(value) {
  const source = record(value);
  const profiles = list(source.profiles).map(normalizeRoteiroProfile);
  const globalRules = list(source.globalRules).map(normalizeGlobalRule);
  const fallbackAiContext = { profiles, rules: globalRules };
  return {
    ...source,
    version: ROTEIROS_STATE_VERSION,
    profiles,
    scripts: list(source.scripts).map((script) => normalizeRoteiroScript(script, fallbackAiContext)),
    globalRules,
    settings: normalizeRoteirosSettings(source.settings),
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
    if (item.aiContext !== undefined) {
      const context = record(item.aiContext);
      if (!Array.isArray(context.profiles)) issues.push(`scripts[${index}].aiContext.profiles deve ser uma lista`);
      if (!Array.isArray(context.rules)) issues.push(`scripts[${index}].aiContext.rules deve ser uma lista`);
    }
    list(item.participants).forEach((participant, participantIndex) => { if (typeof record(participant).characterId !== "string") issues.push(`scripts[${index}].participants[${participantIndex}].characterId inválido`); });
    if (item.opening !== undefined) {
      validateIdentity(record(item.opening), `scripts[${index}].opening`, issues);
      list(record(item.opening).reactionBlocks).forEach((block, blockIndex) => validateIdentity(record(block), `scripts[${index}].opening.reactionBlocks[${blockIndex}]`, issues));
    }
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
