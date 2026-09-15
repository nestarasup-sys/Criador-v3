export const AI_DIRECTIVES = [
  { id: "romance", label: "Romance", color: "#b94778", prompt: "Priorize atração, tensão romântica, subtexto e confusão emocional sem tornar o romance harmonioso." },
  { id: "jealousy", label: "Ciúme", color: "#c25a37", prompt: "Explore ciúme, disputa por atenção e medo de ser substituído sem transformar suspeita em fato." },
  { id: "conflict", label: "Briga", color: "#b8344e", prompt: "Aumente confronto, interrupções, acusações e discordâncias com motivos coerentes." },
  { id: "intrigue", label: "Intriga", color: "#6951b8", prompt: "Crie suspeitas, segredos, informações incompletas e interpretações conflitantes." },
  { id: "mockery", label: "Deboche", color: "#8b5a35", prompt: "Use ironia, provocações e humor ácido para expor fraquezas sem apagar a personalidade." },
  { id: "suspense", label: "Suspense", color: "#405b91", prompt: "Aumente a sensação de perigo e expectativa sem inventar fatos não confirmados." },
  { id: "revelation", label: "Revelação", color: "#b07b22", prompt: "Permita que uma reação revele uma informação, memória ou intenção sustentada pelo contexto." },
  { id: "attraction", label: "Atração", color: "#d04e65", prompt: "Mostre interesse, magnetismo, desconforto e sinais de atração através de subtexto." },
  { id: "betrayal", label: "Traição", color: "#71344e", prompt: "Explore quebra de confiança, lealdades divididas e medo de ser enganado." },
  { id: "acid-humor", label: "Humor ácido", color: "#4d8061", prompt: "Use comentários mordazes e humor sombrio para aliviar ou intensificar a tensão." },
];

export const AI_DIRECTIVE_BY_ID = new Map(AI_DIRECTIVES.map((directive) => [directive.id, directive]));

export function normalizeAiDirectives(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter((item) => AI_DIRECTIVE_BY_ID.has(item)))];
}

export function aiDirectivePrompt(value) {
  return normalizeAiDirectives(value).map((id) => AI_DIRECTIVE_BY_ID.get(id)?.prompt).filter(Boolean).join("\n");
}
