import type { EditorCharacterState, EditorProject, EditorTimelineEvent } from "./types";
import { eventAtTime, relativeTime, type ResolvedTimelineEvent, type TimelineResolution } from "./timeline";

export type RuntimeCharacterState = EditorCharacterState & {
  id: string;
  name: string;
  expression: string;
  pose: string;
  variant: number;
  visible: boolean;
  talking: boolean;
  thinking: boolean;
  blink: boolean;
  talkFrame: number;
  warnings: string[];
};

export type RuntimeSnapshot = {
  time: number;
  duration: number;
  characters: Record<string, RuntimeCharacterState>;
  activeEvent?: ResolvedTimelineEvent;
  activeVideo?: { path: string; time: number; duration: number; hold: boolean };
  bubbles: Array<{ type: "dialogue" | "thought"; character: string; text: string; englishText?: string; relativeTime: number }>;
  warnings: string[];
};

function canonical(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function eventAffects(event: EditorTimelineEvent, characterId: string) {
  if (event.type === "dialogue" || event.type === "thought" || event.type === "visibility") return event.character === characterId;
  if (event.type === "state") return event.character === characterId || event.affects.includes(characterId);
  if (event.type === "reaction" || event.type === "group_reaction") return event.affects.length === 0 || event.affects.includes(characterId) || Object.prototype.hasOwnProperty.call(event.expressionMap, characterId);
  return false;
}

function applyPersistentEvent(state: RuntimeCharacterState, event: EditorTimelineEvent) {
  if (event.type === "state") {
    if (event.expression) state.expression = event.expression;
    if (typeof event.variant === "number") state.variant = event.variant;
  } else if (event.type === "visibility") state.visible = event.visible;
  else if (event.type === "reaction" || event.type === "group_reaction") {
    const expression = event.expressionMap[state.id] ?? event.expression;
    if (expression) state.expression = expression;
  }
}

function createCharacterState(project: EditorProject, id: string): RuntimeCharacterState {
  const character = project.characters[id];
  const initial = project.initialState[id] ?? {};
  return {
    id,
    name: character.name,
    expression: canonical(initial.expression, character.defaultExpression),
    pose: canonical(initial.pose, character.defaultPose),
    variant: typeof initial.variant === "number" ? initial.variant : 1,
    visible: initial.visible !== false,
    talking: false,
    thinking: false,
    blink: false,
    talkFrame: 0,
    extensions: { ...initial.extensions },
    warnings: [],
  };
}

function activeText(event: EditorTimelineEvent, time: number) {
  if (event.type !== "dialogue" && event.type !== "thought") return undefined;
  const text = event.pt ?? event.text;
  if (!text) return undefined;
  return { type: event.type, character: event.character, text, ...(event.en ? { englishText: event.en } : {}), relativeTime: time } as const;
}

/** Calcula um snapshot puro e reproduzível para qualquer instante da timeline. */
export function evaluateScene(project: EditorProject, timeline: TimelineResolution, time: number): RuntimeSnapshot {
  const wanted = Math.max(0, Math.min(timeline.duration, time));
  const characters = Object.fromEntries(Object.keys(project.characters).map((id) => [id, createCharacterState(project, id)]));
  const warnings = [...timeline.warnings];

  for (const item of timeline.events) {
    if (item.start > wanted) break;
    for (const state of Object.values(characters)) {
      if (item.event.type === "dialogue" || item.event.type === "thought") continue;
      if (eventAffects(item.event, state.id)) applyPersistentEvent(state, item.event);
    }
  }

  const active = eventAtTime(timeline, wanted);
  const bubbles: RuntimeSnapshot["bubbles"] = [];
  let activeVideo: RuntimeSnapshot["activeVideo"];
  if (active) {
    const local = relativeTime(active, wanted);
    const text = activeText(active.event, local);
    if (text) bubbles.push(text);
    if (active.event.type === "video") activeVideo = { path: active.event.media.path, time: (active.localVideoStart ?? 0) + local, duration: active.duration, hold: active.event.holdVideoFrame };
    for (const state of Object.values(characters)) {
      state.talking = active.event.type === "dialogue" && active.event.character === state.id;
      state.thinking = active.event.type === "thought" && active.event.character === state.id;
      if (state.talking || state.thinking) {
        const seed = hash(`${project.settings.title}:${state.id}`);
        const character = project.characters[state.id];
        const blink = character?.poses[state.pose]?.expressions.some((expression) => expression.toLowerCase().includes("blink"));
        state.blink = Boolean(blink && ((Math.floor((wanted + seed / 100000) / 4.5) % 2) === 1));
        state.talkFrame = state.talking ? Math.floor(local / 0.18) % 3 : 0;
        if (active.event.type === "dialogue" || active.event.type === "thought") {
          if (active.event.expression) state.expression = active.event.expression;
          if (typeof active.event.variant === "number") state.variant = active.event.variant;
        }
      }
    }
  }

  // Comentários relativos ao vídeo são temporários e só aparecem no intervalo.
  if (active?.event.type === "video") {
    const local = relativeTime(active, wanted);
    for (const comment of active.event.comments) {
      if (local < comment.at || (typeof comment.duration === "number" && local >= comment.at + comment.duration)) continue;
      if (comment.pt || comment.en) bubbles.push({ type: comment.type === "thought" ? "thought" : "dialogue", character: comment.character ?? "", text: comment.pt ?? "", ...(comment.en ? { englishText: comment.en } : {}), relativeTime: local - comment.at });
    }
  }

  return { time: wanted, duration: timeline.duration, characters, ...(active ? { activeEvent: active } : {}), ...(activeVideo ? { activeVideo } : {}), bubbles, warnings };
}
