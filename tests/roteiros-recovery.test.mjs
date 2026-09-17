import assert from "node:assert/strict";
import test from "node:test";
import { appendRecoveryJournal, discardPendingRecovery, findRecoveryCandidate, markRecoverySaved, readRecoveryJournal, RECOVERY_JOURNAL_KEY } from "../app/roteiros/recovery.mjs";

function makeStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

function state(title) {
  return { version: 1, profiles: [], scripts: title ? [{ id: title, title, participants: [], tiktoks: [], createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" }] : [], globalRules: [], settings: {} };
}

test("mantém um journal versionado de recovery e encontra alterações que ainda não chegaram ao PC", () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = makeStorage();
  try {
    const pc = state("pc");
    const pending = appendRecoveryJournal(state("pendente"), "pending", "2026-08-03T10:00:00.000Z");
    assert.equal(pending.version, 1);
    assert.equal(readRecoveryJournal().length, 1);
    assert.equal(findRecoveryCandidate(readRecoveryJournal(), pc)?.state.scripts[0].id, "pendente");
    markRecoverySaved(state("pendente"));
    assert.equal(findRecoveryCandidate(readRecoveryJournal(), pc), null);
    assert.match(String(globalThis.localStorage.getItem(RECOVERY_JOURNAL_KEY)), /pc-saved/);
  } finally { globalThis.localStorage = previous; }
});

test("descarta somente entradas pendentes sem quebrar um storage corrompido", () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = makeStorage();
  try {
    appendRecoveryJournal(state("pendente"), "pending");
    markRecoverySaved(state("salvo"));
    globalThis.localStorage.setItem(RECOVERY_JOURNAL_KEY, "não é json");
    assert.deepEqual(readRecoveryJournal(), []);
    appendRecoveryJournal(state("pendente-2"), "pending");
    markRecoverySaved(state("salvo-2"));
    discardPendingRecovery();
    assert.ok(readRecoveryJournal().every((entry) => entry.reason === "pc-saved"));
  } finally { globalThis.localStorage = previous; }
});
