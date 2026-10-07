import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import {
  BODY_LIMITS,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  assertMimeType,
  contentTypeOf,
} from "../security/local-security.mjs";
import { probeVideoDuration } from "../media/video-metadata.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { ROTEIRO_VIDEO_EXTENSIONS, insideOrSame } from "./export-filesystem.mjs";

export function createRoteiroMediaRoutes({
  host,
  port,
  backgroundsRoot,
  videosRoot,
  baseDadosRoot,
  baseDadosService,
  roteirosService,
  exportTarget,
  projectRoot,
  characterExportRoot,
  backgroundExportRoot,
  videoExportRoot,
  findVideoReferenceFile,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  serveFile,
}) {
  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname === "/roteiros/open-folder") {
      const body = await requestJson(request);
      const target = String(body?.target || "script");
      const selectedTarget = exportTarget(body?.exportTarget);
      const scriptRoot = projectRoot(body?.scriptTitle, selectedTarget.id);
      const characterRoot = characterExportRoot(body?.scriptTitle, selectedTarget.id);
      const backgroundRoot = backgroundExportRoot(body?.scriptTitle, selectedTarget.id);
      const videoRoot = videoExportRoot(body?.scriptTitle, selectedTarget.id);
      const folder = target === "characters"
        ? characterRoot
        : target === "videos"
          ? videoRoot
          : target === "background"
            ? backgroundRoot
            : scriptRoot;
      const allowedRoot = target === "characters"
        ? characterRoot
        : target === "videos"
          ? videoRoot
          : target === "background"
            ? backgroundRoot
            : scriptRoot;

      if (!["characters", "videos", "script", "background"].includes(target)) {
        throw new Error("Tipo de pasta inválido");
      }
      if (!insideOrSame(allowedRoot, folder)) throw new Error("Destino da pasta inválido");

      await mkdir(folder, { recursive: true });
      const explorer = spawn(
        "explorer.exe",
        ["/root,", folder],
        { detached: true, stdio: "ignore", windowsHide: false },
      );
      explorer.on("error", () => undefined);
      explorer.unref();
      sendJson(response, request, 200, {
        ok: true,
        folder,
        exportTarget: selectedTarget.id,
      });
      return true;
    }

    const backgroundMatch = url.pathname.match(
      /^\/roteiros\/backgrounds\/([a-zA-Z0-9_-]+)$/,
    );
    if (backgroundMatch && request.method === "POST") {
      const scriptId = safeId(backgroundMatch[1]);
      const metadata = readMetadata(request);
      const contentType = contentTypeOf(request, metadata);
      assertMimeType(contentType, IMAGE_MIME_TYPES, "O fundo precisa ser PNG, JPEG ou WebP.");
      const fileName = String(metadata.name || "background.png");
      const extension = extname(fileName).toLowerCase();
      const body = await requestBody(request, BODY_LIMITS.image);
      if (!body.length) throw new Error("Imagem de fundo vazia");

      const folder = join(backgroundsRoot, scriptId);
      const normalizedExtension = [".jpg", ".jpeg", ".webp"].includes(extension)
        ? extension
        : ".png";
      const filePath = join(folder, `background${normalizedExtension}`);
      if (!inside(backgroundsRoot, filePath)) throw new Error("Destino do fundo inválido");

      await mkdir(folder, { recursive: true });
      await writeFile(filePath, body);
      sendJson(response, request, 200, {
        ok: true,
        background: {
          name: fileName,
          storedPath: `roteiros/backgrounds/${scriptId}/${filePath.split(sep).pop()}`,
          url: `http://${host}:${port}/roteiros/backgrounds/${scriptId}`,
          contentType,
          size: body.length,
          updatedAt: new Date().toISOString(),
        },
      });
      return true;
    }

    if (backgroundMatch && request.method === "GET") {
      const scriptId = safeId(backgroundMatch[1]);
      const folder = join(backgroundsRoot, scriptId);
      const files = await readdir(folder);
      const fileName = files.find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));
      if (!fileName) {
        throw Object.assign(new Error("Fundo não encontrado"), { code: "ENOENT" });
      }
      await serveFile(response, request, join(folder, fileName));
      return true;
    }

    if (request.method === "POST" && url.pathname === "/roteiros/import-base-video") {
      const body = await requestJson(request);
      safeId(body?.scriptId);
      safeId(body?.tiktokId);
      const videoId = safeId(body?.videoId);
      const sourceVideo = baseDadosService.getVideo(videoId);
      if (!sourceVideo) {
        throw Object.assign(new Error("Vídeo da Base de dados não encontrado."), { status: 404 });
      }
      const extension = extname(sourceVideo.fileName).toLowerCase() || ".mp4";
      if (
        !VIDEO_MIME_TYPES.has(sourceVideo.contentType)
        || ![".mp4", ".webm", ".mov"].includes(extension)
      ) {
        throw new Error("Formato de vídeo não suportado para importação.");
      }
      const source = join(baseDadosRoot, "videos", sourceVideo.fileName);
      if (!inside(baseDadosRoot, source)) throw new Error("Origem do vídeo inválida.");
      await stat(source);

      sendJson(response, request, 200, {
        ok: true,
        video: {
          name: sourceVideo.originalName,
          storedPath: sourceVideo.storedPath,
          url: `http://${host}:${port}/base-dados/videos/${sourceVideo.id}`,
          contentType: sourceVideo.contentType,
          size: sourceVideo.size,
          durationSeconds: sourceVideo.durationSeconds,
          additionalAiContext: sourceVideo.additionalAiContext,
          libraryVideoId: sourceVideo.id,
          contentHash: sourceVideo.contentHash,
          updatedAt: new Date().toISOString(),
        },
      });
      return true;
    }

    const videoMatch = url.pathname.match(
      /^\/roteiros\/videos\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/,
    );
    if (videoMatch && request.method === "POST") {
      const scriptId = safeId(videoMatch[1]);
      const tiktokId = safeId(videoMatch[2]);
      const metadata = readMetadata(request);
      const contentType = contentTypeOf(request, metadata) || "video/mp4";
      assertMimeType(
        contentType,
        VIDEO_MIME_TYPES,
        "O arquivo do TikTok precisa ser MP4, WebM ou MOV.",
      );
      const fileName = String(metadata.name || "video.mp4");
      if (!/\.(?:mp4|webm|mov)$/i.test(fileName)) {
        throw new Error("O nome do vídeo precisa terminar em .mp4, .webm ou .mov.");
      }
      const extension = extname(fileName).toLowerCase();
      const body = await requestBody(request, BODY_LIMITS.video);
      if (!body.length) throw new Error("Vídeo vazio");

      const folder = join(videosRoot, scriptId);
      const filePath = join(folder, `${tiktokId}${extension}`);
      if (!inside(videosRoot, filePath)) throw new Error("Destino do vídeo inválido");

      await mkdir(folder, { recursive: true });
      await Promise.all(
        ROTEIRO_VIDEO_EXTENSIONS
          .filter((candidate) => candidate !== extension)
          .map((candidate) => rm(join(folder, `${tiktokId}${candidate}`), { force: true })),
      );
      await writeFile(filePath, body);
      const durationSeconds = await probeVideoDuration(filePath);

      sendJson(response, request, 200, {
        ok: true,
        video: {
          name: fileName,
          storedPath: `roteiros/videos/${scriptId}/${tiktokId}${extension}`,
          url: `http://${host}:${port}/roteiros/videos/${scriptId}/${tiktokId}`,
          contentType,
          size: body.length,
          ...(durationSeconds === null ? {} : { durationSeconds }),
          updatedAt: new Date().toISOString(),
        },
      });
      return true;
    }

    if (videoMatch && request.method === "GET") {
      const scriptId = safeId(videoMatch[1]);
      const tiktokId = safeId(videoMatch[2]);
      const script = roteirosService.getScript(scriptId);
      const section = script?.tiktoks?.find((item) => item.id === tiktokId);
      const filePath = await findVideoReferenceFile(section?.video, scriptId, tiktokId);
      await serveFile(response, request, filePath);
      return true;
    }

    if (videoMatch && request.method === "DELETE") {
      const scriptId = safeId(videoMatch[1]);
      const tiktokId = safeId(videoMatch[2]);
      const script = roteirosService.getScript(scriptId);
      const section = script?.tiktoks?.find((item) => item.id === tiktokId);
      if (!section?.video?.libraryVideoId) {
        await Promise.all(
          ROTEIRO_VIDEO_EXTENSIONS.map((extension) =>
            rm(join(videosRoot, scriptId, `${tiktokId}${extension}`), { force: true })),
        );
      }
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    return false;
  }

  return { handle };
}
