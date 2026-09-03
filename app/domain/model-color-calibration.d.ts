export type ModelColorCalibrationSeed = { x: number; y: number };
export type ModelColorCalibration = {
  version: 1;
  model: string;
  basePackId: string;
  sourceKey: string;
  seeds: {
    pupils: ModelColorCalibrationSeed[];
    brows: ModelColorCalibrationSeed[];
    skin: ModelColorCalibrationSeed[];
  };
  updatedAt: string;
};

export function normalizeModelColorCalibration(value: unknown): ModelColorCalibration | null;
export function modelColorCalibrationSignature(value: unknown): string;
export function modelColorCalibrationHasScope(value: unknown, scope: string): boolean;
export function buildCalibratedModelColorSelectionMask(
  scope: string,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  visibleBounds: { minX: number; minY: number; maxX: number; maxY: number },
  profile: ModelColorCalibration,
): Uint8Array;
