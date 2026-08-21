export type TonalRecolorOptions = {
  hue?: number;
  saturation?: number;
  brightness?: number;
  tint?: string;
  tintStrength?: number;
  contrast?: number;
  detailPreservation?: number;
};

export function recolorPixels(data: Uint8ClampedArray, options?: TonalRecolorOptions): Uint8ClampedArray;

