export type BasePackId = string;
export { CATEGORIES, FACE_MODES, MODELS, isCategory, isModel } from "./character-values.mjs";
export type Model = "feminino" | "masculino";
export type Category = "cabelos" | "cabelosTras" | "rostos" | "roupas";
export type FaceMode = "base" | "single" | "pack";

export type HeadContourWarpKnot = {
  /** Linha de destino no canvas nativo da roupa, antes do transform global. */
  y: number;
  /** Linha da imagem original usada nas faixas externas da cabeça. */
  sourceY: number;
  sourceLeft: number;
  sourceRight: number;
  targetLeft: number;
  targetRight: number;
  strength: number;
};

export type HeadContourWarp = {
  version: 1;
  top: number;
  bottom: number;
  confidence: number;
  baselineError: number;
  candidateError: number;
  improvement: number;
  maxDisplacement: number;
  knots: HeadContourWarpKnot[];
};

export type ItemTransform = {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipX: boolean;
  /** Correção local e não destrutiva da cabeça incluída na roupa. */
  headWarp?: HeadContourWarp;
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
