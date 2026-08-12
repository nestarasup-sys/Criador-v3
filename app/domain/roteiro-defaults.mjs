export const RECOMMENDED_ROTEIROS_MODEL = "gemma4:12b-it-qat";

export const DEFAULT_ROTEIROS_SETTINGS = Object.freeze({
  aiProvider: "none",
  aiBaseUrl: "http://127.0.0.1:1234/v1",
  aiModel: "",
  temperature: 0.45,
  defaultBlockCount: 6,
  shortLinesByDefault: false,
  historyLimit: 5,
});

export function createDefaultRoteirosSettings() {
  return { ...DEFAULT_ROTEIROS_SETTINGS };
}
