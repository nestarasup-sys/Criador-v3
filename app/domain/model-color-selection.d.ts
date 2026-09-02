import type { ColorAdjustment, ModelColorAdjustments, ModelColorScope } from "./character-contract";

export const DEFAULT_MODEL_COLOR_SCOPE: ModelColorScope;
export function emptyModelColorAdjustments(): ModelColorAdjustments;
export function normalizeModelColorScope(value?: unknown): ModelColorScope;
export function normalizeModelColorAdjustments(value?: Partial<ModelColorAdjustments> | null): ModelColorAdjustments;
export function isModelColorPixel(scope: ModelColorScope, red: number, green: number, blue: number, alpha: number): boolean;
