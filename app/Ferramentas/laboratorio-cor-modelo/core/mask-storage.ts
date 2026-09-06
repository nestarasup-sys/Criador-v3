import type { ColorLabMasks } from "../types";

type StoredMask = { key: string; masks: ColorLabMasks; savedAt: number };
const DB_NAME = "nymigacha-color-lab";
const STORE_NAME = "masks";
const VERSION = 1;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB indisponível.")); return; }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento."));
  });
}

export async function loadMaskRecords(prefix: string) {
  const database = await openDatabase();
  return new Promise<Record<string, ColorLabMasks>>((resolve, reject) => {
    const records: Record<string, ColorLabMasks> = {};
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { database.close(); resolve(records); return; }
      const value = cursor.value as StoredMask;
      if (value.key.startsWith(prefix)) records[value.key] = {
        pupils: new Uint8ClampedArray(value.masks.pupils),
        brows: new Uint8ClampedArray(value.masks.brows),
      };
      cursor.continue();
    };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function saveMaskRecord(key: string, masks: ColorLabMasks) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ key, masks, savedAt: Date.now() } satisfies StoredMask);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
