import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeCharacterDocument } from "../../app/domain/document-schemas.mjs";
import { BODY_LIMITS, assertMimeType, contentTypeOf } from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";

const PNG_MIME_TYPES = new Set(["image/png"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function createCharacterRoutes({
  host,
  port,
  photosRoot,
  characterStore,
  sendJson,
  requestBody,
  requestJson,
  mutateState,
  loadCharacters,
  getCharacters,
  setCharacters,
  clearLegacyCharacters,
}) {
  const photoQueues = new Map();

  async function handle(request, response, url) {
    const photoMatch = url.pathname.match(/^\/characters\/([a-zA-Z0-9_-]{1,120})\/photo$/);
    if (photoMatch && request.method === "POST") {
      const characterId = safeId(photoMatch[1]);
      assertMimeType(contentTypeOf(request), PNG_MIME_TYPES, "A foto do personagem precisa ser PNG.");
      const body = await requestBody(request, BODY_LIMITS.photo);
      if (body.length < PNG_SIGNATURE.length || !body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("A foto do personagem precisa ser um PNG válido");
      }
      const filePath = join(photosRoot, `${characterId}.png`);
      if (!inside(photosRoot, filePath)) throw new Error("Destino da foto inválido");

      await mkdir(photosRoot, { recursive: true });
      const previous = photoQueues.get(characterId) ?? Promise.resolve();
      const writeOperation = previous.catch(() => undefined).then(() => writeFile(filePath, body));
      photoQueues.set(characterId, writeOperation);
      try {
        await writeOperation;
      } finally {
        if (photoQueues.get(characterId) === writeOperation) photoQueues.delete(characterId);
      }

      sendJson(response, request, 200, {
        ok: true,
        photoUrl: `http://${host}:${port}/files/characters/${characterId}/photo.png`,
        bytes: body.length,
      });
      return true;
    }

    const characterItemMatch = url.pathname.match(/^\/characters\/([a-zA-Z0-9_-]{1,120})$/);
    if (request.method === "GET" && url.pathname === "/characters") {
      sendJson(response, request, 200, { characters: characterStore.listSummaries() });
      return true;
    }

    if (characterItemMatch && request.method === "GET") {
      const characterId = safeId(characterItemMatch[1]);
      const storedCharacter = await characterStore.get(characterId);
      const character = storedCharacter ? normalizeCharacterDocument(storedCharacter) : null;
      if (!character) {
        throw Object.assign(
          new Error("Personagem não encontrado."),
          { status: 404, code: "CHARACTER_NOT_FOUND" },
        );
      }
      sendJson(response, request, 200, { character });
      return true;
    }

    if (characterItemMatch && request.method === "PUT") {
      const characterId = safeId(characterItemMatch[1]);
      const character = await requestJson(request);
      if (!character || typeof character !== "object" || String(character.id || "") !== characterId) {
        throw Object.assign(new Error("Personagem inválido."), { status: 400, code: "INVALID_CHARACTER" });
      }
      await mutateState(async () => {
        const expectedRevision = Number.isInteger(character.persistenceRevision)
          ? character.persistenceRevision
          : null;
        await characterStore.save(character, expectedRevision);
        setCharacters(await loadCharacters());
      });
      const savedCharacter = getCharacters().find((entry) => entry.id === characterId);
      sendJson(response, request, 200, {
        ok: true,
        id: characterId,
        revision: savedCharacter?.persistenceRevision ?? null,
        savedAt: new Date().toISOString(),
      });
      return true;
    }

    if (characterItemMatch && request.method === "DELETE") {
      const characterId = safeId(characterItemMatch[1]);
      await mutateState(async () => {
        await characterStore.remove(characterId);
        setCharacters(await loadCharacters());
      });
      await rm(join(photosRoot, `${characterId}.png`), { force: true }).catch(() => undefined);
      sendJson(response, request, 200, { ok: true, id: characterId });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/characters") {
      const nextCharacters = await requestJson(request, BODY_LIMITS.characters);
      if (!Array.isArray(nextCharacters)) throw new Error("Lista de personagens inválida");

      await mutateState(async () => {
        await characterStore.replaceAll(nextCharacters);
        setCharacters(await loadCharacters());

        const knownCharacterIds = new Set(
          nextCharacters.map((character) => String(character?.id || "")),
        );
        for (const entry of await readdir(photosRoot, { withFileTypes: true })) {
          if (
            entry.isFile()
            && entry.name.endsWith(".png")
            && !knownCharacterIds.has(entry.name.slice(0, -4))
          ) {
            await rm(join(photosRoot, entry.name), { force: true });
          }
        }
        clearLegacyCharacters();
      });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    return false;
  }

  return {
    handle,
    pendingPhotoWrites: () => photoQueues.size,
  };
}
