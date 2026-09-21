import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const writeLocks = new Map();
const WINDOWS_RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function replaceWithRetry(source, destination) {
  let delay = 30;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!WINDOWS_RENAME_RETRY_CODES.has(error?.code) || attempt >= 8) throw error;
      // Windows can briefly keep a JSON file open while Explorer, Defender or
      // another local server releases its handle. Retrying preserves the
      // destination and avoids turning a transient lock into a startup crash.
      await wait(delay);
      delay = Math.min(delay * 2, 500);
    }
  }
}

/**
 * Writes JSON through a temporary file in the same directory and replaces the
 * destination only after the complete payload has been flushed by Node.
 * Keeping the temporary file beside the destination makes the rename atomic
 * on the local filesystems supported by the app (including Windows NTFS).
 */
export async function writeJsonAtomic(filePath, value) {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
      await replaceWithRetry(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });
  const tracked = operation.finally(() => {
    if (writeLocks.get(filePath) === tracked) writeLocks.delete(filePath);
  });
  writeLocks.set(filePath, tracked);
  return tracked;
}
