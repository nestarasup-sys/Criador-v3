import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function syncFile(filePath) {
  const handle = await open(filePath, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function validJsonFile(filePath, validate) {
  try {
    const raw = await readFile(filePath, "utf8");
    const value = JSON.parse(raw);
    if (validate) validate(value);
    return { value, raw };
  } catch {
    return null;
  }
}

async function rotateBackups(backupRoot, keep) {
  const names = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.includes("-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of names.slice(Math.max(1, keep))) await rm(join(backupRoot, name), { force: true });
}

/**
 * Persist a validated JSON document as a small transaction. The destination is
 * never opened for writing: a complete, fsynced sibling is verified and then
 * renamed into place. The previous valid document receives a unique backup
 * before the replacement, so a failed successor cannot erase history.
 */
export async function writeJsonDurable(filePath, value, options = {}) {
  const validate = options.validate;
  if (validate) validate(value);
  const serialized = JSON.stringify(value, null, 2);
  const transactionId = randomUUID();
  const directory = dirname(filePath);
  const backupRoot = options.backupRoot || join(directory, "backups");
  const temporaryPath = `${filePath}.tmp-${process.pid}-${transactionId}`;
  const journalPath = `${filePath}.txn.json`;
  await mkdir(directory, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  const journal = { transactionId, target: basename(filePath), checksum: digest(serialized), status: "BEGIN", startedAt: new Date().toISOString() };
  await writeFile(journalPath, JSON.stringify(journal), "utf8");
  await syncFile(journalPath);
  try {
    await writeFile(temporaryPath, serialized, "utf8");
    await syncFile(temporaryPath);
    const verification = await validJsonFile(temporaryPath, validate);
    if (!verification || digest(verification.raw) !== journal.checksum) throw Object.assign(new Error("A validação do arquivo temporário falhou."), { code: "DURABLE_JSON_VERIFY_FAILED" });

    const current = await validJsonFile(filePath, validate);
    if (current) {
      const backupPath = join(backupRoot, `${basename(filePath, ".json")}-${Date.now()}-${transactionId}.json`);
      await copyFile(filePath, backupPath);
      await syncFile(backupPath);
    }
    await rename(temporaryPath, filePath);
    journal.status = "COMMITTED";
    journal.committedAt = new Date().toISOString();
    await writeFile(journalPath, JSON.stringify(journal), "utf8");
    await syncFile(journalPath);
    await rm(journalPath, { force: true });
    await rotateBackups(backupRoot, Number.isInteger(options.keep) ? options.keep : 40);
    return { transactionId, checksum: journal.checksum, backedUp: Boolean(current) };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Read only a validated document. Corrupt JSON is never interpreted as an
 * empty state. A valid recent backup may be returned for explicit recovery.
 */
export async function readJsonDurable(filePath, options = {}) {
  const primary = await validJsonFile(filePath, options.validate);
  if (primary) return { value: primary.value, source: "primary", recovered: false };
  if (options.required !== false) {
    const backupRoot = options.backupRoot || join(dirname(filePath), "backups");
    let names = [];
    try { names = (await readdir(backupRoot)).filter((name) => name.endsWith(".json")).sort().reverse(); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    for (const name of names) {
      const candidate = await validJsonFile(join(backupRoot, name), options.validate);
      if (candidate) return { value: candidate.value, source: "backup", backupName: name, recovered: true };
    }
  }
  const error = Object.assign(new Error(`Persistência inválida ou ausente: ${filePath}`), { code: "PERSISTENCE_RECOVERY_REQUIRED", filePath });
  throw error;
}
