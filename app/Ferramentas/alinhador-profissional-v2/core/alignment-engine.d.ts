export type Landmark = { name: string; x: number; y: number; weight?: number; enabled?: boolean; kind?: "structural" | "detail" };
export type SimilarityTransform = { a: number; b: number; tx: number; ty: number; scale: number; rotation: number; rms: number };
export const STRUCTURAL_LANDMARKS: string[];
export function solveWeightedSimilarity(source: Landmark[], target: Landmark[]): SimilarityTransform;
export function applyTransform(point: Pick<Landmark, "x" | "y">, transform: Pick<SimilarityTransform, "a" | "b" | "tx" | "ty">): { x: number; y: number };
export function invertTransform(transform: Pick<SimilarityTransform, "a" | "b" | "tx" | "ty">): { a: number; b: number; tx: number; ty: number };
export function localSourceAt(targetPoint: { x: number; y: number }, sourcePoints: Landmark[], targetPoints: Landmark[], radius?: number): { x: number; y: number };
