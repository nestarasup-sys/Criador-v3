import { expressionKey, renderStudioCharacter } from "./character-renderer";
import { wrapCanvasText } from "./scene-ops";
import type { Character, ExpressionKey, PcCatalogItem, PcExpressionPack, SceneBubble, SceneNarrator, Studio } from "./types";

export function loadStudioCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export function studioCanvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG")), "image/png");
  });
}

type PrintCharacterRenderer = (character: Character, key: ExpressionKey, catalog: PcCatalogItem[], expressionPacks: PcExpressionPack[]) => Promise<string>;

type StudioPrintOptions = {
  studio: Studio;
  charactersById: Map<string, Character>;
  rendered: Record<string, string>;
  renderCacheKey: (character: Character, emotion: string, state: string) => string;
  catalog: PcCatalogItem[];
  expressionPacks: PcExpressionPack[];
  renderCharacter?: PrintCharacterRenderer;
  loadImage?: (src: string) => Promise<HTMLImageElement>;
};

export async function renderStudioSceneToCanvas({ studio, charactersById, rendered, renderCacheKey, catalog, expressionPacks, renderCharacter = renderStudioCharacter, loadImage = loadStudioCanvasImage }: StudioPrintOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível criar o canvas do Print");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = "#f3f0f8";
  context.fillRect(0, 0, width, height);

  if (studio.background) {
    const image = await loadImage(studio.background.src);
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const stageRatio = width / height;
    const contain = studio.background.fit === "contain";
    const drawWidth = (contain ? imageRatio > stageRatio : imageRatio < stageRatio) ? width : height * imageRatio;
    const drawHeight = drawWidth / imageRatio;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  const elements = [
    ...studio.characters.map((item) => ({ kind: "character" as const, item })),
    ...studio.objects.map((item) => ({ kind: "object" as const, item })),
    ...studio.bubbles.map((item) => ({ kind: "bubble" as const, item })),
    ...studio.narrators.map((item) => ({ kind: "narrator" as const, item })),
  ].sort((a, b) => a.item.z - b.item.z);

  for (const element of elements) {
    if (element.kind === "character") {
      const character = charactersById.get(element.item.characterId);
      const cacheKey = character ? renderCacheKey(character, element.item.expressionEmotion, element.item.expressionState) : "";
      const src = character
        ? rendered[cacheKey] ?? await renderCharacter(character, expressionKey(element.item.expressionEmotion, element.item.expressionState), catalog, expressionPacks)
        : undefined;
      if (!src) continue;
      const image = await loadImage(src);
      const drawHeight = height * .72 * element.item.scale;
      const drawWidth = drawHeight * image.naturalWidth / image.naturalHeight;
      context.save();
      context.translate(element.item.x * width, element.item.y * height);
      context.scale(element.item.flipX ? -1 : 1, 1);
      context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      context.restore();
    } else if (element.kind === "object") {
      const image = await loadImage(element.item.src);
      const drawWidth = width * .18 * element.item.scale;
      const drawHeight = drawWidth * image.naturalHeight / image.naturalWidth;
      context.save();
      context.translate(element.item.x * width, element.item.y * height);
      context.scale(element.item.flipX ? -1 : 1, 1);
      context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      context.restore();
    } else if (element.kind === "bubble") {
      drawBubble(context, element.item, width, height);
    } else {
      drawNarrator(context, element.item, width, height);
    }
  }
  return canvas;
}

function drawBubble(context: CanvasRenderingContext2D, item: SceneBubble, width: number, height: number) {
  const boxWidth = item.width * item.scale;
  const fontSize = item.fontSize * item.scale;
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const lines = wrapCanvasText(context, item.text, boxWidth - 36 * item.scale);
  const lineHeight = fontSize * 1.22;
  const boxHeight = Math.max(72 * item.scale, lines.length * lineHeight + 30 * item.scale);
  const left = item.x * width - boxWidth / 2;
  const top = item.y * height - boxHeight / 2;
  context.fillStyle = "white";
  context.strokeStyle = "#322746";
  context.lineWidth = 4 * item.scale;
  context.beginPath();
  context.roundRect(left, top, boxWidth, boxHeight, item.bubbleType === "pensamento" ? 34 * item.scale : 22 * item.scale);
  context.fill(); context.stroke();
  context.beginPath();
  if (item.bubbleType === "fala") {
    const tailX = item.tailSide === "left" ? left + boxWidth * .28 : left + boxWidth * .72;
    context.moveTo(tailX - 15, top + boxHeight - 2);
    context.lineTo(tailX, top + boxHeight + 28 * item.scale);
    context.lineTo(tailX + 18, top + boxHeight - 2);
    context.fill(); context.stroke();
  } else {
    const tailX = item.tailSide === "left" ? left + boxWidth * .26 : left + boxWidth * .74;
    context.arc(tailX, top + boxHeight + 14 * item.scale, 9 * item.scale, 0, Math.PI * 2);
    context.fill(); context.stroke();
    context.beginPath(); context.arc(tailX - (item.tailSide === "left" ? 10 : -10), top + boxHeight + 34 * item.scale, 5 * item.scale, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  context.fillStyle = "#272032";
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((line, index) => context.fillText(line, item.x * width, top + 18 * item.scale + lineHeight * (index + .5)));
}

function drawNarrator(context: CanvasRenderingContext2D, item: SceneNarrator, width: number, height: number) {
  const boxWidth = item.width * item.scale;
  const fontSize = item.fontSize * item.scale;
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const lines = wrapCanvasText(context, item.text, boxWidth - 30 * item.scale);
  const lineHeight = fontSize * 1.25;
  const boxHeight = lines.length * lineHeight + 24 * item.scale;
  const left = item.x * width - boxWidth / 2;
  const top = item.y * height - boxHeight / 2;
  if (item.boxed) { context.fillStyle = "rgba(31,24,43,.88)"; context.beginPath(); context.roundRect(left, top, boxWidth, boxHeight, 12 * item.scale); context.fill(); }
  context.fillStyle = item.boxed ? "white" : "#241d2d";
  context.textAlign = item.align;
  context.textBaseline = "middle";
  const textX = item.align === "left" ? left + 15 * item.scale : item.align === "right" ? left + boxWidth - 15 * item.scale : item.x * width;
  lines.forEach((line, index) => context.fillText(line, textX, top + 12 * item.scale + lineHeight * (index + .5)));
}
