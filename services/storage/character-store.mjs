import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { writeJsonAtomic } from "./atomic-json.mjs";

const STORE_VERSION = 1;

function inside(parent, target) {
  return resolve(target).startsWith(resolve(parent) + sep);
}

function validId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
}

function storeError(message, code, status = 500) {
  return Object.assign(new Error(message), { code, status });
}

async function exists(filePath) {
  try { await stat(filePath); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function readJsonStrict(filePath, code) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw storeError(`JSON de personagens inválido em ${filePath}. O arquivo original foi preservado.`, code);
  }
}

function validateCharacters(value) {
  if (!Array.isArray(value)) throw storeError("A biblioteca de personagens não é uma lista.", "INVALID_CHARACTER_LIBRARY");
  const ids = new Set();
  return value.map((character) => {
    if (!character || typeof character !== "object" || !validId(character.id)) {
      throw storeError("A biblioteca contém um personagem sem ID válido.", "INVALID_CHARACTER");
    }
    if (ids.has(character.id)) throw storeError(`ID de personagem duplicado: ${character.id}`, "DUPLICATE_CHARACTER_ID");
    ids.add(character.id);
    return character;
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)]));
}

function sameCharacterContent(left, right) {
  const withoutRevision = (value) => {
    const copy = { ...value };
    delete copy.persistenceRevision;
    delete copy.updatedAt;
    return canonicalize(copy);
  };
  return JSON.stringify(withoutRevision(left)) === JSON.stringify(withoutRevision(right));
}

function summary(character, revision) {
  return {
    id: character.id,
    name: typeof character.name === "string" ? character.name : "Personagem",
    model: character.model === "masculino" ? "masculino" : "feminino",
    basePackId: typeof character.basePackId === "string" ? character.basePackId : "modelo-1",
    updatedAt: typeof character.updatedAt === "string" ? character.updatedAt : "",
    revision,
  };
}

export function createCharacterStore(root, options = {}) {
  const storeRoot = join(root, "character-store");
  const itemsRoot = join(storeRoot, "items");
  const backupsRoot = join(storeRoot, "backups");
  const indexPath = join(storeRoot, "index.json");
  const legacyPath = options.legacyPath ?? join(root, "characters.json");
  let index = { version: STORE_VERSION, characters: [] };
  let writeQueue = Promise.resolve();
  let lastBackupAt = 0;

  function itemPath(id) {
    const path = join(itemsRoot, `${id}.json`);
    if (!validId(id) || !inside(itemsRoot, path)) throw storeError("ID de personagem inválido.", "INVALID_CHARACTER", 400);
    return path;
  }

  async function writeIndex() {
    await writeJsonAtomic(indexPath, index);
  }

  async function backupIndexAndItem(id) {
    if (Date.now() - lastBackupAt < 5 * 60 * 1000) return;
    await mkdir(backupsRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (await exists(indexPath)) await copyFile(indexPath, join(backupsRoot, `index-${stamp}.json`));
    const path = itemPath(id);
    if (await exists(path)) await copyFile(path, join(backupsRoot, `${id}-${stamp}.json`));
    lastBackupAt = Date.now();
    const files = (await readdir(backupsRoot)).filter((name) => name.endsWith(".json")).sort();
    for (const name of files.slice(0, -40)) await rm(join(backupsRoot, name), { force: true });
  }

  async function migrate(initialCharacters) {
    let source = initialCharacters;
    if (await exists(legacyPath)) source = await readJsonStrict(legacyPath, "CORRUPT_LEGACY_CHARACTERS");
    const characters = validateCharacters(source ?? []);
    await mkdir(itemsRoot, { recursive: true });
    await mkdir(backupsRoot, { recursive: true });
    if (await exists(legacyPath)) {
      const migrationBackup = join(backupsRoot, "characters-before-item-store.json");
      if (!await exists(migrationBackup)) await copyFile(legacyPath, migrationBackup);
    }
    const entries = [];
    for (const character of characters) {
      const revision = 1;
      await writeJsonAtomic(itemPath(character.id), { version: STORE_VERSION, revision, character });
      const verified = await readJsonStrict(itemPath(character.id), "CORRUPT_CHARACTER_ITEM");
      if (verified?.character?.id !== character.id) throw storeError("A migração de personagens não pôde ser verificada.", "CHARACTER_MIGRATION_FAILED");
      entries.push(summary(character, revision));
    }
    index = { version: STORE_VERSION, characters: entries };
    await writeIndex();
  }

  async function loadIndex() {
    const parsed = await readJsonStrict(indexPath, "CORRUPT_CHARACTER_INDEX");
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.characters)) {
      throw storeError("Índice de personagens incompatível.", "INVALID_CHARACTER_INDEX");
    }
    const ids = new Set();
    for (const entry of parsed.characters) {
      if (!validId(entry?.id) || ids.has(entry.id)) throw storeError("Índice de personagens possui IDs inválidos ou duplicados.", "INVALID_CHARACTER_INDEX");
      ids.add(entry.id);
    }
    index = parsed;
  }

  async function quarantine(filePath, label) {
    const target = join(storeRoot, `${label}.corrupt-${Date.now()}.json`);
    try { await rename(filePath, target); return target; }
    catch { return null; }
  }

  async function rebuildIndexFromItems() {
    const entries = [];
    for (const name of (await readdir(itemsRoot)).filter((item) => item.endsWith(".json")).sort()) {
      const id = name.slice(0, -5);
      if (!validId(id)) continue;
      const character = await readCharacter(id);
      entries.push(summary(character, character.persistenceRevision));
    }
    if (!entries.length) throw storeError("Nenhum documento válido foi encontrado para reconstruir o índice.", "CHARACTER_RECOVERY_FAILED");
    index = { version: STORE_VERSION, characters: entries };
    await writeIndex();
  }

  async function recoverIndex() {
    await quarantine(indexPath, "index");
    const backups = (await readdir(backupsRoot)).filter((name) => name.startsWith("index-") && name.endsWith(".json")).sort().reverse();
    for (const name of backups) {
      try {
        const candidate = await readJsonStrict(join(backupsRoot, name), "CORRUPT_CHARACTER_INDEX_BACKUP");
        if (candidate?.version !== STORE_VERSION || !Array.isArray(candidate.characters)) continue;
        index = candidate;
        await Promise.all(index.characters.map((entry) => readCharacter(entry.id)));
        const current = await Promise.all(index.characters.map((entry) => readCharacter(entry.id)));
        index = { version: STORE_VERSION, characters: current.map((character) => summary(character, character.persistenceRevision)) };
        await writeIndex();
        return;
      } catch { /* tenta o backup anterior */ }
    }
    await rebuildIndexFromItems();
  }

  async function recoverCharacter(id) {
    const path = itemPath(id);
    await quarantine(path, id);
    const backups = (await readdir(backupsRoot)).filter((name) => name.startsWith(`${id}-`) && name.endsWith(".json") && !name.includes("deleted-")).sort().reverse();
    for (const name of backups) {
      try {
        const candidate = await readJsonStrict(join(backupsRoot, name), "CORRUPT_CHARACTER_BACKUP");
        if (candidate?.character?.id !== id || !Number.isInteger(candidate.revision)) continue;
        await writeJsonAtomic(path, candidate);
        return readCharacter(id);
      } catch { /* tenta o backup anterior */ }
    }
    throw storeError(`O personagem ${id} está corrompido e não possui backup válido. O original foi preservado em quarentena.`, "CHARACTER_RECOVERY_FAILED");
  }

  async function readCharacter(id) {
    const envelope = await readJsonStrict(itemPath(id), "CORRUPT_CHARACTER_ITEM");
    if (!envelope?.character || envelope.character.id !== id || !Number.isInteger(envelope.revision)) {
      throw storeError(`Documento inválido para o personagem ${id}.`, "INVALID_CHARACTER_ITEM");
    }
    return { ...envelope.character, persistenceRevision: envelope.revision };
  }

  return {
    async init(initialCharacters = []) {
      await mkdir(storeRoot, { recursive: true });
      await mkdir(itemsRoot, { recursive: true });
      await mkdir(backupsRoot, { recursive: true });
      if (await exists(indexPath)) {
        try { await loadIndex(); }
        catch { await recoverIndex(); }
      } else await migrate(initialCharacters);
      for (const entry of index.characters) {
        try { await readCharacter(entry.id); }
        catch { await recoverCharacter(entry.id); }
      }
    },

    listSummaries() { return structuredClone(index.characters); },

    async list() {
      return Promise.all(index.characters.map((entry) => readCharacter(entry.id)));
    },

    async get(id) {
      if (!index.characters.some((entry) => entry.id === id)) return null;
      return readCharacter(id);
    },

    save(character, expectedRevision = null) {
      const operation = writeQueue.catch(() => undefined).then(async () => {
        validateCharacters([character]);
        const current = index.characters.find((entry) => entry.id === character.id);
        if (expectedRevision !== null && current && expectedRevision !== current.revision) {
          const currentCharacter = await readCharacter(character.id);
          if (sameCharacterContent(currentCharacter, character)) {
            return { id: character.id, revision: current.revision, savedAt: currentCharacter.updatedAt ?? new Date().toISOString() };
          }
          throw storeError("O personagem foi alterado por uma gravação mais recente.", "STALE_CHARACTER_REVISION", 409);
        }
        await backupIndexAndItem(character.id);
        const revision = (current?.revision ?? 0) + 1;
        const { persistenceRevision: _revision, ...document } = character;
        void _revision;
        await writeJsonAtomic(itemPath(character.id), { version: STORE_VERSION, revision, character: document });
        const nextEntry = summary(document, revision);
        index = current
          ? { ...index, characters: index.characters.map((entry) => entry.id === character.id ? nextEntry : entry) }
          : { ...index, characters: [nextEntry, ...index.characters] };
        await writeIndex();
        return { id: character.id, revision, savedAt: new Date().toISOString() };
      });
      writeQueue = operation.then(() => undefined, () => undefined);
      return operation;
    },

    remove(id) {
      const operation = writeQueue.catch(() => undefined).then(async () => {
        const current = index.characters.find((entry) => entry.id === id);
        if (!current) return { id, removed: false };
        await backupIndexAndItem(id);
        index = { ...index, characters: index.characters.filter((entry) => entry.id !== id) };
        await writeIndex();
        const path = itemPath(id);
        const archived = join(backupsRoot, `${id}-deleted-${Date.now()}.json`);
        if (await exists(path)) await rename(path, archived);
        return { id, removed: true };
      });
      writeQueue = operation.then(() => undefined, () => undefined);
      return operation;
    },

    replaceAll(characters) {
      const operation = writeQueue.catch(() => undefined).then(async () => {
        const validated = validateCharacters(characters);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (await exists(indexPath)) await copyFile(indexPath, join(backupsRoot, `index-before-replace-${stamp}.json`));
        for (const character of validated) {
          const current = index.characters.find((entry) => entry.id === character.id);
          const revision = (current?.revision ?? 0) + 1;
          const { persistenceRevision: _revision, ...document } = character;
          void _revision;
          await writeJsonAtomic(itemPath(character.id), { version: STORE_VERSION, revision, character: document });
        }
        const incomingIds = new Set(validated.map((character) => character.id));
        const preservedEntries = index.characters.filter((entry) => !incomingIds.has(entry.id));
        // O endpoint de lista completa é usado por migração/importação. A
        // ausência de um item em um payload pode ser causada por um snapshot
        // parcial e não equivale a uma exclusão explícita. Remoções passam
        // pelo endpoint dedicado e deixam um backup próprio.
        index = { version: STORE_VERSION, characters: [
          ...validated.map((character) => summary(character, (index.characters.find((entry) => entry.id === character.id)?.revision ?? 0) + 1)),
          ...preservedEntries,
        ] };
        await writeIndex();
      });
      writeQueue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
