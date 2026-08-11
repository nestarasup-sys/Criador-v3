import type { EditorProject, EditorTimelineEvent } from "./types";
import type { TimelineResolution } from "./timeline";

export type EditorValidationIssue = { severity: "error" | "warning"; path: string; message: string; code: string };

function issue(severity: EditorValidationIssue["severity"], path: string, message: string, code: string): EditorValidationIssue { return { severity, path, message, code }; }

function checkEvent(event: EditorTimelineEvent, index: number, project: EditorProject) {
  const issues: EditorValidationIssue[] = [];
  if (event.type === "dialogue" || event.type === "thought" || event.type === "visibility" || event.type === "state") {
    if (!event.character || !project.characters[event.character]) issues.push(issue("error", `timeline.${index}.character`, `Personagem não encontrado: ${event.character || "vazio"}.`, "CHARACTER_MISSING"));
  }
  if (event.type === "video" && !event.media.path) issues.push(issue("error", `timeline.${index}.media.path`, "Vídeo sem caminho.", "VIDEO_PATH_MISSING"));
  if (event.type === "dialogue" && !event.pt && !event.text) issues.push(issue("warning", `timeline.${index}.pt`, "Fala sem texto em português.", "TEXT_EMPTY"));
  if (event.type === "thought" && !event.pt && !event.text) issues.push(issue("warning", `timeline.${index}.pt`, "Pensamento sem texto em português.", "TEXT_EMPTY"));
  if (event.type === "unknown") issues.push(issue("warning", `timeline.${index}`, "Evento desconhecido foi preservado, mas não será renderizado.", "EVENT_UNKNOWN"));
  return issues;
}

export function validateEditorProject(project: EditorProject, timeline?: TimelineResolution) {
  const issues: EditorValidationIssue[] = [];
  if (project.settings.resolution[0] < 1 || project.settings.resolution[1] < 1) issues.push(issue("error", "settings.resolution", "Resolução inválida.", "RESOLUTION_INVALID"));
  if (project.settings.fps < 1 || project.settings.fps > 120) issues.push(issue("error", "settings.fps", "FPS deve estar entre 1 e 120.", "FPS_INVALID"));
  Object.entries(project.characters).forEach(([id, character]) => {
    if (!character.assetDir) issues.push(issue("warning", `characters.${id}.assetDir`, "Personagem sem pasta de assets.", "ASSET_DIR_MISSING"));
    if (!Object.keys(character.poses).length) issues.push(issue("warning", `characters.${id}.poses`, "Personagem sem poses reconhecidas.", "POSES_EMPTY"));
  });
  project.timeline.forEach((event, index) => issues.push(...checkEvent(event, index, project)));
  for (const warning of timeline?.warnings ?? []) issues.push(issue("warning", "timeline", warning, "TIMELINE_WARNING"));
  return { valid: !issues.some((item) => item.severity === "error"), issues };
}
