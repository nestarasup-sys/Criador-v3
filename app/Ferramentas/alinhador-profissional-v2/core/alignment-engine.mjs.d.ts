export type Landmark = { name: string; x: number; y: number; weight?: number; enabled?: boolean; kind?: "structural" | "detail" };
export type AlignmentResult = { a: number; b: number; c: number; d: number; tx: number; ty: number; scale: number; scaleX: number; scaleY: number; rotation: number; rms: number; max: number; errors: Array<{ name: string; kind: string; distance: number; source?: Landmark; target?: Landmark }> };
export const STRUCTURAL_LANDMARKS: string[];
export function solveWeightedSimilarity(source: Landmark[], target: Landmark[]): AlignmentResult;
export function solveAlignment(source: Landmark[], target: Landmark[], mode?: "rigid" | "similarity" | "affine"): AlignmentResult;
export function applyTransform(point: Pick<Landmark, "x" | "y">, transform: Pick<AlignmentResult, "a" | "b" | "tx" | "ty"> & Partial<Pick<AlignmentResult, "c" | "d">>): { x: number; y: number };
export function invertTransform(transform: Pick<AlignmentResult, "a" | "b" | "tx" | "ty"> & Partial<Pick<AlignmentResult, "c" | "d">>): { a: number; b: number; c: number; d: number; tx: number; ty: number };
export function localSourceAt(targetPoint: { x: number; y: number }, sourcePoints: Landmark[], targetPoints: Landmark[], radius?: number): { x: number; y: number };
