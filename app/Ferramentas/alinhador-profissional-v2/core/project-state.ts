import type { V2Head } from "./image-pipeline";

export type V2Project = {
  projectVersion: 2;
  kind: "alinhador-profissional-v2";
  createdAt: string;
  updatedAt: string;
  referenceId: string;
  selectedId: string;
  settings: { alignmentMode: "rigid" | "similarity" | "affine"; localStrength: number; opacity: number; zoom: number; viewMode: "result" | "onion" | "difference" };
  heads: V2Head[];
};

export function createProject(heads: V2Head[], referenceId: string, selectedId: string, settings: V2Project["settings"]): V2Project {
  const now = new Date().toISOString();
  return { projectVersion: 2, kind: "alinhador-profissional-v2", createdAt: now, updatedAt: now, referenceId, selectedId, settings, heads };
}

export function serializeProject(project: V2Project) {
  return `${JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2)}\n`;
}

export function parseProject(raw: string): V2Project {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Projeto inválido.");
  const project = value as Partial<V2Project>;
  if (project.kind !== "alinhador-profissional-v2" || project.projectVersion !== 2 || !Array.isArray(project.heads)) throw new Error("Este arquivo não é um projeto válido da V2.");
  if (project.heads.some((head) => !head || typeof head !== "object" || typeof head.id !== "string" || typeof head.sourceUrl !== "string" || !Array.isArray(head.landmarks))) throw new Error("O projeto contém uma cabeça incompleta.");
  return project as V2Project;
}
