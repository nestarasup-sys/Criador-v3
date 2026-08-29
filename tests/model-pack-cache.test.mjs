import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cacheia expressões pelo pacote realmente resolvido", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  // The requested id can temporarily resolve to the first default pack while
  // /api/pc/models is loading. Both render paths must use the resolved pack id
  // so that the fallback can never be stored under modelo-8 (or another id).
  assert.match(page, /basePackCacheKey\(model, currentBasePack\.id\)/);
  assert.match(page, /basePackCacheKey\(model, activeBasePack\.id\)/);
  assert.doesNotMatch(page, /basePackCacheKey\(model, basePackId\)/);
});
