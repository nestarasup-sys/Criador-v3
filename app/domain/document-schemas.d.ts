import type { Character } from "./character-contract";
import type { PersistedAppState } from "./studio-contract";
import type { RoteirosState } from "./roteiro-contract";

export type ParseResult<T> = { success: boolean; data: T; issues: string[] };
export function normalizeCharacterDocument(value: unknown): Character;
export function emptyAppState(): PersistedAppState;
export function normalizeAppState(value: unknown): PersistedAppState;
export function emptyRoteirosState(): RoteirosState;
export function normalizeRoteirosState(value: unknown): RoteirosState;
export function validateAppState(value: unknown): string[];
export function validateRoteirosState(value: unknown): string[];
export function validateRoteiroExportDocument(value: unknown): string[];
export function parseAppState(value: unknown): ParseResult<PersistedAppState>;
export function parseRoteirosState(value: unknown): ParseResult<RoteirosState>;
