import type { ColorLabMasks } from "../types";

export type AutomaticAnalysis = {
  masks: ColorLabMasks;
  confidence: Record<keyof ColorLabMasks, number>;
  warnings: string[];
};

export type AnalysisRequest = {
  id: number;
  imageData: ImageData;
};

export interface ColorAnalysisEngine {
  analyze(imageData: ImageData): Promise<AutomaticAnalysis>;
  cancel(): void;
  dispose(): void;
}

