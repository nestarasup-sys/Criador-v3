import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BODY_LIMITS,
  IMAGE_MIME_TYPES,
  assertMimeType,
  contentTypeOf,
} from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";

export function createCreatorLibraryRoutes({
  catalogRoot,
  packsRoot,
  sendJson,
  requestBody,
  readMetadata,
  mutateState,
  persistState,
  getState,
  serveFile,
}) {
  async function handle(request, response, url) {
    const catalogMatch = url.pathname.match(/^\/catalog\/([a-zA-Z0-9_-]+)$/);
    if (catalogMatch && request.method === "POST") {
      const id = safeId(catalogMatch[1]);
      const metadata = { ...readMetadata(request), id };
      assertMimeType(
        contentTypeOf(request, metadata),
        IMAGE_MIME_TYPES,
        "O item do catálogo precisa ser PNG, JPEG ou WebP.",
      );
      const body = await requestBody(request, BODY_LIMITS.image);
      const filePath = join(catalogRoot, `${id}.png`);
      if (!inside(catalogRoot, filePath)) throw new Error("Destino inválido");

      await mutateState(async () => {
        const state = getState();
        await mkdir(catalogRoot, { recursive: true });
        await writeFile(filePath, body);
        state.catalog = [
          ...state.catalog.filter((item) => item.id !== id),
          metadata,
        ];
        await persistState();
      });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    if (catalogMatch && request.method === "DELETE") {
      const id = safeId(catalogMatch[1]);
      const filePath = join(catalogRoot, `${id}.png`);
      await mutateState(async () => {
        const state = getState();
        state.catalog = state.catalog.filter((item) => item.id !== id);
        await persistState();
        if (inside(catalogRoot, filePath)) {
          await rm(filePath, { force: true }).catch(() => undefined);
        }
      });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    const packFrameMatch = url.pathname.match(
      /^\/packs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/,
    );
    if (packFrameMatch && request.method === "POST") {
      const packId = safeId(packFrameMatch[1]);
      const key = safeId(packFrameMatch[2]);
      const metadata = readMetadata(request);
      assertMimeType(
        contentTypeOf(request, metadata),
        IMAGE_MIME_TYPES,
        "A expressão do pack precisa ser PNG, JPEG ou WebP.",
      );
      const body = await requestBody(request, BODY_LIMITS.image);
      const packFolder = join(packsRoot, packId);
      const filePath = join(packFolder, `${key}.png`);
      if (!inside(packsRoot, filePath)) throw new Error("Destino inválido");

      await mkdir(packFolder, { recursive: true });
      await mutateState(async () => {
        const state = getState();
        await writeFile(filePath, body);
        const existing = state.expressionPacks.find((pack) => pack.id === packId);
        const frame = {
          key,
          width: metadata.width,
          height: metadata.height,
        };
        const pack = {
          id: packId,
          name: metadata.name,
          model: metadata.model,
          basePackId: metadata.basePackId ?? "padrao",
          createdAt: metadata.createdAt,
          frames: [
            ...(existing?.frames ?? []).filter((item) => item.key !== key),
            frame,
          ],
        };
        state.expressionPacks = [
          ...state.expressionPacks.filter((item) => item.id !== packId),
          pack,
        ];
        await persistState();
      });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    if (packFrameMatch && request.method === "DELETE") {
      const packId = safeId(packFrameMatch[1]);
      const key = safeId(packFrameMatch[2]);
      const filePath = join(packsRoot, packId, `${key}.png`);
      if (!inside(packsRoot, filePath)) throw new Error("Destino inválido");

      await mutateState(async () => {
        const state = getState();
        const existing = state.expressionPacks.find((pack) => pack.id === packId);
        if (!existing) return;

        const frames = existing.frames.filter((item) => item.key !== key);
        state.expressionPacks = frames.length > 0
          ? [
              ...state.expressionPacks.filter((pack) => pack.id !== packId),
              { ...existing, frames },
            ]
          : state.expressionPacks.filter((pack) => pack.id !== packId);
        await persistState();
        await rm(filePath, { force: true }).catch(() => undefined);
      });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    const packMatch = url.pathname.match(/^\/packs\/([a-zA-Z0-9_-]+)$/);
    if (packMatch && request.method === "DELETE") {
      const packId = safeId(packMatch[1]);
      const packFolder = join(packsRoot, packId);
      await mutateState(async () => {
        const state = getState();
        state.expressionPacks = state.expressionPacks.filter((pack) => pack.id !== packId);
        await persistState();
        if (inside(packsRoot, packFolder)) {
          await rm(packFolder, { recursive: true, force: true }).catch(() => undefined);
        }
      });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    const catalogFileMatch = url.pathname.match(
      /^\/files\/catalog\/([a-zA-Z0-9_-]+)\.png$/,
    );
    if (catalogFileMatch && request.method === "GET") {
      const id = safeId(catalogFileMatch[1]);
      await serveFile(response, request, join(catalogRoot, `${id}.png`));
      return true;
    }

    const packFileMatch = url.pathname.match(
      /^\/files\/packs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.png$/,
    );
    if (packFileMatch && request.method === "GET") {
      const packId = safeId(packFileMatch[1]);
      const key = safeId(packFileMatch[2]);
      await serveFile(response, request, join(packsRoot, packId, `${key}.png`));
      return true;
    }

    return false;
  }

  return { handle };
}
