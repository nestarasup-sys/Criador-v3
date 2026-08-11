import type { EditorProject, EditorTimelineEvent } from "./types";

export type TimelineDurationMap = Record<string, number>;

export type ResolvedTimelineEvent = {
  event: EditorTimelineEvent;
  index: number;
  start: number;
  end: number;
  duration: number;
  durationWasAuto: boolean;
  localVideoStart?: number;
  localVideoEnd?: number;
  warning?: string;
};

export type TimelineResolution = {
  events: ResolvedTimelineEvent[];
  duration: number;
  warnings: string[];
};

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function videoDuration(event: EditorTimelineEvent, durations: TimelineDurationMap) {
  if (event.type !== "video") return undefined;
  const path = event.media.path;
  const source = finite(durations[path], 3);
  const clipStart = Math.max(0, event.media.clipStart);
  const clipEnd = typeof event.media.clipEnd === "number" ? Math.max(clipStart, event.media.clipEnd) : source;
  return Math.max(0.001, clipEnd - clipStart);
}

/** Resolve o relógio uma única vez para preview, edição e exportação. */
export function resolveTimeline(project: EditorProject, durations: TimelineDurationMap = {}): TimelineResolution {
  const events: ResolvedTimelineEvent[] = [];
  const warnings: string[] = [];
  let cursor = 0;

  project.timeline.forEach((event, index) => {
    const requestedStart = typeof event.start === "number" ? Math.max(0, event.start) : cursor;
    const autoDuration = event.duration === "auto";
    let duration = autoDuration ? videoDuration(event, durations) ?? 3 : finite(event.duration, 0);
    let warning: string | undefined;
    if (autoDuration && event.type === "video" && durations[event.media.path] === undefined && event.media.clipEnd === undefined) {
      warning = `Duração estimada para o vídeo ${event.media.path}; metadados ainda não foram carregados.`;
      warnings.push(warning);
    }
    if (duration <= 0) {
      warning = `Evento ${index + 1} possui duração não positiva.`;
      warnings.push(warning);
      duration = 0.001;
    }
    const start = Math.max(cursor, requestedStart);
    const end = start + duration;
    const resolved: ResolvedTimelineEvent = { event, index, start, end, duration, durationWasAuto: autoDuration, ...(warning ? { warning } : {}) };
    if (event.type === "video") {
      const localStart = Math.max(0, event.media.clipStart);
      resolved.localVideoStart = localStart;
      resolved.localVideoEnd = localStart + duration;
    }
    events.push(resolved);
    cursor = end;
  });

  return { events, duration: cursor, warnings };
}

export function eventAtTime(timeline: TimelineResolution, time: number) {
  const wanted = Math.max(0, time);
  return timeline.events.find((item) => wanted >= item.start && wanted < item.end);
}

export function relativeTime(event: ResolvedTimelineEvent, time: number) {
  return Math.max(0, Math.min(event.duration, time - event.start));
}
