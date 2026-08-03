import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const writeLocks = new Map();

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
      await rename(temporaryPath, filePath);
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
