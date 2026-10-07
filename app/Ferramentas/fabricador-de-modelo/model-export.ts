import JSZip from "jszip";
import { localDataFetch } from "../../lib/local-data-client";
import { EYE_EXPRESSIONS } from "./constants/expressions";
import { toCatalogFrame } from "./core/compositor";
import {
  EFFECT_KINDS,
  presetTagForProfile,
  type ModelGender,
  type NextModel,
  type PresetProfile,
} from "./fabricador-config";
import type { GeneratedOutputs } from "./editor-state";
import type { EyePiece, FacePreset, MouthPiece } from "./types/eye-model";

export type FabricatorModelManifest = {
  name: string;
  gender: ModelGender;
  type: "head-only";
  anchor: "neck-base";
  anchorX: number;
  anchorY: number;
  baseScale: number;
  width: number;
  height: number;
  source: string;
  presetTag: ReturnType<typeof presetTagForProfile>;
  expressionKeys: string[];
  generator: {
    version: number;
    includes: string[];
  };
};

async function exportSessionRequest(
  gender: ModelGender,
  modelId: string,
  suffix = "",
  init: RequestInit = {},
) {
  const response = await localDataFetch(
    `/models/export-session/${gender}/${modelId}${suffix}`,
    init,
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as {
      error?: string;
      requestId?: string;
    };
    throw new Error(
      `${detail.error || "Falha na sessão de exportação."}${detail.requestId ? ` (código ${detail.requestId})` : ""}`,
    );
  }
  return response;
}

async function uploadCatalogFile(
  gender: ModelGender,
  modelId: string,
  fileName: string,
  body: BodyInit,
  contentType: string,
) {
  await exportSessionRequest(
    gender,
    modelId,
    `/file/${encodeURIComponent(fileName)}`,
    {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    },
  );
}

export async function fetchNextFabricatorModel(gender: ModelGender): Promise<NextModel> {
  const response = await localDataFetch(`/models/next/${gender}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Não consegui calcular o próximo número.");
  const data = await response.json() as Partial<NextModel>;
  if (
    typeof data.number !== "number"
    || !Number.isInteger(data.number)
    || data.number < 1
  ) {
    throw new Error("Numeração inválida.");
  }
  return {
    gender,
    number: data.number,
    id: `modelo-${data.number}`,
  };
}

export function buildFabricatorModelManifest({
  targetModel,
  profile,
  presets,
  hasEyebrows,
  mouthPieces,
  mouthTalkPieces,
}: {
  targetModel: NextModel;
  profile: PresetProfile | null | undefined;
  presets: FacePreset[];
  hasEyebrows: boolean;
  mouthPieces: MouthPiece[];
  mouthTalkPieces: MouthPiece[];
}): FabricatorModelManifest {
  const presetTag = presetTagForProfile(profile);
  return {
    name: `Modelo ${targetModel.number}`,
    gender: targetModel.gender,
    type: "head-only",
    anchor: "neck-base",
    anchorX: 960,
    anchorY: 346,
    baseScale: 1,
    width: 1920,
    height: 1080,
    source: "fabricador-de-modelo-v2",
    presetTag,
    expressionKeys: EYE_EXPRESSIONS.map(([key]) => key),
    generator: {
      version: 3,
      includes: [
        "eyes",
        "eyes-pt",
        ...(hasEyebrows ? ["eyebrows"] : []),
        ...(mouthPieces.length ? ["mouths"] : []),
        ...(mouthTalkPieces.length ? ["mouths-talk"] : []),
        ...(presets.some((preset) => preset.mouthHalo.enabled) ? ["mouth-halo"] : []),
        ...EFFECT_KINDS.filter((kind) =>
          presets.some((preset) =>
            preset.enabledEffects[kind] && preset.effectAssets[kind])),
      ],
    },
  };
}

export async function publishFabricatorModel({
  targetModel,
  replaceExisting,
  manifest,
  outputs,
  onProgress,
}: {
  targetModel: NextModel;
  replaceExisting: boolean;
  manifest: FabricatorModelManifest;
  outputs: GeneratedOutputs;
  onProgress?: (completed: number, total: number, key: string) => void;
}) {
  if (outputs.base.length !== EYE_EXPRESSIONS.length) {
    throw new Error("As 21 expressões precisam estar prontas.");
  }

  let sessionStarted = false;
  try {
    await exportSessionRequest(targetModel.gender, targetModel.id, "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replaceExisting }),
    });
    sessionStarted = true;

    await uploadCatalogFile(
      targetModel.gender,
      targetModel.id,
      `${targetModel.id}.json`,
      JSON.stringify(manifest, null, 2),
      "application/json",
    );

    for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
      const [key] = EYE_EXPRESSIONS[index];
      const variants = {
        base: outputs.base[index],
        talk: outputs.talk[index],
        blink: outputs.blink[index],
        pt: outputs.pt[index],
        ptTalk: outputs.ptTalk[index],
        ptBlink: outputs.ptBlink[index],
      };
      for (const [variant, value] of Object.entries(variants)) {
        if (!value) throw new Error(`Falha no ${variant} de ${key}.`);
      }

      const uploads: Array<[string, string]> = [
        [`${key}.png`, variants.base],
        [`${key}_talk.png`, variants.talk],
        [`${key}_blink.png`, variants.blink],
        [`pt_${key}.png`, variants.pt],
        [`pt_${key}_talk.png`, variants.ptTalk],
        [`pt_${key}_blink.png`, variants.ptBlink],
      ];
      for (const [fileName, dataUrl] of uploads) {
        await uploadCatalogFile(
          targetModel.gender,
          targetModel.id,
          fileName,
          await toCatalogFrame(dataUrl),
          "image/png",
        );
      }
      onProgress?.(index + 1, EYE_EXPRESSIONS.length, key);
    }

    await exportSessionRequest(
      targetModel.gender,
      targetModel.id,
      "/commit",
      { method: "POST" },
    );
    sessionStarted = false;
  } catch (error) {
    if (sessionStarted) {
      await exportSessionRequest(
        targetModel.gender,
        targetModel.id,
        "",
        { method: "DELETE" },
      ).catch(() => undefined);
    }
    throw error;
  }
}

export async function downloadFabricatorPackage(outputs: GeneratedOutputs) {
  if (outputs.base.length !== EYE_EXPRESSIONS.length) {
    throw new Error("As 21 expressões precisam estar prontas.");
  }

  const zip = new JSZip();
  for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
    const [key] = EYE_EXPRESSIONS[index];
    const variants: Array<[string, string | undefined]> = [
      [`${key}.png`, outputs.base[index]],
      [`pt_${key}.png`, outputs.pt[index]],
      [`${key}_talk.png`, outputs.talk[index]],
      [`${key}_blink.png`, outputs.blink[index]],
      [`pt_${key}_talk.png`, outputs.ptTalk[index]],
      [`pt_${key}_blink.png`, outputs.ptBlink[index]],
    ];
    for (const [fileName, dataUrl] of variants) {
      if (!dataUrl) throw new Error(`Arquivo ${fileName} ainda não foi gerado.`);
      zip.file(fileName, dataUrl.split(",")[1], { base64: true });
    }
  }

  zip.file(
    "README.txt",
    "Fabricador de Modelo V2\n21 expressões + PT, talk, blink, PT talk e PT blink.\n",
  );
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "fabricador-modelo-v2.zip";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
