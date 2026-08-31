import { EXTENSION_EXPRESSIONS, OUTPUT_HEIGHT, OUTPUT_WIDTH, PRIMARY_EXPRESSIONS } from "../constants/expressions";
import { cropFace } from "./crop";
import { removeSheetChroma } from "./chroma-key";
import { detectFaceSheet } from "./detection";
import { canvasFromPixels, analyzeHead, placeFace } from "./compositor";
import type { GeneratedSprite, HeadMaster, ModelExpression, SheetId, SheetResult } from "../types/face-model";

async function imageDataFromFile(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0); bitmap.close();
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  return { data: context.getImageData(0, 0, canvas.width, canvas.height), imageUrl: URL.createObjectURL(file) };
}

function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 1; }

function expressionsFor(sheet: SheetId) { return sheet === "primary" ? PRIMARY_EXPRESSIONS : EXTENSION_EXPRESSIONS; }

function spriteKey(sheet: SheetId, index: number) { return `${expressionsFor(sheet)[index % 7]}${Math.floor(index / 7) === 0 ? "" : Math.floor(index / 7) === 1 ? "_blink" : "_talk"}`; }

function buildSprite(face: ReturnType<typeof cropFace>, key: string, sheet: SheetId, master: HeadMaster, scaleX: number, scaleY: number, state: GeneratedSprite["state"]): GeneratedSprite {
  const source = canvasFromPixels(face.data, face.width, face.height);
  const output = placeFace(document.createElement("canvas"), source, master, scaleX, scaleY);
  return { key, sourceSheet: sheet, state, dataUrl: output.toDataURL("image/png"), width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
}

export async function processSheet(file: File, sheet: SheetId, master?: HeadMaster): Promise<SheetResult> {
  const source = await imageDataFromFile(file);
  const keyed = await removeSheetChroma(source.data.data, source.data.width, source.data.height);
  const regions = detectFaceSheet(keyed, source.data.width, source.data.height);
  if (regions.length !== 21) throw new Error("Não foi possível localizar as 21 células da folha.");
  const crops = regions.map((region) => cropFace(keyed, source.data.width, source.data.height, region));
  const localMaster: HeadMaster = master ?? { width: median(crops.map((crop) => crop.width)), height: median(crops.map((crop) => crop.height)), centerX: OUTPUT_WIDTH / 2, neckY: 346, neckWidth: 1 };
  const scaleX = master ? master.width / Math.max(1, median(crops.map((crop) => crop.width))) : 1.1;
  const scaleY = master ? master.height / Math.max(1, median(crops.map((crop) => crop.height))) : 1.1;
  const states: GeneratedSprite["state"][] = ["default", "blink", "talk"];
  const sprites = crops.map((crop, index) => buildSprite(crop, spriteKey(sheet, index), sheet, localMaster, scaleX, scaleY, states[Math.floor(index / 7)]));
  const expressions: ModelExpression[] = expressionsFor(sheet).map((key, column) => ({ key, sourceSheet: sheet, default: sprites[column], blink: sprites[column + 7], talk: sprites[column + 14] }));
  return { id: sheet, fileName: file.name, width: source.data.width, height: source.data.height, regions, expressions, imageUrl: source.imageUrl };
}
