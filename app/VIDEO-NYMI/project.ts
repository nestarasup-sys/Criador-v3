export type VideoAsset = {
  id: string;
  name: string;
  type: "image";
  src: string;
};

export type VideoKeyframe = {
  time: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

export type VideoLayer = {
  id: string;
  name: string;
  type: "image" | "text";
  assetId?: string;
  text?: string;
  color?: string;
  start: number;
  end: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  keyframes?: VideoKeyframe[];
};

export type VideoProject = {
  nymiVideo: 1;
  name: string;
  canvas: { width: number; height: number; background: string };
  timeline: { fps: number; duration: number };
  assets: VideoAsset[];
  layers: VideoLayer[];
};

export const DEMO_PROJECT: VideoProject = {
  nymiVideo: 1,
  name: "Minha primeira cena",
  canvas: { width: 1920, height: 1080, background: "#17151f" },
  timeline: { fps: 30, duration: 8 },
  assets: [],
  layers: [
    { id: "title", name: "Título", type: "text", text: "Video Nymi", color: "#ffffff", start: 0, end: 8, x: 640, y: 210, scale: 1, rotation: 0, opacity: 1 },
    { id: "subtitle", name: "Legenda", type: "text", text: "Uma cena criada por JSON", color: "#c9b8ff", start: 0.7, end: 8, x: 640, y: 290, scale: 1, rotation: 0, opacity: 1 },
  ],
};

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeProject(input: unknown): VideoProject {
  const source = input && typeof input === "object" ? input as Partial<VideoProject> : {};
  const canvas = source.canvas && typeof source.canvas === "object" ? source.canvas as Partial<VideoProject["canvas"]> : {};
  const timeline = source.timeline && typeof source.timeline === "object" ? source.timeline as Partial<VideoProject["timeline"]> : {};
  const assets = Array.isArray(source.assets) ? source.assets : [];
  const layers = Array.isArray(source.layers) ? source.layers : [];
  const duration = Math.max(0.1, number(timeline.duration, 8));
  return {
    nymiVideo: 1,
    name: typeof source.name === "string" && source.name.trim() ? source.name : "Projeto Video Nymi",
    canvas: {
      width: 1920,
      height: 1080,
      background: typeof canvas.background === "string" ? canvas.background : "#17151f",
    },
    timeline: { fps: Math.max(1, number(timeline.fps, 30)), duration },
    assets: assets.filter((asset): asset is VideoAsset => Boolean(asset && typeof asset === "object" && typeof (asset as VideoAsset).id === "string" && typeof (asset as VideoAsset).src === "string")).map((asset) => ({ id: asset.id, name: asset.name || asset.id, type: "image", src: asset.src })),
    layers: layers.filter((layer): layer is VideoLayer => Boolean(layer && typeof layer === "object" && typeof (layer as VideoLayer).id === "string")).map((layer) => ({
      id: layer.id,
      name: layer.name || layer.id,
      type: layer.type === "text" ? "text" : "image",
      assetId: layer.assetId,
      text: layer.text,
      color: layer.color || "#ffffff",
      start: Math.max(0, number(layer.start, 0)),
      end: Math.min(duration, Math.max(0.1, number(layer.end, duration))),
      x: number(layer.x, 640), y: number(layer.y, 360), scale: Math.max(0.01, number(layer.scale, 1)), rotation: number(layer.rotation, 0), opacity: Math.max(0, Math.min(1, number(layer.opacity, 1))),
      keyframes: Array.isArray(layer.keyframes) ? layer.keyframes.map((frame) => ({ time: number(frame.time, 0), x: number(frame.x, number(layer.x, 640)), y: number(frame.y, number(layer.y, 360)), scale: number(frame.scale, number(layer.scale, 1)), rotation: number(frame.rotation, number(layer.rotation, 0)), opacity: number(frame.opacity, number(layer.opacity, 1)) })) : undefined,
    })),
  };
}

export function projectAtTime(project: VideoProject, layer: VideoLayer, time: number) {
  const frames = [...(layer.keyframes || [])].sort((a, b) => a.time - b.time);
  if (!frames.length) return { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity };
  const next = frames.find((frame) => frame.time >= time);
  const previous = [...frames].reverse().find((frame) => frame.time <= time);
  if (!previous) return frames[0];
  if (!next || next.time === previous.time) return previous;
  const ratio = (time - previous.time) / (next.time - previous.time);
  const mix = (a: number, b: number) => a + (b - a) * ratio;
  return { x: mix(previous.x, next.x), y: mix(previous.y, next.y), scale: mix(previous.scale, next.scale), rotation: mix(previous.rotation, next.rotation), opacity: mix(previous.opacity, next.opacity) };
}
