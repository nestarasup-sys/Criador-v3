import type { BasePackId, Model } from "../domain/character-primitives";
import { normalizeBasePackId } from "../domain/base-model.mjs";
import type { ExpressionKey } from "../domain/expression-contract";
import { NEW_BASE_EXPRESSION_KEYS, STANDARD_BASE_EXPRESSION_KEYS } from "../domain/expression-contract";

export type BasePackDefinition = {
  id: BasePackId;
  name: string;
  expressionKeys: readonly ExpressionKey[];
  source: string;
  type?: "full-body" | "head-only";
  anchor?: "neck-base";
  anchorX?: number;
  anchorY?: number;
};

export type BasePackCollection = Record<Model, readonly BasePackDefinition[]>;

export const DEFAULT_BASE_PACKS: BasePackCollection = {
  feminino: [
    { id: "modelo-1", name: "Modelo 1", expressionKeys: STANDARD_BASE_EXPRESSION_KEYS, source: "/models/modelos/feminino/modelo-1" },
    { id: "modelo-2", name: "Modelo 2", expressionKeys: NEW_BASE_EXPRESSION_KEYS, source: "/models/modelos/feminino/modelo-2" },
    { id: "modelo-3", name: "Modelo 3", expressionKeys: NEW_BASE_EXPRESSION_KEYS, source: "/models/modelos/feminino/modelo-3" },
  ],
  masculino: [
    { id: "modelo-1", name: "Modelo 1", expressionKeys: STANDARD_BASE_EXPRESSION_KEYS, source: "/models/modelos/masculino/modelo-1" },
    { id: "modelo-2", name: "Modelo 2", expressionKeys: NEW_BASE_EXPRESSION_KEYS, source: "/models/modelos/masculino/modelo-2" },
    { id: "modelo-3", name: "Modelo 3", expressionKeys: NEW_BASE_EXPRESSION_KEYS, source: "/models/modelos/masculino/modelo-3" },
    { id: "modelo-4", name: "Modelo 4", expressionKeys: NEW_BASE_EXPRESSION_KEYS, source: "/models/modelos/masculino/modelo-4" },
  ],
};

export function getBasePack(packs: BasePackCollection, model: Model, packId?: BasePackId): BasePackDefinition {
  const normalizedId = normalizeBasePackId(packId);
  return packs[model].find((pack) => pack.id === normalizedId) ?? packs[model][0];
}

export function baseExpressionSource(pack: BasePackDefinition, key: ExpressionKey) {
  return `${pack.source}/${key}.png`;
}

export function basePackCacheKey(model: Model, packId: BasePackId) {
  return `${model}:${packId}`;
}
