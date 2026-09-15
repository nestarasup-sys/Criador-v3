import type { Character } from "../domain/character-contract";

const DATABASE_NAME = "nymi-gacha-persistence";
const STORE_NAME = "characters";
const DATABASE_VERSION = 1;
const LEGACY_KEY = "gacha-maker-characters";

export type PersistenceResult = {
  status: "pc-saved" | "checkpointed" | "pending-sync";
  entityId: string;
  revision: number;
  savedAt: string;
};

export type PersistenceStage = "checkpoint" | "serialize" | "request" | "validate" | "commit" | "cleanup";

export class PersistenceError extends Error {
  code: string;
  entityType = "character";
  entityId?: string;
  stage: PersistenceStage;

  constructor(message: string, options: { code: string; entityId?: string; stage: PersistenceStage; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "PersistenceError";
    this.code = options.code;
    this.entityId = options.entityId;
    this.stage = options.stage;
  }
}

function durableCharacter(character: Character): Character {
  const { photoUrl: _photoUrl, photoDataUrl: _photoDataUrl, ...document } = character;
  void _photoUrl;
  void _photoDataUrl;
  return structuredClone(document) as Character;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new PersistenceError("IndexedDB não está disponível.", { code: "CHECKPOINT_UNAVAILABLE", stage: "checkpoint" }));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new PersistenceError("Não foi possível abrir o checkpoint do navegador.", { code: "CHECKPOINT_OPEN_FAILED", stage: "checkpoint", cause: request.error }));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new PersistenceError("O checkpoint do navegador foi cancelado.", { code: "CHECKPOINT_ABORTED", stage: "commit", cause: transaction.error }));
    transaction.onerror = () => reject(new PersistenceError("O checkpoint do navegador falhou.", { code: "CHECKPOINT_WRITE_FAILED", stage: "commit", cause: transaction.error }));
  });
}

export async function checkpointCharacter(character: Character): Promise<PersistenceResult> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(durableCharacter(character));
    await transactionDone(transaction);
    return {
      status: "checkpointed",
      entityId: character.id,
      revision: character.persistenceRevision ?? 0,
      savedAt: new Date().toISOString(),
    };
  } finally {
    database.close();
  }
}

export async function checkpointCharacters(characters: Character[]) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const character of characters) store.put(durableCharacter(character));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function readAllCheckpoints() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const characters = await new Promise<Character[]>((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as Character[] : []);
      request.onerror = () => reject(new PersistenceError("Não foi possível ler o checkpoint do navegador.", { code: "CHECKPOINT_READ_FAILED", stage: "checkpoint", cause: request.error }));
    });
    await transactionDone(transaction);
    return characters;
  } finally {
    database.close();
  }
}

function readLegacyCharacters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is Character => Boolean(item && typeof item.id === "string")) : [];
  } catch {
    return [];
  }
}

export async function loadCharacterCheckpoints() {
  const current = await readAllCheckpoints();
  if (current.length) return current;
  const legacy = readLegacyCharacters();
  if (!legacy.length) return [];
  await checkpointCharacters(legacy);
  const verified = await readAllCheckpoints();
  if (verified.length !== legacy.length) {
    throw new PersistenceError("A migração do checkpoint antigo não pôde ser verificada.", { code: "CHECKPOINT_MIGRATION_FAILED", stage: "validate" });
  }
  // O valor legado permanece intacto como recuperação. Novas gravações usam apenas IndexedDB.
  return verified;
}
