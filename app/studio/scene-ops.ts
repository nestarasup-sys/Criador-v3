import type { SceneBubble, SceneCharacter, SceneNarrator, SceneObject, Selection, Studio } from "./types";

export type SceneKind = Exclude<NonNullable<Selection>["kind"], never>;

export const cloneStudioValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function nextZ(studio: Studio) {
  return Math.max(
    0,
    ...studio.characters.map((item) => item.z),
    ...studio.objects.map((item) => item.z),
    ...studio.bubbles.map((item) => item.z),
    ...studio.narrators.map((item) => item.z),
  ) + 1;
}

export function formatStudioDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "data desconhecida";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function estimatedBubbleOffset(bubble: SceneBubble) {
  const charactersPerLine = Math.max(8, Math.floor(bubble.width / Math.max(8, bubble.fontSize * .55)));
  const lines = Math.max(1, Math.ceil(bubble.text.length / charactersPerLine));
  const estimatedHeight = (lines * bubble.fontSize * 1.22 + 30) * bubble.scale;
  return Math.min(.3, Math.max(.09, estimatedHeight / 1080 + .035));
}

export function updateSceneElement(studio: Studio, kind: SceneKind, id: string, patch: Record<string, unknown>): Studio {
  if (kind === "character") return { ...studio, characters: studio.characters.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneCharacter : entry) };
  if (kind === "object") return { ...studio, objects: studio.objects.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneObject : entry) };
  if (kind === "bubble") return { ...studio, bubbles: studio.bubbles.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneBubble : entry) };
  return { ...studio, narrators: studio.narrators.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneNarrator : entry) };
}

export function removeSceneElement(studio: Studio, selection: NonNullable<Selection>): Studio {
  if (selection.kind === "character") return { ...studio, characters: studio.characters.filter((entry) => entry.id !== selection.id), bubbles: studio.bubbles.filter((entry) => entry.characterInstanceId !== selection.id) };
  if (selection.kind === "object") return { ...studio, objects: studio.objects.filter((entry) => entry.id !== selection.id) };
  if (selection.kind === "bubble") return { ...studio, bubbles: studio.bubbles.filter((entry) => entry.id !== selection.id) };
  return { ...studio, narrators: studio.narrators.filter((entry) => entry.id !== selection.id) };
}

export function sceneElementZ(studio: Studio, selection: NonNullable<Selection>) {
  if (selection.kind === "character") return studio.characters.find((item) => item.id === selection.id)?.z;
  if (selection.kind === "object") return studio.objects.find((item) => item.id === selection.id)?.z;
  if (selection.kind === "bubble") return studio.bubbles.find((item) => item.id === selection.id)?.z;
  return studio.narrators.find((item) => item.id === selection.id)?.z;
}

export function duplicateSceneElement(studio: Studio, selection: NonNullable<Selection>) {
  if (selection.kind === "character") return null;
  const id = crypto.randomUUID();
  const z = nextZ(studio);
  const offset = { x: (value: number) => Math.min(.95, value + .035), y: (value: number) => Math.min(.95, value + .035) };
  if (selection.kind === "object") {
    const source = studio.objects.find((item) => item.id === selection.id);
    if (!source) return null;
    return { id, kind: selection.kind, studio: { ...studio, objects: [...studio.objects, { ...source, id, name: `${source.name} — cópia`, x: offset.x(source.x), y: offset.y(source.y), z }] } };
  }
  if (selection.kind === "bubble") {
    const source = studio.bubbles.find((item) => item.id === selection.id);
    if (!source) return null;
    return { id, kind: selection.kind, studio: { ...studio, bubbles: [...studio.bubbles, { ...source, id, x: offset.x(source.x), y: offset.y(source.y), z }] } };
  }
  const source = studio.narrators.find((item) => item.id === selection.id);
  if (!source) return null;
  return { id, kind: selection.kind, studio: { ...studio, narrators: [...studio.narrators, { ...source, id, x: offset.x(source.x), y: offset.y(source.y), z }] } };
}
