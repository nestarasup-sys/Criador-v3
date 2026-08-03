import type {
  Character,
  ExpressionKey,
  ItemTransform,
  MaskStroke,
  PcCatalogItem,
  PcExpressionPack,
} from "./types";

const WIDTH = 1920;
const HEIGHT = 1080;
const PADDING = { x: 520, y: 360 };
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const chromaCache = new Map<string, Promise<HTMLCanvasElement>>();

function loadImage(src: string) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
      image.src = src;
    }));
  }
  return imageCache.get(src)!;
}

function transparentChroma(src: string) {
  if (!chromaCache.has(src)) {
    chromaCache.set(src, (async () => {
      const image = await loadImage(src);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas indisponível");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const distance = Math.hypot(pixels.data[index], pixels.data[index + 1] - 195, pixels.data[index + 2] - 102);
        if (distance < 34) pixels.data[index + 3] = 0;
        else if (distance < 92) pixels.data[index + 3] *= (distance - 34) / 58;
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    })());
  }
  return chromaCache.get(src)!;
}

function paintStroke(context: CanvasRenderingContext2D, stroke: MaskStroke, color: string) {
  if (!stroke.points.length) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function createMask(strokes: MaskStroke[], width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Máscara indisponível");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(PADDING.x, PADDING.y);
  for (const stroke of strokes) {
    if (stroke.mode === "erase") {
      context.globalCompositeOperation = "destination-out";
      paintStroke(context, stroke, "black");
    } else {
      context.globalCompositeOperation = "source-over";
      paintStroke(context, stroke, "white");
    }
  }
  context.restore();
  return canvas;
}

function expressionSource(character: Character, key: ExpressionKey) {
  const legacyPack = character.basePackId ?? "modelo-1";
  const pack = legacyPack === "padrao"
    ? "modelo-1"
    : legacyPack.replace(/^pack-(\d+)$/, (_, index) => `modelo-${Number(index) + 1}`);
  return `/models/modelos/${character.model}/${pack}/${key}.png`;
}

function normalizedTransform(transform?: Partial<ItemTransform>): ItemTransform {
  return {
    x: transform?.x ?? 0,
    y: transform?.y ?? 0,
    scale: transform?.scale ?? 1,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    flipX: transform?.flipX ?? false,
  };
}

function trimCanvas(source: HTMLCanvasElement) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  const data = context.getImageData(0, 0, source.width, source.height).data;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 2) {
    for (let x = 0; x < source.width; x += 2) {
      if (data[(y * source.width + x) * 4 + 3] > 12) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) return source;
  const pad = 12;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(source.width - 1, maxX + pad);
  maxY = Math.min(source.height - 1, maxY + pad);
  const output = document.createElement("canvas");
  output.width = maxX - minX + 1;
  output.height = maxY - minY + 1;
  output.getContext("2d")?.drawImage(source, minX, minY, output.width, output.height, 0, 0, output.width, output.height);
  return output;
}

export function expressionKey(emotion: string, state: string) {
  return (state === "default" ? emotion : `${emotion}_${state}`) as ExpressionKey;
}

export async function renderStudioCharacter(
  character: Character,
  key: ExpressionKey,
  catalog: PcCatalogItem[],
  packs: PcExpressionPack[],
) {
  const final = document.createElement("canvas");
  final.width = WIDTH;
  final.height = HEIGHT;
  const finalContext = final.getContext("2d");
  if (!finalContext) throw new Error("Canvas indisponível");
  const scene = document.createElement("canvas");
  scene.width = WIDTH + PADDING.x * 2;
  scene.height = HEIGHT + PADDING.y * 2;
  const context = scene.getContext("2d");
  if (!context) throw new Error("Canvas indisponível");

  const masks = {
    body: character.layerMasks?.body ?? character.maskStrokes ?? [],
    hairFront: character.layerMasks?.hairFront ?? character.layerMasks?.hair ?? [],
    hairBack: character.layerMasks?.hairBack ?? [],
    outfit: character.layerMasks?.outfit ?? [],
  };

  const drawItem = async (item: PcCatalogItem | { fileUrl: string; width: number; height: number; defaultX: number; defaultY: number }, transform: ItemTransform, mask: MaskStroke[] = []) => {
    const image = await loadImage(item.fileUrl);
    const width = item.width ?? image.naturalWidth;
    const height = item.height ?? image.naturalHeight;
    const centerX = item.defaultX ?? width / 2;
    const centerY = item.defaultY ?? height / 2;
    const layer = mask.length ? document.createElement("canvas") : null;
    if (layer) {
      layer.width = scene.width;
      layer.height = scene.height;
    }
    const target = layer?.getContext("2d") ?? context;
    if (!target) return;
    target.save();
    target.translate(PADDING.x + centerX + transform.x, PADDING.y + centerY + transform.y);
    target.rotate(transform.rotation * Math.PI / 180);
    target.scale(transform.scale * transform.scaleX * (transform.flipX ? -1 : 1), transform.scale * transform.scaleY);
    target.drawImage(image, -width / 2, -height / 2, width, height);
    target.restore();
    if (layer) {
      target.globalCompositeOperation = "destination-in";
      target.drawImage(createMask(mask, scene.width, scene.height), 0, 0);
      target.globalCompositeOperation = "source-over";
      context.drawImage(layer, 0, 0);
    }
  };

  const backHair = catalog.find((item) => item.id === character.selections.cabelosTras);
  if (backHair) await drawItem(backHair, normalizedTransform(character.adjustments.cabelosTras), masks.hairBack);

  const normalizedPack = character.basePackId === "padrao" ? "modelo-1" : character.basePackId ?? "modelo-1";
  const faceMode = normalizedPack !== "modelo-1" ? "base" : character.faceMode ?? "base";
  const baseSource = faceMode === "base" ? expressionSource(character, key) : `/models/${character.model}.png`;
  let base: HTMLCanvasElement;
  try {
    base = await transparentChroma(baseSource);
  } catch {
    base = await transparentChroma(expressionSource(character, "normal"));
  }
  const bodyLayer = document.createElement("canvas");
  bodyLayer.width = scene.width;
  bodyLayer.height = scene.height;
  const bodyContext = bodyLayer.getContext("2d");
  bodyContext?.drawImage(base, PADDING.x, PADDING.y, WIDTH, HEIGHT);
  if (bodyContext && masks.body.length) {
    bodyContext.globalCompositeOperation = "destination-in";
    bodyContext.drawImage(createMask(masks.body, scene.width, scene.height), 0, 0);
  }
  context.drawImage(bodyLayer, 0, 0);

  const outfit = catalog.find((item) => item.id === character.selections.roupas);
  if (outfit) await drawItem(outfit, normalizedTransform(character.adjustments.roupas), masks.outfit);

  if (faceMode !== "base") {
    if (faceMode === "pack") {
      const pack = packs.find((item) => item.id === character.expressionPackId);
      const frame = pack?.frames.find((item) => item.key === key) ?? pack?.frames.find((item) => item.key === "normal");
      if (frame) await drawItem({ ...frame, defaultX: 970, defaultY: 285 }, normalizedTransform(character.adjustments.rostos));
    } else {
      const face = catalog.find((item) => item.id === character.selections.rostos);
      if (face) await drawItem(face, normalizedTransform(character.adjustments.rostos));
    }
  }

  const frontHair = catalog.find((item) => item.id === character.selections.cabelos);
  if (frontHair) await drawItem(frontHair, normalizedTransform(character.adjustments.cabelos), masks.hairFront);

  const frame = character.exportFrame ?? { x: 0, y: 0, scale: 1 };
  finalContext.save();
  finalContext.translate(WIDTH / 2 + frame.x, HEIGHT / 2 + frame.y);
  finalContext.scale(frame.scale, frame.scale);
  finalContext.translate(-WIDTH / 2, -HEIGHT / 2);
  finalContext.drawImage(scene, -PADDING.x, -PADDING.y);
  finalContext.restore();
  return trimCanvas(final).toDataURL("image/png");
}
