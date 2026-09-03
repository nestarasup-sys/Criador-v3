export type ModelColorMapMetadata = {
  version: 1;
  format: "rgb-weights";
  directory: string;
  channels: { red: "pupils"; green: "brows"; blue: "skin" };
  expressions: string[];
};

export const MODEL_COLOR_MAP_VERSION: 1;
export const MODEL_COLOR_MAP_CHANNELS: { readonly pupils: 0; readonly brows: 1; readonly skin: 2 };
export function modelColorMapChannel(scope: "pupils" | "brows" | "skin"): 0 | 1 | 2 | null;
export function modelColorMapHasChannel(data: Uint8ClampedArray, width: number, height: number, scope: "pupils" | "brows" | "skin", minimum?: number): boolean;
export function normalizeModelColorMapMetadata(value?: unknown): ModelColorMapMetadata | null;
export function modelColorMapSource(packSource: string, expressionKey: string, metadata?: unknown): string | null;
