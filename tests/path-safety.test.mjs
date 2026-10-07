import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inside, safeId } from "../services/storage/path-safety.mjs";

test("valida identificadores e mantém destinos dentro da pasta", () => {
  assert.equal(safeId("modelo-1"), "modelo-1");
  assert.throws(() => safeId("../fora"), /Identificador inválido/);

  const parent = join(tmpdir(), "nymi-dados");
  assert.equal(inside(parent, join(parent, "arquivo.json")), true);
  assert.equal(inside(parent, join(tmpdir(), "nymi-dados-backup", "arquivo.json")), false);

  assert.equal(inside("C:\\dados", "C:\\dados\\arquivo.json"), true);
  assert.equal(inside("C:\\dados", "C:\\dados-backup\\arquivo.json"), false);
  assert.equal(inside("C:\\dados", "D:\\dados\\arquivo.json"), false);
});
