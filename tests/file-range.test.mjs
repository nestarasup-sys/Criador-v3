import assert from "node:assert/strict";
import test from "node:test";
import { resolveByteRange } from "../services/storage/file-range.mjs";

test("resolve intervalos completos, parciais e sufixos", () => {
  assert.equal(resolveByteRange(undefined, 100), null);
  assert.deepEqual(resolveByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(resolveByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(resolveByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(resolveByteRange("bytes=90-200", 100), { start: 90, end: 99 });
  assert.deepEqual(resolveByteRange("bytes=100-", 100), { invalid: true });
});
