export type SentPromptPreview = {
  provider: string;
  operation: string;
  instructions: string;
  input: string;
  model?: string;
  attempts?: number;
  sentAt: string;
};

export const PROMPT_PREVIEW_MAX_CHARS = 6_000;

export function compactPromptText(value: unknown, maxChars = PROMPT_PREVIEW_MAX_CHARS) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[… truncado para diagnóstico local]`;
}

export function compactSentPromptPreview(preview: Omit<SentPromptPreview, "sentAt">, sentAt = new Date().toISOString()): SentPromptPreview {
  return {
    provider: String(preview.provider ?? ""),
    operation: String(preview.operation ?? ""),
    instructions: compactPromptText(preview.instructions),
    input: compactPromptText(preview.input),
    ...(preview.model ? { model: String(preview.model) } : {}),
    ...(preview.attempts === undefined ? {} : { attempts: preview.attempts }),
    sentAt,
  };
}
