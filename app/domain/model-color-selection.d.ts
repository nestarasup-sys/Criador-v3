import type { ModelColorAdjustments, ModelColorScope } from "./character-contract";

export const DEFAULT_MODEL_COLOR_SCOPE: ModelColorScope;
export function emptyModelColorAdjustments(): ModelColorAdjustments;
export function normalizeModelColorScope(value?: unknown): ModelColorScope;
export function normalizeModelColorAdjustments(value?: Partial<ModelColorAdjustments> | null): ModelColorAdjustments;
export function inferModelFaceBounds(data: Uint8ClampedArray, width: number, height: number, visibleBounds: { minX: number; minY: number; maxX: number; maxY: number }): { minX: number; minY: number; maxX: number; maxY: number };
export function inferModelEyeLanes(data: Uint8ClampedArray, width: number, height: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }): number[];
import type { ModelColorCalibration } from "./model-color-calibration";
export function buildModelColorSelectionMask(scope: ModelColorScope | "details" | "all", data: Uint8ClampedArray, width: number, height: number, visibleBounds: { minX: number; minY: number; maxX: number; maxY: number }, calibration?: ModelColorCalibration | null): Uint8Array;
export function isModelColorPixel(scope: ModelColorScope | "details" | "all", red: number, green: number, blue: number, alpha: number, position?: { x: number; y: number; bounds: { minX: number; minY: number; maxX: number; maxY: number }; eyeLanes?: number[] }): boolean;
