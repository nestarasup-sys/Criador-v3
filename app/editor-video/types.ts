/** Contratos da primeira fase do Editor de vídeo.
 *
 * Estes tipos são independentes de React, Canvas e Node para que timeline,
 * runtime e validação possam ser testados sem interface.
 */

export const EDITOR_PROJECT_SCHEMA_VERSION = 1 as const;
export type EditorProjectSchemaVersion = typeof EDITOR_PROJECT_SCHEMA_VERSION;

export type EditorResolution = readonly [number, number];
export type EditorExtensions = Record<string, unknown>;

export type EditorTransform = {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchor: "bottom_center" | "center" | "top_left" | string;
  layer: number;
  flipX: boolean;
};

export type EditorChromaKey = {
  enabled: boolean;
  color: string;
  tolerance: number;
  feather: number;
  despill: boolean;
};

export type EditorPose = {
  id: string;
  label: string;
  expressions: string[];
  defaultExpression?: string;
  extensions: EditorExtensions;
};

export type EditorCharacter = {
  id: string;
  name: string;
  assetDir: string;
  poses: Record<string, EditorPose>;
  defaultPose: string;
  defaultExpression: string;
  transform: EditorTransform;
  chromaKey: EditorChromaKey;
  autoTrim: boolean;
  trimPadding: number;
  extensions: EditorExtensions;
};

export type EditorMediaReference = {
  path: string;
  clipStart: number;
  clipEnd?: number;
  includeAudio: boolean;
  extensions: EditorExtensions;
};

export type EditorBubble = {
  text: string;
  englishText?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  extensions: EditorExtensions;
};

export type EditorVideoComment = {
  at: number;
  duration?: number;
  type: "dialogue" | "thought" | "reaction" | "state" | "visibility" | string;
  character?: string;
  expression?: string;
  pt?: string;
  en?: string;
  bubble?: EditorBubble;
  payload: EditorExtensions;
};

export type EditorEventType =
  | "pause"
  | "beat"
  | "dialogue"
  | "thought"
  | "state"
  | "visibility"
  | "reaction"
  | "group_reaction"
  | "video"
  | "unknown";

export type EditorTimelineEventBase = {
  id: string;
  type: EditorEventType;
  start?: number;
  duration: number | "auto";
  requestedStart?: number;
  extensions: EditorExtensions;
};

export type EditorDialogueEvent = EditorTimelineEventBase & {
  type: "dialogue";
  character: string;
  expression?: string;
  variant?: number;
  pt?: string;
  en?: string;
  text?: string;
  affects: string[];
  bubble?: EditorBubble;
};

export type EditorThoughtEvent = EditorTimelineEventBase & {
  type: "thought";
  character: string;
  expression?: string;
  variant?: number;
  pt?: string;
  en?: string;
  text?: string;
  affects: string[];
  bubble?: EditorBubble;
};

export type EditorVideoEvent = EditorTimelineEventBase & {
  type: "video";
  media: EditorMediaReference;
  layout?: { x?: number; y?: number; width?: number; height?: number; fit?: "cover" | "contain" | "stretch" | string };
  comments: EditorVideoComment[];
  holdVideoFrame: boolean;
};

export type EditorStateEvent = EditorTimelineEventBase & {
  type: "state";
  character?: string;
  expression?: string;
  variant?: number;
  affects: string[];
};

export type EditorVisibilityEvent = EditorTimelineEventBase & {
  type: "visibility";
  character: string;
  visible: boolean;
};

export type EditorReactionEvent = EditorTimelineEventBase & {
  type: "reaction" | "group_reaction";
  expression?: string;
  affects: string[];
  expressionMap: Record<string, string>;
  stagger: number;
};

export type EditorBasicEvent = EditorTimelineEventBase & {
  type: "pause" | "beat" | "unknown";
  label?: string;
  raw?: EditorExtensions;
};

export type EditorTimelineEvent =
  | EditorDialogueEvent
  | EditorThoughtEvent
  | EditorVideoEvent
  | EditorStateEvent
  | EditorVisibilityEvent
  | EditorReactionEvent
  | EditorBasicEvent;

export type EditorCharacterState = {
  expression?: string;
  pose?: string;
  variant?: number;
  visible?: boolean;
  extensions: EditorExtensions;
};

export type EditorProjectSettings = {
  title: string;
  resolution: EditorResolution;
  fps: number;
  background?: string;
  output?: string;
  preserveOthers: boolean;
  variantMode: "hold" | "cycle" | string;
  blinkBehavior: EditorExtensions;
  talkBehavior: EditorExtensions;
  thoughtBehavior: EditorExtensions;
  extensions: EditorExtensions;
};

export type EditorProject = {
  schemaVersion: EditorProjectSchemaVersion;
  sourcePath?: string;
  rootDir?: string;
  settings: EditorProjectSettings;
  characters: Record<string, EditorCharacter>;
  initialState: Record<string, EditorCharacterState>;
  timeline: EditorTimelineEvent[];
  extensions: EditorExtensions;
};

export type EditorParseIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type EditorParseResult = {
  success: boolean;
  project: EditorProject;
  issues: EditorParseIssue[];
};
