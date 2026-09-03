import type { Model } from "./character-primitives";
import { normalizeModelColorCalibration } from "./model-color-calibration.mjs";
import type { ModelColorCalibration, ModelColorCalibrationSeed } from "./model-color-calibration.mjs";

export type { ModelColorCalibration, ModelColorCalibrationSeed };

export const MODEL_COLOR_CALIBRATIONS_STORAGE_KEY = "nymi-model-color-calibrations-v1";

export function modelColorCalibrationKey(model: Model, basePackId: string) {
  return `${model}:${basePackId}`;
}

export function emptyModelColorCalibration(model: Model, basePackId: string, sourceKey = ""): ModelColorCalibration {
  return {
    version: 1,
    model,
    basePackId,
    sourceKey,
    seeds: { pupils: [], brows: [], skin: [] },
    updatedAt: new Date().toISOString(),
  };
}

export function parseModelColorCalibrations(raw: string | null): Record<string, ModelColorCalibration> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([key, value]) => [key, normalizeModelColorCalibration(value)])
      .filter((entry): entry is [string, ModelColorCalibration] => Boolean(entry[1])));
  } catch {
    return {};
  }
}
