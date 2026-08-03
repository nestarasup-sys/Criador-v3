export type VisibleBounds = { x: number; y: number; width: number; height: number };

export function findVisibleBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    alphaThreshold?: number;
    padding?: number;
    search?: VisibleBounds;
  },
): VisibleBounds | null;
