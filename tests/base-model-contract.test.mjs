import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BASE_PACK_ID, normalizeBasePackId } from "../app/domain/base-model.mjs";

test("normaliza identificadores históricos de modelo sem alterar os modernos", () => {
  assert.equal(normalizeBasePackId(), DEFAULT_BASE_PACK_ID);
  assert.equal(normalizeBasePackId(null), DEFAULT_BASE_PACK_ID);
  assert.equal(normalizeBasePackId("padrao"), "modelo-1");
  assert.equal(normalizeBasePackId("pack-0"), "modelo-1");
  assert.equal(normalizeBasePackId("pack-3"), "modelo-4");
  assert.equal(normalizeBasePackId("modelo-3"), "modelo-3");
  assert.equal(normalizeBasePackId("especial"), "especial");
});
