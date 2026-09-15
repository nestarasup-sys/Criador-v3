import { PROTECTED_SEMANTIC_RULES, PROTECTED_STRUCTURAL_RULES } from "../../app/domain/roteiro-prompt-contract.mjs";

const MAX_OVERRIDE_LENGTH = 12_000;
const MAX_SNAPSHOTS_PER_OPERATION = 5;

const REACTION_POLICY = `Escreva uma sequência de reações destinada à leitura silenciosa.

Os blocos devem formar uma conversa contínua e progressiva, não uma lista de comentários independentes. Cada novo bloco precisa acrescentar uma perspectiva, dúvida, provocação, contestação, defesa, revelação emocional ou mudança de tensão que ainda não tenha sido usada nesta sequência.

Escolha o participante com maior motivo narrativo para reagir naquele momento. Não trate a ordem da lista de personagens como ordem de fala e não force participação igual. Evite repetir personagem, assunto, posição emocional e construção de frase quando houver alternativa coerente.

Quando houver um encerramento natural, considere terminar a sequência com um pensamento privado. Esse pensamento pode refletir sobre o que os outros disseram, revelar indignação, raiva, descrença, desprezo, deboche, admiração, ciúme, confusão ou uma conclusão provisória; também pode ser sobre FYN, sobre a situação ou sobre outro personagem. Deixe a API escolher livremente a reação mais interessante e coerente com a personalidade, inclusive um julgamento duro como considerar alguém um idiota, desde que isso permaneça como pensamento interno e não seja tratado como fato confirmado. Não force esse encerramento quando a conversa já terminar melhor em fala.

Os personagens podem discordar, provocar, debochar, desconfiar, defender, mentir, recuar ou interpretar uma situação incorretamente. Quando o contexto não confirmar uma interpretação, escreva-a como suspeita, pergunta, receio ou opinião — nunca como fato estabelecido.

O diálogo deve funcionar visualmente no papel: natural, claro e completo sem depender de atuação vocal, mas ainda escrito como fala ou pensamento, jamais como narração ou rubrica.`;

const OPENING_POLICY = `Escreva uma cena presencial de abertura destinada à leitura silenciosa. Os personagens estão juntos na sala antes do início de qualquer conteúdo exibido.

Faça os blocos progredirem a partir das ações descritas na abertura. Use personalidade, relações e tensão já existentes, sem antecipar ou inventar o conteúdo que será exibido. Cada bloco deve alterar a conversa, responder a algo audível ou revelar privadamente um pensamento relevante.`;

const IMPROVE_CONTEXT_POLICY = `Reescreva a fonte para que outra IA compreenda os acontecimentos sem ambiguidade acidental. Preserve todos os fatos, agentes, alvos, relações causais, informações desconhecidas e ambiguidades intencionais. Organize a sequência com clareza e acrescente apenas explicitações sustentadas pela própria fonte.`;

const IMPROVE_SENTENCE_POLICY = `Melhore a reação para leitura silenciosa preservando personagem, intenção, fatos, subtexto e tipo do bloco. Fortaleça clareza, naturalidade e impacto sem transformar a frase em narração e sem adicionar informação nova.`;

const VARIATIONS_POLICY = `Crie alternativas realmente distintas da reação original. Preserve personagem, intenção, fatos, subtexto e tipo do bloco, mas varie construção, ritmo e ênfase. As alternativas não podem ser apenas trocas de sinônimos.`;

const TRANSLATION_POLICY = `Traduza para inglês natural preservando sentido, personalidade, nível de agressividade, humor, subtexto e distinção entre fala e pensamento. Não suavize conflitos, não explique e não acrescente informação.`;

const PROFILE_TRAITS_POLICY = `Você é um editor de fichas de personagens para roteiros de drama, romance sombrio e conflito psicológico. A tarefa NÃO é apenas resumir ou reorganizar o texto bruto: reescreva o conteúdo em uma ficha utilizável pela IA, tornando os traços narrativos mais específicos, intensos e acionáveis.

Use o texto bruto como fonte de verdade. Preserve todos os fatos, contradições e incertezas. Você pode transformar um traço em consequências dramáticas sustentadas por ele: por exemplo, “possessivo” pode virar controle sobre a situação, negação do ciúme e reação à atenção dada a um rival; “fala pouco” pode virar frases curtas, silêncio ameaçador e respostas que não explicam demais. Isso é intensificação de escrita, não autorização para inventar passado, romance, gênero, crimes, sentimentos ou acontecimentos.

Preencha e REESCREVA estes campos:
- personality: temperamento, desejos, medos, gatilhos, contradições e modo de reagir sob pressão;
- backstory: passado e fatos que explicam o comportamento, sem criar fatos ausentes;
- fynRelationship: o que sente, quer, teme ou esconde de FYN, somente quando sustentado pelo texto;
- speakingStyle: ritmo, tamanho das frases, vocabulário, subtexto, ataques, silêncios e coisas que o personagem não diria;
- additionalRules: regras comportamentais concretas para manter consistência entre cenas;
- relationships: relações direcionais com personagens conhecidos, somente se o texto bruto sustentar a relação.

A ficha deve parecer uma instrução dramática pronta para outra IA interpretar o personagem, não um relatório genérico. Dê preferência a formulações concretas como “quando X acontece, reage fazendo Y” em vez de adjetivos soltos. Não use Markdown dentro dos campos e não coloque explicações fora do JSON.`;
const PROFILE_RELATIONS_POLICY = `Você é um editor de fichas de personagens para roteiros de drama, romance sombrio e conflito psicológico. A tarefa NÃO é apenas resumir ou reorganizar o texto bruto: reescreva-o em uma ficha intensificada, dramática e diretamente utilizável pela IA.

Use o texto bruto como fonte de verdade. Preserve fatos, contradições e incertezas. Intensifique a forma narrativa convertendo traços já presentes em comportamento observável, subtexto, gatilhos e consequências em cena, mas NÃO invente passado, romance, gênero, crimes, sentimentos ou eventos que não estejam sustentados.

Preencha e REESCREVA personality, backstory, fynRelationship, speakingStyle e additionalRules com o mesmo padrão de intensidade da ficha de traços. Além disso, dê prioridade às relações dramáticas direcionais: quem o personagem deseja, teme, rivaliza, protege, manipula, testa ou despreza. Cada relação deve explicar como o personagem enxerga o alvo e como tende a agir com ele. Use os IDs dos personagens conhecidos, nunca nomes inventados, nunca o próprio personagem e nunca relações sem base no texto bruto.

As relações devem ser úteis para gerar briga, ciúme, romance, desconfiança, deboche e intriga quando esses elementos estiverem presentes na fonte. Não transforme toda relação em romance e não suavize conflitos. Dê preferência a regras acionáveis como “quando o alvo desafia sua autoridade, ele...” em vez de “eles não se gostam”.

A ficha deve parecer uma instrução dramática pronta para outra IA interpretar o personagem, não um relatório genérico. Não use Markdown dentro dos campos e não coloque explicações fora do JSON.`;

const entries = [
  { id: "roteiros.test", label: "Testar conexão OpenAI", button: "Testar conexão OpenAI", endpoint: "/roteiros/ai/test", promptKind: "technical", description: "Verifica se o modelo OpenAI responde.", editable: false, variables: [], defaultPrompt: "Responda somente OK." },
  { id: "roteiros.models", label: "Listar modelos", button: "Atualizar modelos", endpoint: "/roteiros/ai/models", promptKind: "none", description: "Consulta os modelos disponíveis no provedor.", editable: false, variables: [], defaultPrompt: "" },
  { id: "roteiros.status", label: "Status da OpenAI", button: "Status da OpenAI", endpoint: "/roteiros/ai/status", promptKind: "none", description: "Consulta configuração e uso do provedor.", editable: false, variables: [], defaultPrompt: "" },
  { id: "roteiros.fill-empty", label: "Preencher vazios", button: "Preencher vazios", endpoint: "/roteiros/ai/generate", promptKind: "structured", description: "Preenche apenas os blocos sem conteúdo.", editable: true, variables: ["characters", "generalContext", "previousSections", "section", "globalRules", "targets", "generationMode"], defaultPrompt: REACTION_POLICY },
  { id: "roteiros.opening", label: "Gerar abertura", button: "Preencher vazios (abertura)", endpoint: "/roteiros/ai/generate", promptKind: "structured", description: "Gera reações para a cena presencial de abertura.", editable: true, variables: ["characters", "generalContext", "section", "globalRules", "targets", "generationMode"], defaultPrompt: OPENING_POLICY },
  { id: "roteiros.replace-all", label: "Substituir todos os blocos", button: "Substituir todos", endpoint: "/roteiros/ai/generate", promptKind: "structured", description: "Substitui todos os blocos da seção.", editable: true, variables: ["characters", "generalContext", "previousSections", "section", "globalRules", "targets", "generationMode"], defaultPrompt: REACTION_POLICY },
  { id: "roteiros.improve-video-description", label: "Melhorar descrição de vídeo", button: "Melhorar descrição", endpoint: "/roteiros/ai/improve-context", promptKind: "structured", description: "Reescreve a descrição do vídeo para ficar mais clara.", editable: true, variables: ["description", "contextScope"], defaultPrompt: IMPROVE_CONTEXT_POLICY },
  { id: "roteiros.improve-general-context", label: "Melhorar contexto geral", button: "Melhorar contexto", endpoint: "/roteiros/ai/improve-context", promptKind: "structured", description: "Reescreve o contexto geral do roteiro.", editable: true, variables: ["description", "contextScope"], defaultPrompt: IMPROVE_CONTEXT_POLICY },
  { id: "roteiros.improve-sentence", label: "Melhorar frase", button: "Melhorar frase", endpoint: "/roteiros/ai/block", promptKind: "structured", description: "Melhora uma reação preservando seu sentido.", editable: true, variables: ["block", "characters", "generalContext", "previousSections", "section", "globalRules", "generationMode"], defaultPrompt: IMPROVE_SENTENCE_POLICY },
  { id: "roteiros.variations", label: "Gerar variações", button: "Gerar variações", endpoint: "/roteiros/ai/block", promptKind: "structured", description: "Gera três versões alternativas de uma reação.", editable: true, variables: ["block", "characters", "generalContext", "previousSections", "section", "globalRules", "generationMode"], defaultPrompt: VARIATIONS_POLICY },
  { id: "roteiros.translate", label: "Traduzir para inglês", button: "Gerar inglês para todos", endpoint: "/roteiros/ai/translate", promptKind: "structured", description: "Traduz falas e pensamentos mantendo IDs e ordem.", editable: true, variables: ["sceneDescription", "items"], defaultPrompt: TRANSLATION_POLICY },
  { id: "roteiros.organize-profile-traits", label: "Organizar ficha — traços", button: "Organizar com Ficha 1", endpoint: "/roteiros/ai/organize-profile", promptKind: "structured", description: "Distribui o texto bruto nos campos principais da ficha.", editable: true, variables: ["rawText", "characterName", "knownCharacters", "profileMode"], defaultPrompt: PROFILE_TRAITS_POLICY },
  { id: "roteiros.organize-profile-relations", label: "Organizar ficha — relações intensificadas", button: "Organizar com Ficha 3", endpoint: "/roteiros/ai/organize-profile", promptKind: "structured", description: "Reescreve a ficha e fortalece relações dramáticas direcionais.", editable: true, variables: ["rawText", "characterName", "knownCharacters", "profileMode"], defaultPrompt: PROFILE_RELATIONS_POLICY },
];

const entryById = new Map(entries.map((entry) => [entry.id, entry]));

export function normalizeAiPromptOperation(operation) {
  const value = String(operation || "");
  return value.startsWith("roteiros.") ? value : `roteiros.${value}`;
}

export function listAiPromptCatalog() {
  return entries.map((entry) => ({ ...entry, variables: [...entry.variables] }));
}

export function hasAiPromptOperation(operation) {
  return entryById.has(normalizeAiPromptOperation(operation));
}

export function normalizeAiPromptOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [operation, prompt] of Object.entries(value)) {
    if (!entryById.get(operation)?.editable || typeof prompt !== "string") continue;
    const text = prompt.trim();
    if (text) normalized[operation] = text.slice(0, MAX_OVERRIDE_LENGTH);
  }
  return normalized;
}

export function validateAiPromptOverride(operation, value) {
  const entry = entryById.get(normalizeAiPromptOperation(operation));
  if (!entry) throw Object.assign(new Error("Operação de IA desconhecida."), { status: 404, code: "AI_PROMPT_UNKNOWN_OPERATION" });
  if (!entry.editable) throw Object.assign(new Error("Esta operação não possui prompt editável."), { status: 422, code: "AI_PROMPT_NOT_EDITABLE" });
  if (typeof value !== "string") throw Object.assign(new Error("O prompt precisa ser texto."), { status: 422, code: "AI_PROMPT_INVALID" });
  const text = value.trim();
  if (text.length > MAX_OVERRIDE_LENGTH) throw Object.assign(new Error(`O prompt pode ter no máximo ${MAX_OVERRIDE_LENGTH} caracteres.`), { status: 422, code: "AI_PROMPT_TOO_LONG" });
  const unknownPlaceholders = [...text.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1].trim()).filter((name) => !entry.variables.includes(name));
  if (unknownPlaceholders.length) throw Object.assign(new Error(`Variável(veis) inválida(s): ${[...new Set(unknownPlaceholders)].join(", ")}.`), { status: 422, code: "AI_PROMPT_INVALID_VARIABLE" });
  return text;
}

function promptVariableText(value) {
  if (value === undefined || value === null || value === "") return "Não informado.";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function renderAiPromptTemplate(template, operation, variables = {}) {
  const entry = entryById.get(normalizeAiPromptOperation(operation));
  if (!entry) throw Object.assign(new Error("Operação de IA desconhecida."), { status: 404, code: "AI_PROMPT_UNKNOWN_OPERATION" });
  return String(template || "").replace(/\{\{([^}]+)\}\}/g, (placeholder, rawName) => {
    const name = String(rawName).trim();
    if (!entry.variables.includes(name)) return placeholder;
    return promptVariableText(variables[name]);
  });
}

export function resolveAiNarrativePrompt(operation, overrides = {}, variables = {}, legacyPrompt = "") {
  const normalizedOperation = normalizeAiPromptOperation(operation);
  const entry = entryById.get(normalizedOperation);
  if (!entry) throw Object.assign(new Error("Operação de IA desconhecida."), { status: 404, code: "AI_PROMPT_UNKNOWN_OPERATION" });
  const custom = normalizeAiPromptOverrides(overrides)[normalizedOperation];
  const legacy = ["roteiros.fill-empty", "roteiros.opening"].includes(normalizedOperation) ? String(legacyPrompt || "").trim().slice(0, MAX_OVERRIDE_LENGTH) : "";
  const source = custom || legacy || entry.defaultPrompt || "";
  return {
    text: renderAiPromptTemplate(source, normalizedOperation, variables),
    version: custom ? "custom" : legacy ? "legacy" : "default",
  };
}

function sectionText(label, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return `<${label}>\n${text}\n</${label}>`;
}

export function buildAiPrompt({ operation, task, narrativePolicy, operationRules = [], data = {}, plan = null, finalChecks = [] }) {
  const normalizedOperation = normalizeAiPromptOperation(operation);
  const sections = [
    sectionText("POLITICA_NARRATIVA", narrativePolicy || "Nenhuma política narrativa adicional."),
    sectionText("OPERACAO", { id: normalizedOperation, task }),
    sectionText("REGRAS_DA_OPERACAO", operationRules.length ? operationRules : ["Nenhuma regra adicional."]),
    sectionText("DADOS_DO_ROTEIRO", data),
  ];
  if (plan) sections.push(sectionText("PLANO_SUGERIDO", plan));
  if (finalChecks.length) sections.push(sectionText("VERIFICACAO_FINAL", finalChecks));
  return sections.join("\n\n");
}

export function createAiPromptSnapshot({ operation, provider, model, instructions = "", input = "", variables = {}, attempt = 1, attempts = null, status = "sent", error = null, usage = null, durationMs = null, sentAt = new Date().toISOString() }) {
  return {
    operation: normalizeAiPromptOperation(operation),
    provider: String(provider || "unknown"),
    model: model ? String(model) : null,
    instructions: String(instructions || ""),
    input: String(input || ""),
    variables: variables && typeof variables === "object" && !Array.isArray(variables) ? structuredClone(variables) : {},
    attempt: Number.isFinite(Number(attempts ?? attempt)) ? Math.max(1, Math.round(Number(attempts ?? attempt))) : 1,
    sentAt: String(sentAt),
    durationMs: Number.isFinite(Number(durationMs)) ? Number(durationMs) : null,
    usage: usage && typeof usage === "object" ? structuredClone(usage) : null,
    status: String(status || "sent"),
    error: error ? String(error) : null,
  };
}

export function appendAiPromptSnapshot(history, snapshot) {
  const current = Array.isArray(history) ? history : [];
  const next = [...current, snapshot];
  return next.slice(-MAX_SNAPSHOTS_PER_OPERATION);
}

export function publicPromptCatalog(overrides = {}, snapshots = {}) {
  const normalizedOverrides = normalizeAiPromptOverrides(overrides);
  return listAiPromptCatalog().map((entry) => ({
    ...entry,
    promptVersion: normalizedOverrides[entry.id] ? "custom" : "default",
    customizationMode: "replace-narrative",
    customPrompt: normalizedOverrides[entry.id] || "",
    protectedRules: [...PROTECTED_SEMANTIC_RULES, ...PROTECTED_STRUCTURAL_RULES],
    lastExecution: Array.isArray(snapshots[entry.id]) ? snapshots[entry.id].at(-1) || null : null,
    executions: Array.isArray(snapshots[entry.id]) ? snapshots[entry.id] : [],
  }));
}

export { MAX_OVERRIDE_LENGTH, MAX_SNAPSHOTS_PER_OPERATION };
