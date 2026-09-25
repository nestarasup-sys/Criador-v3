import type { BaseDadosState, BaseDadosVideo } from "./types";

export const BASE_DADOS_DRAFT_STORAGE_KEY = "nymi-base-dados-drafts-v2";

export type BaseDadosDraft = {
  description: string;
  sceneEndSeconds: string;
  firstGroupReactionSeconds?: string;
  firstGroupReactionSpeechCount?: string;
  secondGroupReactionSeconds?: string;
  secondGroupReactionSpeechCount?: string;
  additionalAiContext?: string;
  category?: string;
  /** Revision from which this browser recovery draft was created. */
  baseRevision?: number;
  changedAt: number;
};

export type BaseDadosDrafts = Record<string, BaseDadosDraft>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readBaseDadosDrafts(storage: StorageLike | null | undefined): BaseDadosDrafts {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(BASE_DADOS_DRAFT_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      if (!value || typeof value !== "object") return [];
      const draft = value as Partial<BaseDadosDraft>;
      if (typeof draft.description !== "string" || typeof draft.sceneEndSeconds !== "string") return [];
      const changedAt = Number(draft.changedAt);
      const baseRevision = Number(draft.baseRevision);
      return [[id, { description: draft.description, sceneEndSeconds: draft.sceneEndSeconds, ...(typeof draft.firstGroupReactionSeconds === "string" ? { firstGroupReactionSeconds: draft.firstGroupReactionSeconds } : {}), ...(typeof draft.firstGroupReactionSpeechCount === "string" ? { firstGroupReactionSpeechCount: draft.firstGroupReactionSpeechCount } : {}), ...(typeof draft.secondGroupReactionSeconds === "string" ? { secondGroupReactionSeconds: draft.secondGroupReactionSeconds } : {}), ...(typeof draft.secondGroupReactionSpeechCount === "string" ? { secondGroupReactionSpeechCount: draft.secondGroupReactionSpeechCount } : {}), ...(typeof draft.additionalAiContext === "string" ? { additionalAiContext: draft.additionalAiContext } : {}), ...(typeof draft.category === "string" ? { category: draft.category } : {}), ...(Number.isInteger(baseRevision) && baseRevision >= 0 ? { baseRevision } : {}), changedAt: Number.isFinite(changedAt) ? changedAt : 0 } satisfies BaseDadosDraft]];
    }));
  } catch {
    return {};
  }
}

export function writeBaseDadosDrafts(storage: StorageLike | null | undefined, drafts: BaseDadosDrafts) {
  if (!storage) return false;
  try {
    if (Object.keys(drafts).length) storage.setItem(BASE_DADOS_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    else storage.removeItem(BASE_DADOS_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    // The server save may still succeed, but callers must be able to show
    // that the browser recovery copy was not created.
    return false;
  }
}

export function draftDiffersFromVideo(draft: BaseDadosDraft, video: BaseDadosVideo) {
  const draftEnd = Number(draft.sceneEndSeconds);
  const draftGroupStart = draft.firstGroupReactionSeconds === undefined ? video.firstGroupReactionSeconds : Number(draft.firstGroupReactionSeconds);
  const draftFirstSpeechCount = draft.firstGroupReactionSpeechCount === undefined ? (video.firstGroupReactionSpeechCount ?? 0) : Number(draft.firstGroupReactionSpeechCount);
  const draftSecondGroupStart = draft.secondGroupReactionSeconds === undefined ? video.secondGroupReactionSeconds : Number(draft.secondGroupReactionSeconds);
  const draftSecondSpeechCount = draft.secondGroupReactionSpeechCount === undefined ? (video.secondGroupReactionSpeechCount ?? 0) : Number(draft.secondGroupReactionSpeechCount);
  const draftContext = draft.additionalAiContext === undefined ? video.additionalAiContext : draft.additionalAiContext;
  const draftCategory = draft.category === undefined ? video.category : draft.category;
  return draft.description !== video.description || !Number.isFinite(draftEnd) || draftEnd !== video.sceneEndSeconds || !Number.isFinite(draftGroupStart) || draftGroupStart !== video.firstGroupReactionSeconds || !Number.isInteger(draftFirstSpeechCount) || draftFirstSpeechCount !== (video.firstGroupReactionSpeechCount ?? 0) || !Number.isFinite(draftSecondGroupStart) || draftSecondGroupStart !== video.secondGroupReactionSeconds || !Number.isInteger(draftSecondSpeechCount) || draftSecondSpeechCount !== (video.secondGroupReactionSpeechCount ?? 0) || draftContext !== video.additionalAiContext || draftCategory !== video.category;
}

export function recoverBaseDadosDrafts(database: BaseDadosState, drafts: BaseDadosDrafts): BaseDadosDrafts {
  const videos = new Map(database.videos.map((video) => [video.id, video]));
  return Object.fromEntries(Object.entries(drafts).filter(([id, draft]) => {
    const video = videos.get(id);
    if (!video) return false;
    // A draft created against an older server revision must not overwrite a
    // confirmed update made from Roteiros or another browser. Legacy drafts
    // without baseRevision remain recoverable for backward compatibility.
    if (draft.baseRevision !== undefined && draft.baseRevision !== Number(video.metadataRevision ?? 0)) return false;
    return draftDiffersFromVideo(draft, video);
  }));
}
