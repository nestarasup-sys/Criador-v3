import { DEFAULT_CALIBRATION_SETTINGS, EXTENSION_EXPRESSIONS, PRIMARY_EXPRESSIONS } from "../constants/expressions";
import { cropFace } from "./crop";
import { removeSheetChroma } from "./chroma-key";
import { detectFaceSheet } from "./detection";
import { canvasFromPixels, placeFace } from "./compositor";
import { analyzeFaceAnatomy } from "./anatomy";
import { buildHeadMaster } from "./head-master";
import { scoreFace } from "./quality";
import { calibrateExtension, calibratePrimary } from "./normalization";
import type { CalibrationSettings, FaceAnatomy, GeneratedSprite, HeadMaster, ModelExpression, SheetId, SheetResult, SpriteAdjustment } from "../types/face-model";

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

function buildSprite(face: ReturnType<typeof cropFace>, anatomy: FaceAnatomy, key: string, sheet: SheetId, master: HeadMaster, adjustment: SpriteAdjustment, state: GeneratedSprite["state"], settings: CalibrationSettings, compatibility?: number): GeneratedSprite {
  const source = canvasFromPixels(face.data, face.width, face.height);
  const output = placeFace(document.createElement("canvas"), source, anatomy, master, adjustment, settings);
  return { key, sourceSheet: sheet, state, dataUrl: output.toDataURL("image/png"), width: output.width, height: output.height, anatomy, adjustment, quality: scoreFace(anatomy, master, adjustment, master.stabilityScore, compatibility) };
}

export type ProcessSheetOptions = { referenceMaster?: HeadMaster; settings?: Partial<CalibrationSettings>; manualAdjustments?: readonly Partial<SpriteAdjustment>[] };

export async function processSheet(file: File, sheet: SheetId, options: ProcessSheetOptions = {}): Promise<SheetResult> {
  const settings: CalibrationSettings = { ...DEFAULT_CALIBRATION_SETTINGS, ...options.settings };
  const source = await imageDataFromFile(file);
  const keyed = await removeSheetChroma(source.data.data, source.data.width, source.data.height, settings);
  const regions = detectFaceSheet(keyed, source.data.width, source.data.height);
  if (regions.length !== 21) throw new Error("Não foi possível localizar as 21 células da folha.");
  const crops = regions.map((region) => cropFace(keyed, source.data.width, source.data.height, region));
  const anatomies = crops.map((crop) => analyzeFaceAnatomy(crop.data, crop.width, crop.height));
  if (anatomies.some((anatomy) => !anatomy)) throw new Error("Não foi possível analisar a anatomia de um ou mais rostos.");
  const validAnatomies = anatomies as FaceAnatomy[];
  const localMaster = buildHeadMaster(validAnatomies);
  const calibration = options.referenceMaster
    ? calibrateExtension(validAnatomies, options.referenceMaster, settings.extensionMaxCorrection, settings.extensionMicroAdjustment)
    : calibratePrimary(validAnatomies, localMaster, settings.primaryMaxCorrection);
  const targetMaster = options.referenceMaster ?? localMaster;
  const states: GeneratedSprite["state"][] = ["default", "blink", "talk"];
  const sprites = crops.map((crop, index) => buildSprite(crop, validAnatomies[index], spriteKey(sheet, index), sheet, targetMaster, { ...calibration.adjustments[index], ...options.manualAdjustments?.[index] }, states[Math.floor(index / 7)], settings, options.referenceMaster ? calibration.compatibility.overall : undefined));
  const expressions: ModelExpression[] = expressionsFor(sheet).map((key, column) => ({ key, sourceSheet: sheet, default: sprites[column], blink: sprites[column + 7], talk: sprites[column + 14] }));
  return { id: sheet, fileName: file.name, width: source.data.width, height: source.data.height, regions, expressions, imageUrl: source.imageUrl, headMaster: localMaster, compatibility: options.referenceMaster ? calibration.compatibility : undefined };
}
