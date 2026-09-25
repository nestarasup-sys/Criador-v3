import { createReactionBlock, nowIso, PROTECTED_RULES } from "./defaults";
import type { GlobalRule, NarrativeProfile, OpeningSection, PremiumCharacter, ReactionBlock, ReactionBlockType, ScriptProject, TikTokSection, TikTokVideoReference } from "./types";
import { AI_CONTEXT_MIN_BLOCK_SECONDS, calculateReactionBudget } from "./generation-budget";

export { AI_CONTEXT_MIN_BLOCK_SECONDS } from "./generation-budget";

export const AI_CONTEXT_EXPORT_APP = "GACHA_PREMIUM_ROTEIROS_AI_CONTEXT_V1" as const;
export const AI_CONTEXT_RESULT_APP = "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1" as const;
export const AI_CONTEXT_SCHEMA_VERSION = 1 as const;

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
  firstGroupReactionSeconds?: number;
  firstGroupReactionSpeechCount?: number;
  secondGroupReactionSeconds?: number;
  secondGroupReactionSpeechCount?: number;
  sceneGoal: string;
  timeline: TikTokSection["timeline"];
  specificRules: string;
  userInstruction: string;
  aiDirectives: string[];
  shortLines: boolean;
  orderLocked: boolean;
  video?: TikTokVideoReference;
  durationSeconds: number | null;
  reactionStartSeconds: number | null;
  reactionWindowSeconds: number | null;
  recommendedBlockCount: number | null;
  recommendedBlockRange: { min: number; max: number } | null;
  allowPostVideoContinuation: true;
  budgetWarnings: string[];
  existingBlocks: ReactionBlock[];
  emptySlots: AiContextEmptySlot[];
  discardedBlockCount: number;
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
    editorial: {
      orderingMode: "none" | "suggest" | "apply";
      lockedSectionIds: string[];
    };
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

export type AiOrderingChange = {
  sectionId: string;
  fromPosition: number;
  toPosition: number;
  reason: string;
};

export type AiOrderingProposal = {
  mode: "suggest" | "apply" | "none";
  orderedSectionIds: string[];
  reason: string;
  changes: AiOrderingChange[];
};

export type AiContextResultDocument = {
  app: typeof AI_CONTEXT_RESULT_APP;
  schemaVersion: typeof AI_CONTEXT_SCHEMA_VERSION;
  sourceScriptId: string;
  tiktoks?: AiContextResultSection[];
  opening?: AiContextResultSection | null;
  orderingProposal?: AiOrderingProposal;
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

export type AiOrderingImportReport = {
  moved: number;
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
    "Não altere vídeos, descrições, regras, fichas ou a ordem dos TikToks, salvo se orderingProposal estiver sendo usado.",
    "Blocos vazios, apagados ou órfãos não fazem parte da base exportada e não devem ser recriados por causa de seus IDs.",
    "Use as fichas e regras somente como contexto, sem repetir a ficha artificialmente.",
  ],
};

function blockIsEmpty(block: ReactionBlock) {
  return !block.text.trim();
}

function sectionToContext(section: TikTokSection | OpeningSection, kind: "opening" | "tiktok", order: number, participantIds: Set<string>): AiContextSection {
  // A duplicação de um roteiro preserva o array de blocos. A UI também pode
  // deixar placeholders vazios quando o usuário apaga seu conteúdo. Esses
  // itens não são contexto útil e não podem chegar à base externa como se
  // fossem blocos reais para a IA preencher.
  const exportableBlocks = section.reactionBlocks.filter((block) => !blockIsEmpty(block) && participantIds.has(block.characterId));
  const existingBlocks = structuredClone(exportableBlocks);
  const discardedBlockCount = section.reactionBlocks.length - exportableBlocks.length;
  const budget = calculateReactionBudget("video" in section ? section.video?.durationSeconds : undefined, section.sceneEndSeconds);
  return {
    sectionId: section.id,
    order,
    kind,
    title: section.title,
    description: section.description,
    ...(section.sceneEndSeconds === undefined ? {} : { sceneEndSeconds: section.sceneEndSeconds }),
    ...(section.firstGroupReactionSeconds === undefined ? {} : { firstGroupReactionSeconds: section.firstGroupReactionSeconds }),
    ...(section.firstGroupReactionSpeechCount === undefined ? {} : { firstGroupReactionSpeechCount: section.firstGroupReactionSpeechCount }),
    ...(section.secondGroupReactionSeconds === undefined ? {} : { secondGroupReactionSeconds: section.secondGroupReactionSeconds }),
    ...(section.secondGroupReactionSpeechCount === undefined ? {} : { secondGroupReactionSpeechCount: section.secondGroupReactionSpeechCount }),
    sceneGoal: section.sceneGoal,
    timeline: section.timeline,
    specificRules: section.specificRules,
    userInstruction: section.userInstruction,
    aiDirectives: Array.isArray(section.aiDirectives) ? [...section.aiDirectives] : [],
    shortLines: section.shortLines,
    orderLocked: "orderLocked" in section ? Boolean(section.orderLocked) : false,
    ...('video' in section && section.video ? { video: structuredClone(section.video) } : {}),
    durationSeconds: budget.durationSeconds,
    reactionStartSeconds: budget.reactionStartSeconds,
    reactionWindowSeconds: budget.reactionWindowSeconds,
    recommendedBlockCount: budget.recommendedBlockCount,
    recommendedBlockRange: budget.recommendedBlockRange,
    allowPostVideoContinuation: budget.allowPostVideoContinuation,
    budgetWarnings: budget.warnings,
    existingBlocks,
    // Mantido por compatibilidade de schema, mas nunca enviamos IDs de
    // placeholders. A IA pode escolher livremente a quantidade de blocos.
    emptySlots: [],
    discardedBlockCount,
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
  const opening = script.opening ? sectionToContext(script.opening, "opening", 0, participantIds) : null;
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
      editorial: {
        orderingMode: script.aiOrderingMode ?? "suggest",
        lockedSectionIds: script.tiktoks.filter((section) => section.orderLocked).map((section) => section.id),
      },
    },
    characters: contextCharacters.filter((character) => participantIds.has(character.characterId)),
    rules: structuredClone(localRules),
    opening,
    tiktoks: script.tiktoks.map((section, index) => sectionToContext(section, "tiktok", index + 1, participantIds)),
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
    "## LIBERDADE EDITORIAL",
    `Modo de reorganização: ${context.project.editorial.orderingMode}.`,
    `TikToks com posição fixa: ${context.project.editorial.lockedSectionIds.length ? context.project.editorial.lockedSectionIds.join(", ") : "nenhum"}.`,
    "A IA pode sugerir uma nova ordem somente usando os IDs originais. Não altere a abertura e não remova, duplique ou recrie TikToks.",
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
      `Primeira reação em grupo pode começar no segundo: ${section.firstGroupReactionSeconds === undefined ? "não definido" : section.firstGroupReactionSeconds}`,
      `Segunda reação em grupo pode começar no segundo: ${section.secondGroupReactionSeconds === undefined ? "não definido" : section.secondGroupReactionSeconds}`,
      `Início das falas/pensamentos: ${section.reactionStartSeconds === null ? "não definido" : `${section.reactionStartSeconds} segundos`}`,
      `Janela disponível para reações: ${section.reactionWindowSeconds === null ? "não calculável" : `${section.reactionWindowSeconds} segundos`}`,
      `Blocos recomendados: ${section.recommendedBlockCount === null ? "não calculável" : `${section.recommendedBlockRange?.min}–${section.recommendedBlockRange?.max} (alvo ${section.recommendedBlockCount})`}`,
      `Continuação depois do vídeo: ${section.allowPostVideoContinuation ? "permitida quando necessária, sem gerar blocos extras desnecessários" : "não permitida"}`,
      ...(section.budgetWarnings.length ? [`Avisos de tempo: ${section.budgetWarnings.join(" | ")}`] : []),
      `Objetivo: ${section.sceneGoal || "Não informado."}`,
      `Linha temporal: ${section.timeline}`,
      `Regras específicas: ${section.specificRules || "Nenhuma."}`,
      `Instrução adicional: ${section.userInstruction || "Nenhuma."}`,
      `Direções dramáticas: ${section.aiDirectives?.length ? section.aiDirectives.join(", ") : "Nenhuma."}`,
      `Vídeo: ${section.video ? `${section.video.name} — ${section.video.storedPath}` : "Nenhum vídeo informado."}`,
      `Posição fixa: ${section.orderLocked ? "sim" : "não"}`,
      `Blocos existentes: ${JSON.stringify(section.existingBlocks)}`,
      `Blocos descartados por estarem vazios ou órfãos: ${section.discardedBlockCount}`,
      "Espaços vazios: nenhum ID de placeholder é exportado; crie somente os blocos necessários.",
      "",
    ]),
    "## FORMATO OBRIGATÓRIO DA RESPOSTA",
    "Depois de analisar este documento, gere imediatamente um arquivo JSON baixável chamado `RESPOSTA_<scriptId>.json`.",
    "O arquivo deve conter somente JSON válido. Não retorne explicações, Markdown ou comentários fora do JSON.",
    "Use exatamente este formato:",
    JSON.stringify(responseExample, null, 2),
    "Cada bloco deve conter: blockId opcional ou null, characterId, type, emotion, text e englishText opcional.",
    "Se a ordem puder melhorar, inclua orderingProposal com todos os sectionIds exatamente uma vez e explique as mudanças.",
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

function resultOrderingProposal(value: unknown, script: ScriptProject, errors: string[], warnings: string[]): AiOrderingProposal | undefined {
  if (value === undefined || value === null) return undefined;
  const source = record(value);
  const mode = source.mode;
  if (mode !== "suggest" && mode !== "apply" && mode !== "none") errors.push("orderingProposal.mode deve ser suggest, apply ou none");
  if (!Array.isArray(source.orderedSectionIds)) errors.push("orderingProposal.orderedSectionIds deve ser uma lista completa");
  const currentIds = script.tiktoks.map((section) => section.id);
  const orderedSectionIds = Array.isArray(source.orderedSectionIds) ? source.orderedSectionIds.filter((id): id is string => typeof id === "string") : [];
  if (orderedSectionIds.length !== currentIds.length) errors.push("orderingProposal deve conter todos os TikToks atuais exatamente uma vez");
  const seen = new Set<string>();
  for (const id of orderedSectionIds) {
    if (seen.has(id)) errors.push(`TikTok ${id} aparece mais de uma vez na proposta de ordem.`);
    seen.add(id);
    if (!currentIds.includes(id)) errors.push(`TikTok ${id} não existe neste roteiro.`);
  }
  for (const id of currentIds) if (!seen.has(id)) errors.push(`TikTok ${id} não foi incluído na proposta de ordem.`);
  const currentPositions = new Map(currentIds.map((id, index) => [id, index]));
  orderedSectionIds.forEach((id, index) => {
    const original = currentPositions.get(id);
    const section = script.tiktoks.find((item) => item.id === id);
    if (original !== undefined && section?.orderLocked && original !== index) errors.push(`TikTok ${id} está com posição fixa e não pode ser movido.`);
  });
  if (script.aiOrderingMode === "none") warnings.push("Este roteiro está configurado para não permitir reorganização; a proposta ficará somente para consulta.");
  const changes = Array.isArray(source.changes) ? source.changes.map((change, index) => {
    const item = record(change);
    const sectionId = stringValue(item.sectionId);
    const fromPosition = Number(item.fromPosition);
    const toPosition = Number(item.toPosition);
    const reason = stringValue(item.reason);
    if (!sectionId || !Number.isInteger(fromPosition) || !Number.isInteger(toPosition)) errors.push(`orderingProposal.changes[${index}] é inválido`);
    return { sectionId, fromPosition, toPosition, reason };
  }) : [];
  return {
    mode: (mode === "suggest" || mode === "apply" || mode === "none" ? mode : "suggest"),
    orderedSectionIds,
    reason: stringValue(source.reason),
    changes,
  };
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
  const orderingProposal = resultOrderingProposal(source.orderingProposal, script, errors, warnings);
  const sectionIds = new Set([...(script.opening ? [script.opening.id] : []), ...script.tiktoks.map((section) => section.id)]);
  const characterIds = new Set(script.participants.map((participant) => participant.characterId));
  for (const section of [...tiktoks, ...(opening ? [opening] : [])]) {
    if (!sectionIds.has(section.sectionId)) errors.push(`A seção ${section.sectionId} não existe neste roteiro.`);
    for (const block of section.blocks) if (!characterIds.has(block.characterId)) errors.push(`O personagem ${block.characterId} não pertence ao elenco deste roteiro.`);
  }
  if (!tiktoks.length && !opening?.blocks.length && !orderingProposal) warnings.push("O arquivo não contém blocos para importar.");
  if (errors.length) return { valid: false, errors, warnings };
  return { valid: true, errors, warnings, data: { app: AI_CONTEXT_RESULT_APP, schemaVersion: AI_CONTEXT_SCHEMA_VERSION, sourceScriptId: script.id, tiktoks, ...(opening ? { opening } : {}), ...(orderingProposal ? { orderingProposal } : {}) } };
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

export function applyAiOrderingProposal(script: ScriptProject, result: AiContextResultDocument): { script: ScriptProject; report: AiOrderingImportReport } {
  const proposal = result.orderingProposal;
  if (!proposal || proposal.mode === "none") return { script: structuredClone(script), report: { moved: 0, errors: [] } };
  if (script.aiOrderingMode === "none") return { script: structuredClone(script), report: { moved: 0, errors: ["A reorganização está desativada neste roteiro."] } };
  const currentIds = script.tiktoks.map((section) => section.id);
  if (proposal.orderedSectionIds.length !== currentIds.length || new Set(proposal.orderedSectionIds).size !== currentIds.length || proposal.orderedSectionIds.some((id) => !currentIds.includes(id))) {
    return { script: structuredClone(script), report: { moved: 0, errors: ["A proposta não corresponde exatamente aos TikToks atuais."] } };
  }
  const byId = new Map(script.tiktoks.map((section) => [section.id, section]));
  const moved = proposal.orderedSectionIds.reduce((count, id, index) => count + (currentIds[index] === id ? 0 : 1), 0);
  const nextScript = structuredClone(script);
  nextScript.tiktoks = proposal.orderedSectionIds.map((id) => byId.get(id)!).map((section) => ({ ...section }));
  nextScript.updatedAt = nowIso();
  return { script: nextScript, report: { moved, errors: [] } };
}
