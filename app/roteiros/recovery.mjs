import { normalizeRoteirosState } from "../domain/document-schemas.mjs";

export const RECOVERY_JOURNAL_KEY = "gacha-premium-roteiros-recovery-v1";
export const RECOVERY_JOURNAL_VERSION = 1;
export const RECOVERY_JOURNAL_LIMIT = 24;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function recoveryFingerprint(state) {
  return JSON.stringify(normalizeRoteirosState(state));
}

function isEntry(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && value.version === RECOVERY_JOURNAL_VERSION
    && typeof value.savedAt === "string"
    && value.state && typeof value.state === "object" && !Array.isArray(value.state));
}

export function readRecoveryJournal() {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(RECOVERY_JOURNAL_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).map((entry) => ({
      version: RECOVERY_JOURNAL_VERSION,
      id: typeof entry.id === "string" ? entry.id : `${entry.savedAt}-${Math.random()}`,
      savedAt: entry.savedAt,
      reason: entry.reason === "pc-saved" ? "pc-saved" : "pending",
      state: normalizeRoteirosState(entry.state),
    })).sort((left, right) => left.savedAt.localeCompare(right.savedAt));
  } catch {
    return [];
  }
}

function writeJournal(entries) {
  const target = storage();
  if (!target) return false;
  try {
    target.setItem(RECOVERY_JOURNAL_KEY, JSON.stringify(entries.slice(-RECOVERY_JOURNAL_LIMIT)));
    return true;
  } catch {
    // A full/blocked browser quota must never block saving to the PC.
    return false;
  }
}

export function appendRecoveryJournal(state, reason = "pending", savedAt = new Date().toISOString()) {
  const normalized = normalizeRoteirosState(state);
  const entries = readRecoveryJournal();
  const fingerprint = recoveryFingerprint(normalized);
  const previous = entries[entries.length - 1];
  if (previous && previous.reason === reason && recoveryFingerprint(previous.state) === fingerprint) return previous;
  const entry = {
    version: RECOVERY_JOURNAL_VERSION,
    id: globalThis.crypto?.randomUUID?.() ?? `recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    savedAt,
    reason: reason === "pc-saved" ? "pc-saved" : "pending",
    state: clone(normalized),
  };
  writeJournal([...entries, entry]);
  return entry;
}

export function markRecoverySaved(state) {
  const normalized = normalizeRoteirosState(state);
  const fingerprint = recoveryFingerprint(normalized);
  const entries = readRecoveryJournal().filter((entry) => !(entry.reason === "pending" && recoveryFingerprint(entry.state) === fingerprint));
  const entry = {
    version: RECOVERY_JOURNAL_VERSION,
    id: globalThis.crypto?.randomUUID?.() ?? `recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    savedAt: new Date().toISOString(),
    reason: "pc-saved",
    state: clone(normalized),
  };
  writeJournal([...entries, entry]);
  return entry;
}

export function discardPendingRecovery() {
  const entries = readRecoveryJournal().filter((entry) => entry.reason !== "pending");
  writeJournal(entries);
  return entries;
}

export function findRecoveryCandidate(entries, pcState) {
  const normalizedPc = normalizeRoteirosState(pcState);
  const latestPcCheckpoint = [...entries].reverse().find((entry) => entry.reason === "pc-saved");
  const pending = [...entries].reverse().find((entry) => entry.reason === "pending"
    && (!latestPcCheckpoint || entry.savedAt > latestPcCheckpoint.savedAt)
    && recoveryFingerprint(entry.state) !== recoveryFingerprint(normalizedPc));
  return pending || null;
}

export function latestRecoveryState(entries) {
  return entries.length ? entries[entries.length - 1].state : null;
}
