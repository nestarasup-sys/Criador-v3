declare const entityIdBrand: unique symbol;

export type EntityId<TKind extends string> = string & {
  readonly [entityIdBrand]: TKind;
};

export type CharacterId = EntityId<"character">;
export type CatalogItemId = EntityId<"catalog-item">;
export type ExpressionPackId = EntityId<"expression-pack">;
export type StudioId = EntityId<"studio">;
export type ScriptId = EntityId<"script">;
export type TikTokId = EntityId<"tiktok">;
export type ReactionBlockId = EntityId<"reaction-block">;

export const ENTITY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;

export function isEntityId(value: unknown): value is EntityId<string> {
  return typeof value === "string" && ENTITY_ID_PATTERN.test(value);
}

/** Adaptador de fronteira; contratos legados continuam armazenando strings. */
export function asEntityId<TKind extends string>(value: string): EntityId<TKind> {
  if (!isEntityId(value)) throw new Error("Identificador inválido.");
  return value as EntityId<TKind>;
}
