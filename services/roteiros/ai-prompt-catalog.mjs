const MAX_OVERRIDE_LENGTH = 12_000;
const MAX_SNAPSHOTS_PER_OPERATION = 5;

const entries = [
  { id: "roteiros.test", label: "Testar conexão OpenAI", button: "Testar conexão OpenAI", endpoint: "/roteiros/ai/test", promptKind: "technical", description: "Verifica se o modelo OpenAI responde.", editable: false, variables: [] },
  { id: "roteiros.models", label: "Listar modelos", button: "Atualizar modelos", endpoint: "/roteiros/ai/models", promptKind: "none", description: "Consulta os modelos disponíveis no provedor.", editable: false, variables: [] },
  { id: "roteiros.status", label: "Status da OpenAI", button: "Status da OpenAI", endpoint: "/roteiros/ai/status", promptKind: "none", description: "Consulta configuração e uso do provedor.", editable: false, variables: [] },
  { id: "roteiros.fill-empty", label: "Preencher vazios", button: "Preencher vazios", endpoint: "/roteiros/ai/generate", promptKind: "structured", description: "Preenche apenas os blocos sem conteúdo.", editable: true, variables: ["characters", "generalContext", "previousSections", "section", "globalRules", "targets", "generationMode"] },
  { id: "roteiros.opening", label: "Gerar abertura", button: "Preencher vazios (abertura)", endpoint: "/roteiros/ai/generate", promptKind: "structured", description: "Gera reações para a cena presencial de abertura.", editable: true, variables: ["characters", "generalContext", "section", "globalRules", "targets", "generationMode"] },
  { id: "roteiros.replace-all", label: "Substituir todos os blocos", button: "Substituir todos", endpoint: "/roteiros/ai/generate", promptKind: "structured", description: "Substitui todos os blocos da seção.", editable: true, variables: ["characters", "generalContext", "previousSections", "section", "globalRules", "targets", "generationMode"] },
  { id: "roteiros.improve-video-description", label: "Melhorar descrição de vídeo", button: "Melhorar descrição", endpoint: "/roteiros/ai/improve-context", promptKind: "structured", description: "Reescreve a descrição do vídeo para ficar mais clara.", editable: true, variables: ["description", "contextScope"] },
  { id: "roteiros.improve-general-context", label: "Melhorar contexto geral", button: "Melhorar contexto", endpoint: "/roteiros/ai/improve-context", promptKind: "structured", description: "Reescreve o contexto geral do roteiro.", editable: true, variables: ["description", "contextScope"] },
  { id: "roteiros.improve-sentence", label: "Melhorar frase", button: "Melhorar frase", endpoint: "/roteiros/ai/block", promptKind: "structured", description: "Melhora uma reação preservando seu sentido.", editable: true, variables: ["block", "characters", "generalContext", "previousSections", "section", "globalRules", "generationMode"] },
  { id: "roteiros.variations", label: "Gerar variações", button: "Gerar variações", endpoint: "/roteiros/ai/block", promptKind: "structured", description: "Gera três versões alternativas de uma reação.", editable: true, variables: ["block", "characters", "generalContext", "previousSections", "section", "globalRules", "generationMode"] },
  { id: "roteiros.translate", label: "Traduzir para inglês", button: "Gerar inglês para todos", endpoint: "/roteiros/ai/translate", promptKind: "structured", description: "Traduz falas e pensamentos mantendo IDs e ordem.", editable: true, variables: ["sceneDescription", "items"] },
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

export function applyAiPromptOverride(prompt, operation, overrides = {}) {
  const custom = normalizeAiPromptOverrides(overrides)[normalizeAiPromptOperation(operation)];
  if (!custom) return String(prompt);
  return `<INSTRUCOES_PERSONALIZADAS_DA_OPERACAO>\n${custom}\n</INSTRUCOES_PERSONALIZADAS_DA_OPERACAO>\n\n${String(prompt)}`;
}

export function createAiPromptSnapshot({ operation, provider, model, instructions = "", input = "", variables = {}, attempt = 1, status = "sent", error = null, usage = null, durationMs = null, sentAt = new Date().toISOString() }) {
  return {
    operation: normalizeAiPromptOperation(operation),
    provider: String(provider || "unknown"),
    model: model ? String(model) : null,
    instructions: String(instructions || ""),
    input: String(input || ""),
    variables: variables && typeof variables === "object" && !Array.isArray(variables) ? structuredClone(variables) : {},
    attempt: Number.isFinite(Number(attempt)) ? Math.max(1, Math.round(Number(attempt))) : 1,
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
    customPrompt: normalizedOverrides[entry.id] || "",
    lastExecution: Array.isArray(snapshots[entry.id]) ? snapshots[entry.id].at(-1) || null : null,
    executions: Array.isArray(snapshots[entry.id]) ? snapshots[entry.id] : [],
  }));
}

export { MAX_OVERRIDE_LENGTH, MAX_SNAPSHOTS_PER_OPERATION };
