import type { EditorProject } from "./types";
import type { RuntimeSnapshot } from "./runtime";

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string) {
  const existing = imageCache.get(url);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Não foi possível carregar ${url}`));
    image.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function checker(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = "#f8f6fb";
  context.fillRect(0, 0, width, height);
  const size = 32;
  context.fillStyle = "#eeeaf2";
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) if ((x / size + y / size) % 2 === 0) context.fillRect(x, y, size, size);
}

export type EditorFrameAssetResolver = (characterId: string, expression: string, pose: string, variant: number) => string | undefined;

/** Renderizador compartilhado do frame de preview; export pode reutilizar o mesmo desenho em canvas offscreen. */
export async function renderEditorFrame(canvas: HTMLCanvasElement, project: EditorProject, snapshot: RuntimeSnapshot, resolveAsset: EditorFrameAssetResolver) {
  const [width, height] = project.settings.resolution;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D indisponível.");
  checker(context, width, height);
  context.save();
  context.fillStyle = "rgba(52, 35, 77, .08)";
  context.font = "28px sans-serif";
  context.fillText(project.settings.title, 32, 46);
  context.restore();

  const entries = Object.values(snapshot.characters).filter((state) => state.visible).sort((left, right) => (project.characters[left.id]?.transform.layer ?? 0) - (project.characters[right.id]?.transform.layer ?? 0));
  for (const state of entries) {
    const character = project.characters[state.id];
    if (!character) continue;
    const url = resolveAsset(state.id, state.blink ? `${state.expression}_blink` : state.expression, state.pose, state.variant);
    const transform = character.transform;
    if (!url) {
      context.fillStyle = "#df6e9d";
      context.beginPath();
      context.arc(transform.x || width / 2, (transform.y || height / 2) - 140, 48, 0, Math.PI * 2);
      context.fill();
      context.fillRect((transform.x || width / 2) - 46, transform.y || height / 2 - 90, 92, 140);
      continue;
    }
    try {
      const image = await loadImage(url);
      const scale = Math.max(0.01, transform.scale) * Math.max(0.01, transform.scaleX);
      const scaleY = Math.max(0.01, transform.scale) * Math.max(0.01, transform.scaleY);
      const x = transform.x || width / 2;
      const y = transform.y || height;
      context.save();
      context.translate(x, y);
      context.rotate((transform.rotation * Math.PI) / 180);
      context.scale(transform.flipX ? -scale : scale, scaleY);
      context.drawImage(image, -image.width / 2, -image.height, image.width, image.height);
      context.restore();
    } catch {
      state.warnings.push(`Asset não carregado: ${url}`);
    }
  }

  for (const bubble of snapshot.bubbles) {
    const character = snapshot.characters[bubble.character];
    const x = character ? project.characters[bubble.character]?.transform.x ?? width / 2 : width / 2;
    const y = character ? (project.characters[bubble.character]?.transform.y ?? height) - 520 : 140;
    context.fillStyle = bubble.type === "thought" ? "rgba(255,255,255,.94)" : "rgba(255,244,249,.96)";
    context.strokeStyle = "#d75c8b";
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(x - 220, y - 60, 440, 120, 24);
    context.fill();
    context.stroke();
    context.fillStyle = "#3e3048";
    context.font = "24px sans-serif";
    context.fillText(bubble.text.slice(0, 42), x - 190, y - 4);
    if (bubble.englishText) { context.fillStyle = "#79566b"; context.font = "18px sans-serif"; context.fillText(bubble.englishText.slice(0, 52), x - 190, y + 28); }
  }
}
