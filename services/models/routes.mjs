import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  assertModelExportSession,
  cancelModelExportSession,
  commitModelExportSession,
  createModelExportSession,
  modelExportPaths,
  nextModelNumber,
} from "./model-export-session.mjs";
import {
  MODEL_CATALOG_METADATA_FILE,
  readModelConfig,
} from "./model-discovery.mjs";
import { normalizeModelColorMapMetadata } from "../../app/domain/model-color-map.mjs";
import {
  BODY_LIMITS,
  assertMimeType,
  contentTypeOf,
} from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";

const PNG_MIME_TYPES = new Set(["image/png"]);
const JSON_MIME_TYPES = new Set(["application/json"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function invalidModelDestination() {
  return Object.assign(new Error("Destino do modelo inválido."), { status: 400 });
}

function validateModelFileName(fileName) {
  if (fileName.includes("..") || fileName.startsWith(".")) {
    throw Object.assign(new Error("Nome de arquivo inválido."), { status: 400 });
  }
}

async function assertModelFolder(modelsRoot, gender, modelId) {
  const folder = join(modelsRoot, gender, modelId);
  if (!inside(join(modelsRoot, gender), folder)) {
    throw Object.assign(new Error("Modelo inválido."), { status: 400 });
  }
  try {
    await stat(folder);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw Object.assign(new Error("Modelo não encontrado."), { status: 404 });
    }
    throw error;
  }
  return folder;
}

async function validateExpressionPng(body) {
  assertMimeType("image/png", PNG_MIME_TYPES, "As expressões do modelo precisam ser PNG.");
  const imageMetadata = await sharp(body).metadata();
  if (imageMetadata.width !== 1920 || imageMetadata.height !== 1080) {
    throw Object.assign(
      new Error("Cada expressão precisa ter exatamente 1920×1080 pixels."),
      { status: 400 },
    );
  }
}

export function createModelRoutes({
  modelsRoot,
  stagingRoot,
  sendJson,
  requestBody,
  requestJson,
  readOptionalJson,
  getCharacters,
}) {
  async function handle(request, response, url) {
    const nextModelMatch = url.pathname.match(/^\/models\/next\/(feminino|masculino)$/i);
    if (nextModelMatch && request.method === "GET") {
      const gender = nextModelMatch[1].toLowerCase();
      const number = await nextModelNumber({ modelsRoot, stagingRoot, gender });
      sendJson(response, request, 200, { gender, number, id: `modelo-${number}` });
      return true;
    }

    const modelColorMapMatch = url.pathname.match(
      /^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})\/color-map\/([a-zA-Z0-9_-]{1,120})$/i,
    );
    if (modelColorMapMatch && request.method === "POST") {
      const gender = modelColorMapMatch[1].toLowerCase();
      const modelId = safeId(modelColorMapMatch[2]);
      const expressionKey = safeId(modelColorMapMatch[3]);
      const folder = await assertModelFolder(modelsRoot, gender, modelId);
      assertMimeType(contentTypeOf(request), PNG_MIME_TYPES, "O mapa de cores precisa ser PNG.");
      const body = await requestBody(request, BODY_LIMITS.image);
      if (body.length < PNG_SIGNATURE.length || !body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("O mapa de cores precisa ser um PNG válido.");
      }
      const imageMetadata = await sharp(body).metadata();
      if (imageMetadata.width !== 1920 || imageMetadata.height !== 1080) {
        throw new Error("O mapa de cores precisa ter exatamente 1920×1080 pixels.");
      }
      const mapFolder = join(folder, "_color-maps");
      const filePath = join(mapFolder, `${expressionKey}.png`);
      if (!inside(folder, mapFolder) || !inside(mapFolder, filePath)) {
        throw new Error("Destino do mapa de cores inválido.");
      }
      await mkdir(mapFolder, { recursive: true });
      await writeFile(filePath, body);
      const { config: existingConfig, path: modelConfigPath } = await readModelConfig(folder, modelId);
      const previousMap = normalizeModelColorMapMetadata(existingConfig.colorMap);
      const expressions = [...new Set([...(previousMap?.expressions ?? []), expressionKey])].sort();
      await writeJsonAtomic(modelConfigPath, {
        ...existingConfig,
        colorMap: {
          version: 1,
          format: "rgb-weights",
          directory: "_color-maps",
          channels: { red: "pupils", green: "brows", blue: "skin" },
          expressions,
        },
      });
      sendJson(response, request, 200, {
        ok: true,
        gender,
        id: modelId,
        expressionKey,
        bytes: body.length,
        path: filePath,
      });
      return true;
    }

    const modelExportSessionMatch = url.pathname.match(
      /^\/models\/export-session\/(feminino|masculino)\/(modelo-[0-9]{1,5})(?:\/file\/([a-zA-Z0-9_.-]{1,160})|\/(commit))?$/i,
    );
    if (modelExportSessionMatch) {
      const gender = modelExportSessionMatch[1].toLowerCase();
      const modelId = safeId(modelExportSessionMatch[2]);
      const fileName = modelExportSessionMatch[3] || null;
      const commitAction = modelExportSessionMatch[4] === "commit";
      const { genderRoot, finalFolder, stagingFolder } = modelExportPaths(
        modelsRoot,
        stagingRoot,
        gender,
        modelId,
      );
      if (!inside(genderRoot, finalFolder) || !inside(stagingRoot, stagingFolder)) {
        throw invalidModelDestination();
      }

      if (request.method === "POST" && !fileName && !commitAction) {
        const options = await requestJson(request);
        if (options !== null && (typeof options !== "object" || typeof options.replaceExisting !== "boolean")) {
          throw Object.assign(
            new Error("Opção de exportação inválida."),
            { status: 400, code: "INVALID_EXPORT_SESSION_OPTIONS" },
          );
        }
        const replaceExisting = options?.replaceExisting === true;
        await createModelExportSession({
          modelsRoot,
          stagingRoot,
          gender,
          modelId,
          replaceExisting,
        });
        sendJson(response, request, 200, {
          ok: true,
          gender,
          id: modelId,
          replaced: replaceExisting,
        });
        return true;
      }

      if (request.method === "DELETE" && !fileName && !commitAction) {
        await cancelModelExportSession({ stagingRoot, gender, modelId });
        sendJson(response, request, 200, { ok: true, gender, id: modelId });
        return true;
      }

      if (request.method === "POST" && fileName) {
        validateModelFileName(fileName);
        await assertModelExportSession({ stagingRoot, gender, modelId });
        const filePath = join(stagingFolder, fileName);
        if (!inside(stagingFolder, filePath)) {
          throw Object.assign(new Error("Destino do arquivo inválido."), { status: 400 });
        }
        const isJson = fileName.toLowerCase() === `${modelId}.json`;
        const isPng = fileName.toLowerCase().endsWith(".png");
        if (!isJson && !isPng) {
          throw Object.assign(new Error("A exportação só aceita PNGs e o JSON do modelo."), { status: 415 });
        }
        const body = await requestBody(request, isJson ? BODY_LIMITS.json : BODY_LIMITS.image);
        if (isJson) {
          assertMimeType(contentTypeOf(request), JSON_MIME_TYPES, "O manifesto do modelo precisa ser JSON.");
          let manifest;
          try {
            manifest = JSON.parse(body.toString("utf8"));
          } catch {
            throw Object.assign(new Error("Manifesto de modelo inválido."), { status: 400 });
          }
          if (!Array.isArray(manifest?.expressionKeys) || manifest.expressionKeys.length !== 21) {
            throw Object.assign(
              new Error("O manifesto precisa declarar exatamente 21 expressões."),
              { status: 400, code: "INVALID_MODEL_EXPRESSIONS" },
            );
          }
          const expressionKeys = manifest.expressionKeys.map((key) => safeId(key));
          if (new Set(expressionKeys).size !== 21) {
            throw Object.assign(
              new Error("As 21 expressões do manifesto precisam ser únicas."),
              { status: 400, code: "INVALID_MODEL_EXPRESSIONS" },
            );
          }
          await writeJsonAtomic(filePath, {
            ...manifest,
            expressionKeys,
            gender,
            catalogVersion: "v1",
          });
        } else {
          assertMimeType(contentTypeOf(request), PNG_MIME_TYPES, "As expressões do modelo precisam ser PNG.");
          await validateExpressionPng(body);
          await writeFile(filePath, body);
        }
        sendJson(response, request, 200, { ok: true, gender, id: modelId, fileName });
        return true;
      }

      if (request.method === "POST" && commitAction) {
        const manifest = await readOptionalJson(join(stagingFolder, `${modelId}.json`));
        if (!manifest || !Array.isArray(manifest.expressionKeys) || manifest.expressionKeys.length !== 21) {
          throw Object.assign(
            new Error("A exportação está sem manifesto válido."),
            { status: 400, code: "INCOMPLETE_MODEL_EXPORT" },
          );
        }
        const keys = manifest.expressionKeys.map((key) => safeId(key));
        if (new Set(keys).size !== 21) {
          throw Object.assign(
            new Error("A exportação contém chaves de expressão duplicadas."),
            { status: 400, code: "INCOMPLETE_MODEL_EXPORT" },
          );
        }
        const expectedFiles = [
          `${modelId}.json`,
          ...keys.flatMap((key) => [
            `${key}.png`,
            `${key}_talk.png`,
            `${key}_blink.png`,
            `pt_${key}.png`,
            `pt_${key}_talk.png`,
            `pt_${key}_blink.png`,
          ]),
        ];
        const result = await commitModelExportSession({
          modelsRoot,
          stagingRoot,
          gender,
          modelId,
          expectedFiles,
        });
        sendJson(response, request, 200, {
          ok: true,
          gender,
          id: modelId,
          files: result.files,
          replaced: result.replaced,
        });
        return true;
      }
    }

    const modelImportMatch = url.pathname.match(
      /^\/models\/import\/(feminino|masculino)\/(modelo-[0-9]{1,5})\/([a-zA-Z0-9_.-]{1,160})$/i,
    );
    if (modelImportMatch && request.method === "POST") {
      const gender = modelImportMatch[1].toLowerCase();
      const modelId = safeId(modelImportMatch[2]);
      const fileName = modelImportMatch[3];
      validateModelFileName(fileName);
      const folder = join(modelsRoot, gender, modelId);
      const filePath = join(folder, fileName);
      if (!inside(join(modelsRoot, gender), folder) || !inside(folder, filePath)) {
        throw invalidModelDestination();
      }
      const isJson = fileName.toLowerCase() === `${modelId}.json`;
      const isPng = fileName.toLowerCase().endsWith(".png");
      if (!isJson && !isPng) {
        throw Object.assign(new Error("O exportador só aceita PNGs e o JSON do modelo."), { status: 415 });
      }
      const body = await requestBody(request, isJson ? BODY_LIMITS.json : BODY_LIMITS.image);
      if (isJson) {
        assertMimeType(contentTypeOf(request), JSON_MIME_TYPES, "O manifesto do modelo precisa ser JSON.");
        try {
          await stat(folder);
          throw Object.assign(
            new Error("Esse número de modelo já existe. Atualize a numeração automática e tente novamente."),
            { status: 409 },
          );
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        let manifest;
        try {
          manifest = JSON.parse(body.toString("utf8"));
        } catch {
          throw Object.assign(new Error("Manifesto de modelo inválido."), { status: 400 });
        }
        await mkdir(folder, { recursive: true });
        await writeJsonAtomic(filePath, { ...manifest, gender, catalogVersion: "v1" });
      } else {
        assertMimeType(contentTypeOf(request), PNG_MIME_TYPES, "As expressões do modelo precisam ser PNG.");
        await validateExpressionPng(body);
        await mkdir(folder, { recursive: true });
        await writeFile(filePath, body);
      }
      sendJson(response, request, 200, { ok: true, gender, id: modelId, fileName });
      return true;
    }

    const modelDeleteMatch = url.pathname.match(
      /^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})$/i,
    );
    if (modelDeleteMatch && request.method === "DELETE") {
      const gender = modelDeleteMatch[1].toLowerCase();
      const modelId = safeId(modelDeleteMatch[2]);
      const folder = await assertModelFolder(modelsRoot, gender, modelId);
      const referenced = getCharacters().some((character) =>
        String(character?.model || "").toLowerCase() === gender
        && String(character?.basePackId || "modelo-1") === modelId);
      if (referenced) {
        sendJson(response, request, 409, {
          error: "Este modelo está sendo usado por personagem(s). Troque o modelo dos personagens antes de excluí-lo.",
        });
        return true;
      }
      await rm(folder, { recursive: true, force: false });
      sendJson(response, request, 200, { ok: true, gender, id: modelId });
      return true;
    }

    const modelCatalogMatch = url.pathname.match(
      /^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})\/catalog$/i,
    );
    if (modelCatalogMatch && (request.method === "PATCH" || request.method === "POST")) {
      const gender = modelCatalogMatch[1].toLowerCase();
      const modelId = safeId(modelCatalogMatch[2]);
      const folder = await assertModelFolder(modelsRoot, gender, modelId);
      const body = await requestJson(request);
      if (body?.catalogVersion !== "v0" && body?.catalogVersion !== "v1") {
        throw Object.assign(new Error("Catálogo do modelo inválido."), { status: 400 });
      }
      const { config, path: configPath } = await readModelConfig(folder, modelId);
      await writeJsonAtomic(configPath, { ...config, catalogVersion: body.catalogVersion });
      await writeJsonAtomic(join(folder, MODEL_CATALOG_METADATA_FILE), {
        catalogVersion: body.catalogVersion,
        updatedAt: new Date().toISOString(),
      });
      sendJson(response, request, 200, {
        ok: true,
        gender,
        id: modelId,
        catalogVersion: body.catalogVersion,
      });
      return true;
    }

    return false;
  }

  return { handle };
}
