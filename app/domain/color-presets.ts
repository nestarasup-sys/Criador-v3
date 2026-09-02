import type { ColorAdjustment } from "./character-contract";
import { normalizeColorAdjustment } from "./color-rendering";

export const COLOR_PRESETS_STORAGE_KEY = "nymi-color-presets-v1";
export const MODEL_COLOR_DEFAULTS_STORAGE_KEY = "nymi-model-color-defaults-v1";

export type SavedColorPreset = {
  id: string;
  name: string;
  adjustment: ColorAdjustment;
  createdAt: string;
};

export function normalizeSavedColorPreset(value: unknown): SavedColorPreset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedColorPreset>;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : crypto.randomUUID(),
    name: candidate.name.trim().slice(0, 48),
    adjustment: normalizeColorAdjustment(candidate.adjustment),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
  };
}

export function parseSavedColorPresets(raw: string | null): SavedColorPreset[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSavedColorPreset).filter((entry): entry is SavedColorPreset => Boolean(entry)).slice(0, 80);
  } catch {
    return [];
  }
}

export function modelColorDefaultKey(model: string, basePackId: string, scope: string) {
  return `${model}:${basePackId}:${scope}`;
}
