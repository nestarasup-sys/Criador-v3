import { createReactionBlock, nowIso, PROTECTED_RULES } from "./defaults";
import type { GlobalRule, NarrativeProfile, OpeningSection, PremiumCharacter, ReactionBlock, ReactionBlockType, ScriptProject, TikTokSection, TikTokVideoReference } from "./types";

export const AI_CONTEXT_EXPORT_APP = "GACHA_PREMIUM_ROTEIROS_AI_CONTEXT_V1" as const;
export const AI_CONTEXT_RESULT_APP = "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1" as const;
export const AI_CONTEXT_SCHEMA_VERSION = 1 as const;
export const AI_CONTEXT_MIN_BLOCK_SECONDS = 3.2;

export type AiContextDuration = {
  totalVideoDurationSeconds: number | null;
  knownVideoCount: number;
  totalVideoCount: number;
  durationKnown: boolean;
};

export type AiContextInstructions = {
  purpose: string;
  language: "pt-BR";
  startAfterOpening: true;
  reactionsStartRule: string;
  minimumBlockSeconds: number;
  durationPolicy: string;
  blockCountPolicy: string;
  protectedRules: string[];
  outputPolicy: string[];
};

export type AiContextCharacter = {
  characterId: string;
  name: string;
  gender: "male" | "female" | "unspecified";
  profile: NarrativeProfile;
};

export type AiContextEmptySlot = {
  blockId: string;
  characterId: string;
  type: ReactionBlockType;
};

export type AiContextSection = {
  sectionId: string;
  order: number;
  kind: "opening" | "tiktok";
  title: string;
  description: string;
  sceneEndSeconds?: number;
  sceneGoal: string;
  timeline: TikTokSection["timeline"];
  specificRules: string;
  userInstruction: string;
  shortLines: boolean;
  video?: TikTokVideoReference;
  existingBlocks: ReactionBlock[];
  emptySlots: AiContextEmptySlot[];
};

export type AiContextExportDocument = {
  app: typeof AI_CONTEXT_EXPORT_APP;
  schemaVersion: typeof AI_CONTEXT_SCHEMA_VERSION;
  scriptId: string;
  scriptTitle: string;
  exportedAt: string;
  instructions: AiContextInstructions;
  project: {
    generalContext: string;
    duration: AiContextDuration;
    orderedSectionIds: string[];
  };
  characters: AiContextCharacter[];
  rules: GlobalRule[];
  opening: AiContextSection | null;
  tiktoks: AiContextSection[];
  responseContract: {
    app: typeof AI_CONTEXT_RESULT_APP;
    preserveScriptId: true;
    preserveSectionIds: true;
    blockFields: ["blockId", "characterId", "type", "emotion", "text", "englishText"];
  };
};

export type AiContextResultBlock = {
  blockId?: string | null;
  characterId: string;
  type: Exclude<ReactionBlockType, "auto">;
  emotion: string;
  text: string;
  englishText?: string;
};

export type AiContextResultSection = {
  sectionId: string;
  blocks: AiContextResultBlock[];
};

export type AiContextResultDocument = {
  app: typeof AI_CONTEXT_RESULT_APP;
  schemaVersion: typeof AI_CONTEXT_SCHEMA_VERSION;
  sourceScriptId: string;
  tiktoks?: AiContextResultSection[];
  opening?: AiContextResultSection | null;
};

export type AiContextValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: AiContextResultDocument;
};

export type AiContextImportReport = {
  sectionsProcessed: number;
  blocksImported: number;
  blocksCreated: number;
  manualBlocksSkipped: number;
  ignoredBlocks: number;
  errors: string[];
};

const instructions: AiContextInstructions = {
  purpose: "Gerar falas e pensamentos para vários TikToks mantendo continuidade narrativa.",
  language: "pt-BR",
  startAfterOpening: true,
  reactionsStartRule: "Em cada TikTok, as reações começam aproximadamente quando a descrição da cena termina.",
  minimumBlockSeconds: AI_CONTEXT_MIN_BLOCK_SECONDS,
  durationPolicy: "Use 3,2 segundos como referência mínima por fala ou pensamento. Reações podem ultrapassar a duração do vídeo e a duração total prevista; nunca corte blocos por causa disso.",
  blockCountPolicy: "Escolha livremente a quantidade de blocos adequada para cada cena. Não precisa repetir a quantidade de espaços vazios exportados.",
  protectedRules: [...PROTECTED_RULES],
  outputPolicy: [
    "Execute esta tarefa imediatamente ao abrir o arquivo; não pergunte ao usuário o que deve ser feito.",
    "Gere e disponibilize para download um arquivo chamado RESPOSTA_<scriptId>.json com o resultado.",
    "Retorne somente JSON válido no contrato indicado.",
    "Preserve scriptId, sectionId e characterId.",
    "Retorne os blocos na ordem em que devem acontecer.",
    "Use somente speech ou thought; ambos devem conter texto.",
    "Não altere vídeos, descrições, regras, fichas ou a ordem dos TikToks.",
    "Use as fichas e regras somente como contexto, sem repetir a ficha artificialmente.",
  ],
};

function blockIsEmpty(block: ReactionBlock) {
  return !block.text.trim();
}

function sectionToContext(section: TikTokSection | OpeningSection, kind: "opening" | "tiktok", order: number): AiContextSection {
  const existingBlocks = structuredClone(section.reactionBlocks);
  return {
    sectionId: section.id,
    order,
    kind,
    title: section.title,
    description: section.description,
    ...(section.sceneEndSeconds === undefined ? {} : { sceneEndSeconds: section.sceneEndSeconds }),
    sceneGoal: section.sceneGoal,
    timeline: section.timeline,
    specificRules: section.specificRules,
    userInstruction: section.userInstruction,
    shortLines: section.shortLines,
    ...('video' in section && section.video ? { video: structuredClone(section.video) } : {}),
    existingBlocks,
    emptySlots: existingBlocks.filter(blockIsEmpty).map((block) => ({ blockId: block.id, characterId: block.characterId, type: block.type })),
  };
}

function totalDuration(tiktoks: TikTokSection[]): AiContextDuration {
  const durations = tiktoks.map((section) => section.video?.durationSeconds).filter((value): value is number => Number.isFinite(value) && value !== undefined && value >= 0);
  const totalVideoCount = tiktoks.filter((section) => Boolean(section.video)).length;
  return {
    totalVideoDurationSeconds: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null,
    knownVideoCount: durations.length,
    totalVideoCount,
    durationKnown: totalVideoCount === durations.length,
  };
}

export function createAiContextExport(script: ScriptProject, characters: PremiumCharacter[], profiles: NarrativeProfile[], rules: GlobalRule[], exportedAt = new Date().toISOString()): AiContextExportDocument {
  const participantIds = new Set(script.participants.map((participant) => participant.characterId));
  const localProfiles = script.aiContext?.profiles ?? profiles;
  const localRules = script.aiContext?.rules ?? rules;
  const profileByCharacter = new Map(localProfiles.map((profile) => [profile.characterId, profile]));
  const contextCharacters = script.participants.map((participant) => {
    const character = characters.find((item) => item.id === participant.characterId);
    return {
      characterId: participant.characterId,
      name: character?.name || "Personagem removido",
      gender: character?.model === "masculino" ? "male" : character?.model === "feminino" ? "female" : "unspecified",
      profile: structuredClone(profileByCharacter.get(participant.characterId) ?? {
        characterId: participant.characterId,
        personality: "",
        backstory: "",
        fynRelationship: "",
        speakingStyle: "",
        relationships: [],
        additionalRules: "",
        updatedAt: "",
      }),
    } as AiContextCharacter;
  });
  const opening = script.opening ? sectionToContext(script.opening, "opening", 0) : null;
  return {
    app: AI_CONTEXT_EXPORT_APP,
    schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
    scriptId: script.id,
    scriptTitle: script.title,
    exportedAt,
    instructions: structuredClone(instructions),
    project: {
      generalContext: script.generalContext,
      duration: totalDuration(script.tiktoks),
      orderedSectionIds: [...(opening ? [opening.sectionId] : []), ...script.tiktoks.map((section) => section.id)],
    },
    characters: contextCharacters.filter((character) => participantIds.has(character.characterId)),
    rules: structuredClone(localRules),
    opening,
    tiktoks: script.tiktoks.map((section, index) => sectionToContext(section, "tiktok", index + 1)),
    responseContract: {
      app: AI_CONTEXT_RESULT_APP,
      preserveScriptId: true,
      preserveSectionIds: true,
      blockFields: ["blockId", "characterId", "type", "emotion", "text", "englishText"],
    },
  };
}

export function renderAiContextText(context: AiContextExportDocument): string {
  const instructionsText = context.instructions.outputPolicy.map((item) => `- ${item}`).join("\n");
  const duration = context.project.duration.totalVideoDurationSeconds === null ? "não disponível" : `${context.project.duration.totalVideoDurationSeconds.toFixed(2)} segundos`;
  const responseExample = {
    app: AI_CONTEXT_RESULT_APP,
    schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
    sourceScriptId: context.scriptId,
    tiktoks: context.tiktoks.map((section) => ({ sectionId: section.sectionId, blocks: [] })),
    ...(context.opening ? { opening: { sectionId: context.opening.sectionId, blocks: [] } } : {}),
  };
  return [
    "# AÇÃO IMEDIATA — EXECUTE E GERE O JSON",
    "",
    "Você recebeu este arquivo para executar agora. Leia todo o contexto e gere falas, pensamentos e reações para as cenas do roteiro.",
    "Não pergunte o que deve ser feito, não peça confirmação e não responda apenas com um plano.",
    "Ao terminar, crie e disponibilize um arquivo baixável chamado `RESPOSTA_<scriptId>.json` contendo somente o JSON válido no formato obrigatório deste documento.",
    "Se a plataforma não puder anexar um arquivo, responda somente com o conteúdo JSON puro, sem Markdown ou explicações.",
    "",
    `# CONTEXTO COMPLETO DO ROTEIRO — ${context.scriptTitle}`,
    "",
    "## IDENTIFICAÇÃO",
    `- Script ID: ${context.scriptId}`,
    `- Exportado em: ${context.exportedAt}`,
    `- Idioma das falas e pensamentos: ${context.instructions.language}`,
    "",
    "## INSTRUÇÕES PARA A IA EXTERNA",
    context.instructions.purpose,
    "",
    `- A abertura acontece antes dos TikToks: ${context.instructions.startAfterOpening ? "sim" : "não"}.`,
    `- ${context.instructions.reactionsStartRule}`,
    `- Use no mínimo ${context.instructions.minimumBlockSeconds} segundos como referência para cada fala ou pensamento.`,
    `- ${context.instructions.durationPolicy}`,
    `- ${context.instructions.blockCountPolicy}`,
    instructionsText,
    "",
    "## REGRAS ESTRUTURAIS PROTEGIDAS",
    context.instructions.protectedRules.map((rule) => `- ${rule}`).join("\n"),
    "",
    "## REGRA IMPORTANTE SOBRE DURAÇÃO",
    "Este módulo só gera e organiza blocos. Ele não controla a animação nem o tempo real dos balões.",
    "As reações podem ultrapassar a duração do vídeo e a duração total prevista. Não corte blocos por causa disso.",
    `Duração total conhecida dos vídeos: ${duration}.`,
    "",
    "## CONTEXTO GERAL",
    context.project.generalContext || "Não informado.",
    "",
    "## PERSONAGENS E FICHAS LOCAIS",
    `Quantidade: ${context.characters.length}`,
    ...context.characters.flatMap((character) => [
      `### ${character.name} — characterId: ${character.characterId}`,
      `Gênero: ${character.gender}`,
      `Personalidade: ${character.profile.personality || "Não informado."}`,
      `História: ${character.profile.backstory || "Não informado."}`,
      `Relação com FYN: ${character.profile.fynRelationship || "Não informado."}`,
      `Estilo de fala: ${character.profile.speakingStyle || "Não informado."}`,
      `Regras particulares: ${character.profile.additionalRules || "Não informado."}`,
      `Relações: ${JSON.stringify(character.profile.relationships)}`,
      "",
    ]),
    "## REGRAS DO ROTEIRO",
    context.rules.length ? context.rules.map((rule) => `- [${rule.priority.toUpperCase()}] ${rule.title}: ${rule.description}`).join("\n") : "Nenhuma regra personalizada ativa.",
    "",
    context.opening ? "## ABERTURA\n" + JSON.stringify(context.opening, null, 2) : "## ABERTURA\nNão existe abertura neste roteiro.",
    "",
    "## TIKTOKS EM ORDEM",
    ...context.tiktoks.flatMap((section) => [
      `### TikTok ${section.order} — ${section.title || "Sem título"}`,
      `sectionId: ${section.sectionId}`,
      `Descrição: ${section.description || "Não informada."}`,
      `Duração do vídeo: ${section.video?.durationSeconds === undefined ? "não disponível" : `${section.video.durationSeconds} segundos`}`,
      `Cena da descrição termina no segundo: ${section.sceneEndSeconds === undefined ? "não definido" : section.sceneEndSeconds}`,
      `Objetivo: ${section.sceneGoal || "Não informado."}`,
      `Linha temporal: ${section.timeline}`,
      `Regras específicas: ${section.specificRules || "Nenhuma."}`,
      `Instrução adicional: ${section.userInstruction || "Nenhuma."}`,
      `Vídeo: ${section.video ? `${section.video.name} — ${section.video.storedPath}` : "Nenhum vídeo informado."}`,
      `Blocos existentes: ${JSON.stringify(section.existingBlocks)}`,
      `Espaços vazios: ${JSON.stringify(section.emptySlots)}`,
      "",
    ]),
    "## FORMATO OBRIGATÓRIO DA RESPOSTA",
    "Depois de analisar este documento, gere imediatamente um arquivo JSON baixável chamado `RESPOSTA_<scriptId>.json`.",
    "O arquivo deve conter somente JSON válido. Não retorne explicações, Markdown ou comentários fora do JSON.",
    "Use exatamente este formato:",
    JSON.stringify(responseExample, null, 2),
    "Cada bloco deve conter: blockId opcional ou null, characterId, type, emotion, text e englishText opcional.",
    "Preserve scriptId e sectionId. A quantidade de blocos é livre e pode ser maior que a quantidade de espaços vazios.",
    "",
    "## DADOS ESTRUTURADOS COMPLETOS",
    "O JSON abaixo contém a fonte completa caso algum campo precise ser conferido:",
    JSON.stringify(context, null, 2),
    "",
  ].join("\n");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function resultBlock(value: unknown, path: string, errors: string[]): AiContextResultBlock | null {
  const source = record(value);
  const characterId = stringValue(source.characterId);
  const type = source.type;
  const emotion = stringValue(source.emotion);
  const text = stringValue(source.text);
  if (!characterId) errors.push(`${path}.characterId é obrigatório`);
  const legacySilent = type === "silent";
  const normalizedType = legacySilent ? "thought" : type;
  const normalizedText = legacySilent && !text.trim() ? emotion : text;
  if (normalizedType !== "speech" && normalizedType !== "thought") errors.push(`${path}.type deve ser speech ou thought`);
  if (!normalizedText.trim()) errors.push(`${path}.text não pode ficar vazio para fala ou pensamento`);
  if (!emotion.trim()) errors.push(`${path}.emotion não pode ficar vazio`);
  if (errors.some((error) => error.startsWith(`${path}.`))) return null;
  return {
    ...(typeof source.blockId === "string" && source.blockId ? { blockId: source.blockId } : {}),
    characterId,
    type: normalizedType as Exclude<ReactionBlockType, "auto">,
    emotion,
    text: normalizedText,
    ...(typeof source.englishText === "string" ? { englishText: source.englishText } : {}),
  };
}

function resultSection(value: unknown, path: string, errors: string[]): AiContextResultSection | null {
  const source = record(value);
  const sectionId = stringValue(source.sectionId);
  if (!sectionId) errors.push(`${path}.sectionId é obrigatório`);
  if (!Array.isArray(source.blocks)) {
    errors.push(`${path}.blocks deve ser uma lista`);
    return null;
  }
  const blocks = source.blocks.map((block, index) => resultBlock(block, `${path}.blocks[${index}]`, errors)).filter((block): block is AiContextResultBlock => Boolean(block));
  return sectionId ? { sectionId, blocks } : null;
}

export function validateAiContextResult(value: unknown, script: ScriptProject): AiContextValidation {
  const source = record(value);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (source.app !== AI_CONTEXT_RESULT_APP) errors.push(`app deve ser ${AI_CONTEXT_RESULT_APP}`);
  if (source.schemaVersion !== AI_CONTEXT_SCHEMA_VERSION) errors.push(`schemaVersion deve ser ${AI_CONTEXT_SCHEMA_VERSION}`);
  if (source.sourceScriptId !== script.id) errors.push("O arquivo pertence a outro roteiro.");
  if (!Array.isArray(source.tiktoks)) errors.push("tiktoks deve ser uma lista");
  const tiktoks = Array.isArray(source.tiktoks) ? source.tiktoks.map((section, index) => resultSection(section, `tiktoks[${index}]`, errors)).filter((section): section is AiContextResultSection => Boolean(section)) : [];
  const opening = source.opening == null ? undefined : resultSection(source.opening, "opening", errors);
  const sectionIds = new Set([...(script.opening ? [script.opening.id] : []), ...script.tiktoks.map((section) => section.id)]);
  const characterIds = new Set(script.participants.map((participant) => participant.characterId));
  for (const section of [...tiktoks, ...(opening ? [opening] : [])]) {
    if (!sectionIds.has(section.sectionId)) errors.push(`A seção ${section.sectionId} não existe neste roteiro.`);
    for (const block of section.blocks) if (!characterIds.has(block.characterId)) errors.push(`O personagem ${block.characterId} não pertence ao elenco deste roteiro.`);
  }
  if (!tiktoks.length && !opening?.blocks.length) warnings.push("O arquivo não contém blocos para importar.");
  if (errors.length) return { valid: false, errors, warnings };
  return { valid: true, errors, warnings, data: { app: AI_CONTEXT_RESULT_APP, schemaVersion: AI_CONTEXT_SCHEMA_VERSION, sourceScriptId: script.id, tiktoks, ...(opening ? { opening } : {}) } };
}

function targetSection(script: ScriptProject, sectionId: string): { section: TikTokSection | OpeningSection; opening: boolean } | null {
  if (script.opening?.id === sectionId) return { section: script.opening, opening: true };
  const section = script.tiktoks.find((item) => item.id === sectionId);
  return section ? { section, opening: false } : null;
}

function patchBlock(block: ReactionBlock, generated: AiContextResultBlock): ReactionBlock {
  return {
    ...block,
    characterId: generated.characterId,
    type: generated.type,
    emotion: generated.emotion,
    text: generated.text,
    englishText: generated.englishText ?? block.englishText,
    updatedAt: nowIso(),
  };
}

export function applyAiContextResult(script: ScriptProject, result: AiContextResultDocument, overwriteManual = false): { script: ScriptProject; report: AiContextImportReport } {
  const report: AiContextImportReport = { sectionsProcessed: 0, blocksImported: 0, blocksCreated: 0, manualBlocksSkipped: 0, ignoredBlocks: 0, errors: [] };
  const sections = [...(result.opening ? [result.opening] : []), ...(result.tiktoks ?? [])];
  let nextScript = structuredClone(script);
  for (const incoming of sections) {
    const target = targetSection(nextScript, incoming.sectionId);
    if (!target) { report.errors.push(`Seção ${incoming.sectionId} não encontrada.`); continue; }
    report.sectionsProcessed += 1;
    const blocks = target.section.reactionBlocks.map((block) => ({ ...block }));
    const emptyIndexes = () => blocks.map((block, index) => ({ block, index })).filter(({ block }) => blockIsEmpty(block)).map(({ index }) => index);
    for (const generated of incoming.blocks) {
      if (!nextScript.participants.some((participant) => participant.characterId === generated.characterId)) { report.ignoredBlocks += 1; report.errors.push(`Personagem ${generated.characterId} não pertence ao roteiro.`); continue; }
      const explicitIndex = generated.blockId ? blocks.findIndex((block) => block.id === generated.blockId) : -1;
      if (explicitIndex >= 0) {
        if (!blockIsEmpty(blocks[explicitIndex]) && !overwriteManual) { report.manualBlocksSkipped += 1; continue; }
        blocks[explicitIndex] = patchBlock(blocks[explicitIndex], generated);
        report.blocksImported += 1;
        continue;
      }
      if (generated.blockId) { report.ignoredBlocks += 1; report.errors.push(`Bloco ${generated.blockId} não encontrado na seção ${incoming.sectionId}.`); continue; }
      const emptyIndex = emptyIndexes()[0];
      if (emptyIndex !== undefined) {
        blocks[emptyIndex] = patchBlock(blocks[emptyIndex], generated);
        report.blocksImported += 1;
      } else {
        const created = patchBlock(createReactionBlock(generated.type), generated);
        blocks.push(created);
        report.blocksCreated += 1;
      }
    }
    nextScript = target.opening
      ? { ...nextScript, opening: nextScript.opening ? { ...nextScript.opening, reactionBlocks: blocks, updatedAt: nowIso() } : nextScript.opening }
      : { ...nextScript, tiktoks: nextScript.tiktoks.map((section) => section.id === incoming.sectionId ? { ...section, reactionBlocks: blocks, updatedAt: nowIso() } : section) };
  }
  nextScript.updatedAt = nowIso();
  return { script: nextScript, report };
}
