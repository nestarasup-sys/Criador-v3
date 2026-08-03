import assert from "node:assert/strict";
import test from "node:test";
import { inside, safeId } from "../services/storage/path-safety.mjs";

test("valida identificadores e mantém destinos dentro da pasta", () => {
  assert.equal(safeId("modelo-1"), "modelo-1");
  assert.throws(() => safeId("../fora"), /Identificador inválido/);
  assert.equal(inside("C:\\dados", "C:\\dados\\arquivo.json"), true);
  assert.equal(inside("C:\\dados", "C:\\dados-backup\\arquivo.json"), false);
});
