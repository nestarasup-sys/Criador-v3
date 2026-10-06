export const DEFAULT_TEMPLATE_SKIN_COLOR: "#fff0e7";
export const TEMPLATE_SKIN_PALETTE: readonly { name: string; color: string }[];
export function normalizeTemplateSkinColor(value: unknown): string;
export function recolorTemplateSkinPixels(source: Uint8ClampedArray, width: number, height: number, color: unknown): Uint8ClampedArray;
