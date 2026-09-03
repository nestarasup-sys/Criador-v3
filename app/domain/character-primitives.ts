export type BasePackId = string;
export { CATEGORIES, FACE_MODES, MODELS, isCategory, isModel } from "./character-values.mjs";
export type Model = "feminino" | "masculino";
export type Category = "cabelos" | "cabelosTras" | "rostos" | "roupas";
export type FaceMode = "base" | "single" | "pack";

export type ItemTransform = {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipX: boolean;
  /**
   * Ajuste localizado da cabeça embutida em uma roupa. O corpo continua
   * usando o transform principal; apenas o recorte da cabeça usa este
   * segundo transform.
   */
  headFit?: HeadFitCorrection;
};

export type HeadFitCorrection = {
  source: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    contour: Array<{ y: number; left: number; right: number }>;
  };
  transform: {
    x: number;
    y: number;
    scale: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    flipX: boolean;
  };
};

export type MaskPoint = { x: number; y: number };

export type MaskStroke = {
  id: string;
  mode: "erase" | "restore";
  size: number;
  points: MaskPoint[];
  shape?: "polygon";
  paths?: MaskPoint[][];
};

export type StoredLayerMasks = Partial<
  Record<"body" | "hairFront" | "hairBack" | "outfit", MaskStroke[]>
> & {
  /** Campo histórico anterior à separação das camadas de cabelo. */
  hair?: MaskStroke[];
};

export type HairAdjustmentsByBasePack = Partial<
  Record<BasePackId, Pick<Record<Category, ItemTransform>, "cabelos" | "cabelosTras">>
>;
