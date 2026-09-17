import assert from "node:assert/strict";
import test from "node:test";
import { beginBusyOperation, endBusyOperation } from "../app/base de dados/busy-tracker.ts";

test("mantém a Base ocupada enquanto outra operação ainda está em andamento", () => {
  const operations = new Map();

  assert.equal(beginBusyOperation(operations, "save:1", "save:1"), "save:1");
  assert.equal(beginBusyOperation(operations, "save:2", "save:2"), "save:2");
  assert.equal(endBusyOperation(operations, "save:1"), "save:2");
  assert.equal(endBusyOperation(operations, "save:2"), "");
});
