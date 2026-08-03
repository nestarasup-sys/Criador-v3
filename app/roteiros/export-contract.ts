import type { ScriptProject } from "./types";

export const ROTEIROS_EXPORT_APP = "GACHA_PREMIUM_ROTEIROS_V1" as const;
export const ROTEIROS_EXPORT_VERSION = 1 as const;

export type RoteiroExportDocument = {
  app: typeof ROTEIROS_EXPORT_APP;
  version: typeof ROTEIROS_EXPORT_VERSION;
  exportedAt: string;
  script: ScriptProject;
};

export function createRoteiroExportDocument(script: ScriptProject, exportedAt = new Date().toISOString()): RoteiroExportDocument {
  return { app: ROTEIROS_EXPORT_APP, version: ROTEIROS_EXPORT_VERSION, exportedAt, script: structuredClone(script) };
}

export function isRoteiroExportDocument(value: unknown): value is RoteiroExportDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  return document.app === ROTEIROS_EXPORT_APP && document.version === ROTEIROS_EXPORT_VERSION && Boolean(document.script && typeof document.script === "object");
}
