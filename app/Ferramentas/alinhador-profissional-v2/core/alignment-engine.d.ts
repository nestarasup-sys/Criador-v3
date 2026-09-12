export type Landmark = { name: string; x: number; y: number; weight?: number; enabled?: boolean; kind?: "structural" | "detail" };
export type SimilarityTransform = { a: number; b: number; c: number; d: number; tx: number; ty: number; scale: number; scaleX: number; scaleY: number; rotation: number; rms: number; max: number; errors: Array<{ name: string; kind: string; distance: number }> };
export const STRUCTURAL_LANDMARKS: string[];
export function solveWeightedSimilarity(source: Landmark[], target: Landmark[]): SimilarityTransform;
export function solveAlignment(source: Landmark[], target: Landmark[], mode?: "rigid" | "similarity" | "affine"): SimilarityTransform;
export function applyTransform(point: Pick<Landmark, "x" | "y">, transform: Pick<SimilarityTransform, "a" | "b" | "tx" | "ty"> & Partial<Pick<SimilarityTransform, "c" | "d">>): { x: number; y: number };
export function invertTransform(transform: Pick<SimilarityTransform, "a" | "b" | "tx" | "ty"> & Partial<Pick<SimilarityTransform, "c" | "d">>): { a: number; b: number; c: number; d: number; tx: number; ty: number };
export function localSourceAt(targetPoint: { x: number; y: number }, sourcePoints: Landmark[], targetPoints: Landmark[], radius?: number): { x: number; y: number };
