export type BasePackId = string;
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
};

export type MaskPoint = { x: number; y: number };

export type MaskStroke = {
  id: string;
  mode: "erase" | "restore";
  size: number;
  points: MaskPoint[];
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
