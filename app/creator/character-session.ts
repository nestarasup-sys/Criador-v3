import { colorAdjustmentIsActive } from "../domain/color-rendering.ts";
import type {
  CharacterSnapshot,
  ColorAdjustments,
  ExportFrame,
  ModelColorAdjustments,
  ModelColorScope,
  OutfitColorAdjustmentsByGroup,
  PreviewPan,
  ProtectionMasks,
} from "../domain/character-contract";
import type {
  BasePackId,
  Category,
  CompositionMode,
  FaceMode,
  HairAdjustmentsByBasePack,
  ItemTransform,
  MaskStroke,
  Model,
} from "../domain/character-primitives";
import type { Emotion, ExpressionState } from "../domain/expression-contract";
import { normalizeTransform, type LayerMasks } from "./editor-state.ts";

export type CharacterHistory = {
  past: string[];
  future: string[];
  current: string | null;
  changedAt: number;
};

export type CreatorSnapshotInput = {
  name: string;
  model: Model;
  basePackId: BasePackId;
  selections: Record<Category, string | null>;
  adjustments: Record<Category, ItemTransform>;
  colorAdjustments: ColorAdjustments;
  modelColorAdjustments: ModelColorAdjustments;
  modelColorScope: ModelColorScope;
  outfitColorAdjustmentsByGroup: OutfitColorAdjustmentsByGroup;
  protectionMasks: ProtectionMasks;
  faceMode: FaceMode;
  compositionMode: CompositionMode;
  expressionPackId: string | null;
  expressionEmotion: Emotion;
  expressionState: ExpressionState;
  layerMasks: LayerMasks;
  previewPan: PreviewPan;
  exportFrame: ExportFrame;
  templateScaleX: number;
  hairAdjustmentsByBasePack: HairAdjustmentsByBasePack;
  outfitAdjustmentsByBasePack: Record<string, ItemTransform>;
  outfitLayerMasksByBasePack: Record<string, MaskStroke[]>;
  outfitProtectionMasksByBasePack: Record<string, string>;
};

export type CreatorCustomizationInput = Pick<
  CreatorSnapshotInput,
  "selections" | "colorAdjustments" | "modelColorAdjustments" | "outfitColorAdjustmentsByGroup" | "protectionMasks" | "layerMasks" | "outfitProtectionMasksByBasePack"
> & {
  expressionPackId: string | null;
};

export function outfitStateKey(outfitId: string | null | undefined, packId: BasePackId) {
  return `${outfitId ?? "nenhuma"}:${packId}`;
}

export function buildCreatorSnapshot(input: CreatorSnapshotInput): CharacterSnapshot {
  const activeOutfitStateKey = outfitStateKey(input.selections.roupas, input.basePackId);
  return {
    name: input.name.trim() || "Sem nome",
    model: input.model,
    basePackId: input.basePackId,
    selections: input.selections,
    adjustments: input.adjustments,
    colorAdjustments: input.colorAdjustments,
    modelColorAdjustments: input.modelColorAdjustments,
    modelColorScope: input.modelColorScope,
    outfitColorAdjustmentsByGroup: input.outfitColorAdjustmentsByGroup,
    protectionMasks: input.protectionMasks,
    faceMode: input.faceMode,
    compositionMode: input.compositionMode,
    expressionPackId: input.expressionPackId,
    expressionEmotion: input.expressionEmotion,
    expressionState: input.expressionState,
    layerMasks: input.layerMasks,
    maskStrokes: input.layerMasks.body,
    previewPan: input.previewPan,
    exportFrame: input.exportFrame,
    templateScaleX: input.templateScaleX,
    hairAdjustmentsByBasePack: {
      ...input.hairAdjustmentsByBasePack,
      [input.basePackId]: {
        cabelos: normalizeTransform(input.adjustments.cabelos),
        cabelosTras: normalizeTransform(input.adjustments.cabelosTras),
      },
    },
    outfitAdjustmentsByBasePack: {
      ...input.outfitAdjustmentsByBasePack,
      [activeOutfitStateKey]: normalizeTransform(input.adjustments.roupas),
    },
    outfitLayerMasksByBasePack: {
      ...input.outfitLayerMasksByBasePack,
      [activeOutfitStateKey]: input.layerMasks.outfit,
    },
    outfitProtectionMasksByBasePack: {
      ...Object.fromEntries(
        Object.entries(input.outfitProtectionMasksByBasePack)
          .filter(([key]) => key !== activeOutfitStateKey),
      ),
      ...(input.protectionMasks.roupas
        ? { [activeOutfitStateKey]: input.protectionMasks.roupas }
        : {}),
    },
  };
}

export function serializeCreatorSnapshot(input: CreatorSnapshotInput) {
  return JSON.stringify(buildCreatorSnapshot(input));
}

export function hasCreatorCustomization(input: CreatorCustomizationInput) {
  return Object.values(input.selections).some(Boolean)
    || Boolean(input.expressionPackId)
    || Object.values(input.layerMasks).some((strokes) => strokes.length > 0)
    || Object.values(input.colorAdjustments).some((adjustment) => colorAdjustmentIsActive(adjustment))
    || Object.values(input.modelColorAdjustments).some((adjustment) => colorAdjustmentIsActive(adjustment))
    || Object.values(input.outfitColorAdjustmentsByGroup).some((adjustment) => colorAdjustmentIsActive(adjustment))
    || Object.keys(input.protectionMasks).length > 0
    || Object.keys(input.outfitProtectionMasksByBasePack).length > 0;
}

export function createCharacterHistory(): CharacterHistory {
  return { past: [], future: [], current: null, changedAt: 0 };
}

export function recordCharacterHistory(
  history: CharacterHistory,
  snapshot: string,
  {
    now,
    initialize = false,
    restored = false,
    coalesceMs = 420,
  }: {
    now: number;
    initialize?: boolean;
    restored?: boolean;
    coalesceMs?: number;
  },
): CharacterHistory {
  const next: CharacterHistory = {
    past: [...history.past],
    future: [...history.future],
    current: history.current,
    changedAt: history.changedAt,
  };
  if (initialize && next.current === null) {
    next.current = snapshot;
    next.changedAt = now;
    return next;
  }
  if (restored) {
    next.current = snapshot;
    next.changedAt = now;
    return next;
  }
  if (next.current === null) {
    next.current = snapshot;
    return next;
  }
  if (next.current !== snapshot) {
    if (now - next.changedAt >= coalesceMs) {
      next.past = [...next.past, next.current].slice(-80);
    }
    next.current = snapshot;
    next.future = [];
    next.changedAt = now;
  }
  return next;
}

export function undoCharacterHistory(history: CharacterHistory, now: number) {
  if (!history.past.length || !history.current) return null;
  const target = history.past[history.past.length - 1];
  return {
    snapshot: target,
    history: {
      past: history.past.slice(0, -1),
      future: [history.current, ...history.future],
      current: target,
      changedAt: now,
    } satisfies CharacterHistory,
  };
}

export function redoCharacterHistory(history: CharacterHistory, now: number) {
  if (!history.future.length || !history.current) return null;
  const target = history.future[0];
  return {
    snapshot: target,
    history: {
      past: [...history.past, history.current].slice(-80),
      future: history.future.slice(1),
      current: target,
      changedAt: now,
    } satisfies CharacterHistory,
  };
}
