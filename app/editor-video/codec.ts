import {
  EDITOR_PROJECT_SCHEMA_VERSION,
  type EditorBasicEvent,
  type EditorBubble,
  type EditorCharacter,
  type EditorCharacterState,
  type EditorChromaKey,
  type EditorDialogueEvent,
  type EditorEventType,
  type EditorExtensions,
  type EditorMediaReference,
  type EditorParseIssue,
  type EditorParseResult,
  type EditorProject,
  type EditorProjectSettings,
  type EditorReactionEvent,
  type EditorStateEvent,
  type EditorTimelineEvent,
  type EditorTimelineEventBase,
  type EditorThoughtEvent,
  type EditorTransform,
  type EditorVideoComment,
  type EditorVideoEvent,
} from "./types";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number) {
  return Math.max(0.000001, number(value, fallback));
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function extensions(source: RecordValue, known: readonly string[]): EditorExtensions {
  const knownSet = new Set(known);
  return Object.fromEntries(Object.entries(source).filter(([key]) => !knownSet.has(key)));
}

function normalizeTransform(value: unknown): EditorTransform {
  const source = record(value);
  return {
    x: number(source.x, 0), y: number(source.y, 0), scale: positive(source.scale, 1),
    scaleX: positive(source.scaleX, 1), scaleY: positive(source.scaleY, 1),
    rotation: number(source.rotation, 0), anchor: text(source.anchor, "bottom_center"),
    layer: Math.round(number(source.layer ?? source.z_index, 0)), flipX: boolean(source.flipX ?? source.flip_x, false),
  };
}

function normalizeChroma(value: unknown): EditorChromaKey {
  const source = record(value);
  return { enabled: boolean(source.enabled, false), color: text(source.color, "#00ff00"), tolerance: Math.max(0, number(source.tolerance, 40)), feather: Math.max(0, number(source.feather, 0)), despill: boolean(source.despill, true) };
}

function normalizeBubble(value: unknown): EditorBubble | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = record(value);
  return {
    text: text(source.text), ...(typeof source.englishText === "string" ? { englishText: source.englishText } : {}),
    ...(typeof source.x === "number" ? { x: source.x } : {}), ...(typeof source.y === "number" ? { y: source.y } : {}),
    ...(typeof source.width === "number" ? { width: source.width } : {}), ...(typeof source.height === "number" ? { height: source.height } : {}),
    extensions: extensions(source, ["text", "englishText", "x", "y", "width", "height"]),
  };
}

function normalizeMedia(value: unknown): EditorMediaReference {
  const source = record(value);
  return { path: text(source.path), clipStart: Math.max(0, number(source.clipStart ?? source.start_time, 0)), ...(typeof source.clipEnd === "number" ? { clipEnd: Math.max(0, source.clipEnd) } : {}), includeAudio: boolean(source.includeAudio ?? source.audio, true), extensions: extensions(source, ["path", "clipStart", "clipEnd", "start_time", "includeAudio", "audio"]) };
}

function normalizeComment(value: unknown): EditorVideoComment {
  const source = record(value);
  const type = text(source.type, "dialogue") as EditorVideoComment["type"];
  return { at: Math.max(0, number(source.at ?? source.time, 0)), ...(typeof source.duration === "number" ? { duration: Math.max(0, source.duration) } : {}), type, ...(typeof source.character === "string" ? { character: source.character } : {}), ...(typeof source.expression === "string" ? { expression: source.expression } : {}), ...(typeof source.pt === "string" ? { pt: source.pt } : {}), ...(typeof source.en === "string" ? { en: source.en } : {}), ...(normalizeBubble(source.bubble) ? { bubble: normalizeBubble(source.bubble) } : {}), payload: source };
}

function eventBase(source: RecordValue, type: EditorEventType): EditorTimelineEventBase {
  const duration = source.duration === "auto" ? "auto" : Math.max(0, number(source.duration, 0));
  return { id: text(source.id, `event-${type}-${Math.random().toString(16).slice(2)}`), type, ...(typeof source.start === "number" ? { start: Math.max(0, source.start) } : {}), duration, ...(typeof source.requested_start === "number" ? { requestedStart: Math.max(0, source.requested_start) } : {}), extensions: extensions(source, ["id", "type", "start", "requested_start", "duration"]) };
}

function normalizeEvent(value: unknown, index: number): EditorTimelineEvent {
  const source = record(value);
  const rawType = text(source.type, "unknown");
  if (rawType === "dialogue" || rawType === "thought") {
    const base = eventBase(source, rawType);
    const common = { ...base, character: text(source.character), ...(typeof source.expression === "string" ? { expression: source.expression } : {}), ...(typeof source.variant === "number" ? { variant: source.variant } : {}), ...(typeof source.pt === "string" ? { pt: source.pt } : {}), ...(typeof source.en === "string" ? { en: source.en } : {}), ...(typeof source.text === "string" ? { text: source.text } : {}), affects: list(source.affects).filter((item): item is string => typeof item === "string"), ...(normalizeBubble(source.bubble) ? { bubble: normalizeBubble(source.bubble) } : {}) };
    return common as EditorDialogueEvent | EditorThoughtEvent;
  }
  if (rawType === "video") {
    const base = eventBase(source, "video");
    return { ...base, type: "video", media: normalizeMedia(source.media ?? source), layout: record(source.layout) as EditorVideoEvent["layout"], comments: list(source.comments).map(normalizeComment), holdVideoFrame: boolean(source.hold_video_frame ?? source.keep_video_on_screen, false) };
  }
  if (rawType === "state" || rawType === "expression" || rawType === "set_expression") {
    const base = eventBase(source, "state");
    return { ...base, character: typeof source.character === "string" ? source.character : undefined, expression: typeof source.expression === "string" ? source.expression : text(source.state, "") || undefined, ...(typeof source.variant === "number" ? { variant: source.variant } : {}), affects: list(source.affects).filter((item): item is string => typeof item === "string") } as EditorStateEvent;
  }
  if (rawType === "visibility") return { ...eventBase(source, "visibility"), type: "visibility", character: text(source.character), visible: boolean(source.visible, true) };
  if (rawType === "reaction" || rawType === "group_reaction") return { ...eventBase(source, rawType), expression: typeof source.expression === "string" ? source.expression : undefined, affects: list(source.affects).filter((item): item is string => typeof item === "string"), expressionMap: record(source.expression_map ?? source.characters) as Record<string, string>, stagger: Math.max(0, number(source.stagger, 0)) } as EditorReactionEvent;
  const type = rawType === "pause" || rawType === "beat" ? rawType : "unknown";
  const basic = { ...eventBase(source, type), ...(typeof source.label === "string" ? { label: source.label } : {}), raw: source } as EditorBasicEvent;
  if (rawType !== type) basic.extensions = { ...basic.extensions, originalType: rawType, sourceIndex: index };
  return basic;
}

function normalizeCharacter(id: string, value: unknown): EditorCharacter {
  const source = record(value);
  const poses = Object.fromEntries(Object.entries(record(source.poses)).map(([poseId, poseValue]) => {
    const pose = record(poseValue);
    return [poseId, { id: text(pose.id, poseId), label: text(pose.label, poseId), expressions: list(pose.expressions).filter((item): item is string => typeof item === "string"), ...(typeof pose.defaultExpression === "string" ? { defaultExpression: pose.defaultExpression } : {}), extensions: extensions(pose, ["id", "label", "expressions", "defaultExpression"]) }];
  }));
  return { id: text(source.id, id), name: text(source.name, id), assetDir: text(source.assetDir ?? source.asset_dir), poses, defaultPose: text(source.defaultPose ?? source.default_pose, Object.keys(poses)[0] ?? "default"), defaultExpression: text(source.defaultExpression ?? source.default_expression, "normal"), transform: normalizeTransform(source.transform ?? source), chromaKey: normalizeChroma(source.chromaKey ?? source.chroma_key), autoTrim: boolean(source.autoTrim ?? source.auto_trim, true), trimPadding: Math.max(0, number(source.trimPadding ?? source.trim_padding, 12)), extensions: extensions(source, ["id", "name", "assetDir", "asset_dir", "poses", "defaultPose", "default_pose", "defaultExpression", "default_expression", "transform", "chromaKey", "chroma_key", "autoTrim", "auto_trim", "trimPadding", "trim_padding", "x", "y", "scale", "scaleX", "scaleY", "rotation", "anchor", "layer", "z_index", "flipX", "flip_x"]) };
}

function normalizeSettings(value: unknown): EditorProjectSettings {
  const source = record(value);
  const resolution = Array.isArray(source.resolution) && source.resolution.length >= 2 ? [Math.max(1, Math.round(number(source.resolution[0], 1920))), Math.max(1, Math.round(number(source.resolution[1], 1080)))] as const : [1920, 1080] as const;
  return { title: text(source.title, "Editor de vídeo"), resolution, fps: Math.max(1, Math.round(number(source.fps, 30))), ...(typeof source.background === "string" ? { background: source.background } : {}), ...(typeof source.output === "string" ? { output: source.output } : {}), preserveOthers: boolean(source.preserveOthers ?? source.preserve_others, true), variantMode: text(source.variantMode ?? source.variant_mode, "hold") as EditorProjectSettings["variantMode"], blinkBehavior: record(source.blinkBehavior ?? source.blink_behavior), talkBehavior: record(source.talkBehavior ?? source.talk_behavior), thoughtBehavior: record(source.thoughtBehavior ?? source.thought_behavior), extensions: extensions(source, ["title", "resolution", "fps", "background", "output", "preserveOthers", "preserve_others", "variantMode", "variant_mode", "blinkBehavior", "blink_behavior", "talkBehavior", "talk_behavior", "thoughtBehavior", "thought_behavior"]) };
}

export function normalizeEditorProject(value: unknown): EditorProject {
  const source = record(value);
  const project = record(source.project ?? value);
  const charactersSource = record(project.characters);
  const characters = Object.fromEntries(Object.entries(charactersSource).map(([id, character]) => [id, normalizeCharacter(id, character)]));
  const stateSource = record(project.initial_state ?? project.initialState);
  const initialState = Object.fromEntries(Object.entries(stateSource).map(([id, state]) => [id, { ...record(state), ...(typeof record(state).expression === "string" ? { expression: record(state).expression } : {}), ...(typeof record(state).pose === "string" ? { pose: record(state).pose } : {}), ...(typeof record(state).variant === "number" ? { variant: record(state).variant } : {}), ...(typeof record(state).visible === "boolean" ? { visible: record(state).visible } : {}), extensions: record(state).extensions ?? {} } as EditorCharacterState]));
  const issues: EditorParseIssue[] = [];
  if (source.project === undefined && source.characters === undefined && source.timeline === undefined) issues.push({ path: "$", message: "Documento sem project, characters ou timeline.", severity: "error" });
  return { schemaVersion: EDITOR_PROJECT_SCHEMA_VERSION, ...(typeof project.sourcePath === "string" ? { sourcePath: project.sourcePath } : {}), ...(typeof project.rootDir === "string" ? { rootDir: project.rootDir } : {}), settings: normalizeSettings(project.settings ?? project), characters, initialState, timeline: list(project.timeline).map(normalizeEvent), extensions: record(project.extensions) };
}

export function parseEditorProject(value: unknown): EditorParseResult {
  const project = normalizeEditorProject(value);
  const issues: EditorParseIssue[] = [];
  if (project.timeline.some((event) => event.duration !== "auto" && event.duration < 0)) issues.push({ path: "timeline", message: "A duração não pode ser negativa.", severity: "error" });
  for (const [id, character] of Object.entries(project.characters)) {
    if (!character.assetDir) issues.push({ path: `characters.${id}.assetDir`, message: "Personagem sem pasta de assets.", severity: "warning" });
  }
  return { success: issues.every((issue) => issue.severity !== "error"), project, issues };
}
