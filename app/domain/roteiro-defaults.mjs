export const DEFAULT_ROTEIROS_SETTINGS = Object.freeze({
  aiProvider: "none",
  aiBaseUrl: "http://127.0.0.1:1234/v1",
  aiModel: "gemma4:e4b",
  temperature: 0.45,
  openAiModel: "gpt-5.6-luna",
  openAiReasoningEffort: "medium",
  openAiMaxOutputTokens: 2400,
  openAiTimeoutMs: 90_000,
  generationMode: "faithful",
  fillEmptyPrompt: "",
  defaultBlockCount: 6,
  shortLinesByDefault: false,
  historyLimit: 5,
});

export function createDefaultRoteirosSettings() {
  return { ...DEFAULT_ROTEIROS_SETTINGS };
}
