import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BODY_LIMITS,
  IMAGE_MIME_TYPES,
  assertMimeType,
  contentTypeOf,
} from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { printTimestamp, safePrintName } from "../storage/naming.mjs";

const PNG_MIME_TYPES = new Set(["image/png"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function createStudioRoutes({
  host,
  port,
  assetsRoot,
  printsRoot,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  corsHeaders,
  mutateState,
  persistState,
  getState,
  openFolder,
}) {
  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname === "/studios") {
      const studios = await requestJson(request);
      if (!Array.isArray(studios)) throw new Error("Lista de Studios inválida");

      await mutateState(async () => {
        const state = getState();
        state.studios = studios;

        const referencedAssets = new Set();
        for (const studio of studios) {
          if (studio?.background?.assetId) referencedAssets.add(studio.background.assetId);
          for (const object of Array.isArray(studio?.objects) ? studio.objects : []) {
            if (object?.assetId) referencedAssets.add(object.assetId);
          }
        }

        const orphanedAssets = state.studioAssets.filter((asset) => !referencedAssets.has(asset.id));
        state.studioAssets = state.studioAssets.filter((asset) => referencedAssets.has(asset.id));
        await persistState();

        for (const asset of orphanedAssets) {
          const filePath = join(assetsRoot, safeId(asset.id));
          if (inside(assetsRoot, filePath)) {
            await rm(filePath, { force: true }).catch(() => undefined);
          }
        }
      });

      sendJson(response, request, 200, { ok: true });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/prints") {
      const metadata = readMetadata(request);
      assertMimeType(contentTypeOf(request, metadata), PNG_MIME_TYPES, "O print precisa ser PNG.");
      const body = await requestBody(request, BODY_LIMITS.image);
      if (body.length < PNG_SIGNATURE.length || !body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("O print recebido não é um PNG válido");
      }

      const fileName = `${safePrintName(metadata.studioName)}_${printTimestamp()}.png`;
      const filePath = join(printsRoot, fileName);
      if (!inside(printsRoot, filePath)) throw new Error("Destino do print inválido");
      await mkdir(printsRoot, { recursive: true });
      await writeFile(filePath, body);

      sendJson(response, request, 200, {
        ok: true,
        fileName,
        filePath,
        bytes: body.length,
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/prints/open") {
      await mkdir(printsRoot, { recursive: true });
      await openFolder(printsRoot);
      sendJson(response, request, 200, { ok: true, folder: printsRoot });
      return true;
    }

    const studioAssetMatch = url.pathname.match(/^\/studio-assets\/([a-zA-Z0-9_-]+)$/);
    if (studioAssetMatch && request.method === "POST") {
      const id = safeId(studioAssetMatch[1]);
      const metadata = readMetadata(request);
      const contentType = contentTypeOf(request, metadata);
      assertMimeType(contentType, IMAGE_MIME_TYPES, "O asset do Studio precisa ser PNG, JPEG ou WebP.");
      const body = await requestBody(request, BODY_LIMITS.image);
      const filePath = join(assetsRoot, id);
      if (!inside(assetsRoot, filePath)) throw new Error("Destino inválido");

      await mutateState(async () => {
        const state = getState();
        await mkdir(assetsRoot, { recursive: true });
        await writeFile(filePath, body);
        state.studioAssets = [
          ...state.studioAssets.filter((asset) => asset.id !== id),
          {
            id,
            name: metadata.name ?? "Imagem",
            contentType: metadata.contentType ?? "application/octet-stream",
            ...(metadata.kind === "background" || metadata.kind === "object"
              ? { kind: metadata.kind }
              : {}),
          },
        ];
        await persistState();
      });

      sendJson(response, request, 200, {
        ok: true,
        fileUrl: `http://${host}:${port}/files/studio/${id}`,
      });
      return true;
    }

    if (studioAssetMatch && request.method === "DELETE") {
      const id = safeId(studioAssetMatch[1]);
      const filePath = join(assetsRoot, id);

      await mutateState(async () => {
        const state = getState();
        state.studioAssets = state.studioAssets.filter((asset) => asset.id !== id);
        await persistState();
        if (inside(assetsRoot, filePath)) {
          await rm(filePath, { force: true }).catch(() => undefined);
        }
      });

      sendJson(response, request, 200, { ok: true });
      return true;
    }

    const studioFileMatch = url.pathname.match(/^\/files\/studio\/([a-zA-Z0-9_-]+)$/);
    if (studioFileMatch && request.method === "GET") {
      const id = safeId(studioFileMatch[1]);
      const asset = getState().studioAssets.find((entry) => entry.id === id);
      if (!asset) {
        throw Object.assign(new Error("Imagem do Studio não encontrada"), { code: "ENOENT" });
      }

      const filePath = join(assetsRoot, id);
      if (!inside(assetsRoot, filePath)) throw new Error("Origem do Studio inválida");
      const bytes = await readFile(filePath);
      response.writeHead(200, {
        ...corsHeaders(request),
        "Content-Type": asset.contentType,
        "Content-Length": bytes.length,
        "Cache-Control": "no-store",
      });
      response.end(bytes);
      return true;
    }

    return false;
  }

  return { handle };
}
