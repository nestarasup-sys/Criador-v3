import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { BODY_LIMITS, assertMimeType, contentTypeOf } from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { safeExportFolderName } from "../storage/naming.mjs";
import { runWithConcurrency } from "../runtime/concurrency.mjs";
import { insideOrSame } from "./export-filesystem.mjs";

const ZIP_MIME_TYPES = new Set(["application/zip", "application/x-zip-compressed"]);

export function createRoteiroExportRoutes({
  root,
  videosRoot,
  backgroundsRoot,
  baseDadosRoot,
  loadingAsset,
  exportTarget,
  projectRoot,
  videoExportRoot,
  backgroundExportRoot,
  characterExportRoot,
  uiExportRoot,
  writeExportManifest,
  findVideoReferenceFile,
  exportVideoAsset,
  sendJson,
  requestJson,
  requestBody,
  readMetadata,
}) {
  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname === "/roteiros/export-videos") {
      const body = await requestJson(request);
      const selectedTarget = exportTarget(body?.exportTarget);
      const exportRoot = videoExportRoot(body?.scriptTitle, selectedTarget.id);
      const scriptRoot = projectRoot(body?.scriptTitle, selectedTarget.id);
      const folder = exportRoot;
      if (!insideOrSame(exportRoot, folder)) throw new Error("Destino do roteiro inválido");

      const scriptId = safeId(body?.scriptId);
      const uiRoot = uiExportRoot(body?.scriptTitle, selectedTarget.id);
      await mkdir(folder, { recursive: true });
      await mkdir(uiRoot, { recursive: true });
      await copyFile(loadingAsset, join(uiRoot, "loading.gif"));
      await writeExportManifest(scriptRoot, scriptId, body?.scriptTitle, "project", selectedTarget.id);
      await writeExportManifest(folder, scriptId, body?.scriptTitle, "videos", selectedTarget.id);

      const tiktoks = Array.isArray(body?.tiktoks) ? body.tiktoks : [];
      const missing = [];
      let exported = 0;
      let converted = 0;
      let copied = 0;
      const conversionFallbacks = [];
      const audioRecoveries = [];
      const audioCopied = [];
      const relaxedVideoSettings = [];
      const descriptionLines = [];

      for (const [index, item] of tiktoks.entries()) {
        const number = String(index + 1).padStart(2, "0");
        const description = String(item?.description ?? "");
        const sceneEnd = Number.isFinite(Number(item?.sceneEndSeconds))
          ? `${Number(item.sceneEndSeconds)} segundos`
          : "não definido";
        const firstGroupReaction = Number.isFinite(Number(item?.firstGroupReactionSeconds))
          ? `${Number(item.firstGroupReactionSeconds)} segundos`
          : "não definido";
        const secondGroupReaction = Number.isFinite(Number(item?.secondGroupReactionSeconds))
          ? `${Number(item.secondGroupReactionSeconds)} segundos`
          : "não definido";
        const additionalAiContext = String(
          item?.video?.additionalAiContext ?? item?.additionalAiContext ?? "",
        );
        const duration = Number(item?.video?.durationSeconds) > 0
          ? `${Number(item.video.durationSeconds)} segundos`
          : "não disponível";
        descriptionLines.push(
          `${number}.mp4\nDescrição: ${description}\nDuração total do vídeo: ${duration}\nCena da descrição termina no segundo: ${sceneEnd}\nPrimeira reação em grupo pode começar no segundo: ${firstGroupReaction}\nSegunda reação em grupo pode começar no segundo: ${secondGroupReaction}\nContexto adicional para IA: ${additionalAiContext || "não informado"}\n`,
        );
      }

      const exportResults = await runWithConcurrency(tiktoks, 2, async (item, index) => {
        const number = String(index + 1).padStart(2, "0");
        const storedPath = String(item?.video?.storedPath || "").replace(/[\\/]+/g, sep);
        const source = item?.video
          ? await findVideoReferenceFile(item.video, scriptId, item.id).catch(() => null)
          : storedPath
            ? resolve(root, storedPath)
            : null;
        const destination = join(folder, `${number}.mp4`);
        if (
          !source
          || (!inside(videosRoot, source) && !inside(baseDadosRoot, source))
        ) {
          return { fileName: `${number}.mp4`, ok: false };
        }
        try {
          await stat(source);
          const result = await exportVideoAsset(source, destination);
          return { fileName: `${number}.mp4`, ok: true, ...result };
        } catch (error) {
          return {
            fileName: `${number}.mp4`,
            ok: false,
            error: error instanceof Error ? error.message : "falha desconhecida",
          };
        }
      });

      for (const result of exportResults) {
        if (!result.ok) {
          missing.push(result.fileName);
          continue;
        }
        exported += 1;
        if (result.mode === "converted") converted += 1;
        else copied += 1;
        if (result.encoder === "libx264" && result.mode === "converted") {
          conversionFallbacks.push(result.fileName);
        }
        if (result.audioRecovered) audioRecoveries.push(result.fileName);
        if (result.audioCopied) audioCopied.push(result.fileName);
        if (result.relaxedVideoSettings) relaxedVideoSettings.push(result.fileName);
      }

      const descriptionFile = join(folder, "descricoes.txt");
      await writeFile(descriptionFile, descriptionLines.join("\n"), "utf8");
      sendJson(response, request, 200, {
        ok: true,
        folder: scriptRoot,
        exported,
        copied,
        converted,
        missing,
        conversionFallbacks,
        audioRecoveries,
        audioCopied,
        relaxedVideoSettings,
        descriptionFile,
        loadingFile: join(uiRoot, "loading.gif"),
        exportTarget: selectedTarget.id,
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/roteiros/export-background") {
      const body = await requestJson(request);
      const selectedTarget = exportTarget(body?.exportTarget);
      const exportRoot = backgroundExportRoot(body?.scriptTitle, selectedTarget.id);
      const folder = exportRoot;
      if (!insideOrSame(exportRoot, folder)) throw new Error("Destino do fundo inválido");

      const scriptId = safeId(body?.scriptId);
      const sourceFolder = join(backgroundsRoot, scriptId);
      const sourceFiles = await readdir(sourceFolder);
      const sourceName = sourceFiles.find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));
      if (!sourceName) {
        throw Object.assign(new Error("Este roteiro não possui fundo salvo."), { status: 404 });
      }

      const extension = extname(sourceName).toLowerCase() || ".png";
      await mkdir(folder, { recursive: true });
      await writeExportManifest(
        projectRoot(body?.scriptTitle, selectedTarget.id),
        scriptId,
        body?.scriptTitle,
        "project",
        selectedTarget.id,
      );
      await writeExportManifest(
        folder,
        scriptId,
        body?.scriptTitle,
        "backgrounds",
        selectedTarget.id,
      );
      for (const oldExtension of [".png", ".jpg", ".jpeg", ".webp"]) {
        await rm(join(folder, `01${oldExtension}`), { force: true });
      }
      const destination = join(folder, `01${extension}`);
      await copyFile(join(sourceFolder, sourceName), destination);
      const fileName = destination.split(sep).pop();
      sendJson(response, request, 200, {
        ok: true,
        folder,
        path: destination,
        relativePath: `assets/backgrounds/${fileName}`,
        fileName,
        exportTarget: selectedTarget.id,
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/roteiros/export-text") {
      const body = await requestJson(request);
      const selectedTarget = exportTarget(body?.exportTarget);
      const exportRoot = projectRoot(body?.scriptTitle, selectedTarget.id);
      const folder = exportRoot;
      if (!insideOrSame(exportRoot, folder)) throw new Error("Destino do roteiro inválido");

      const scriptId = safeId(body?.scriptId);
      await mkdir(folder, { recursive: true });
      await writeExportManifest(
        folder,
        scriptId,
        body?.scriptTitle,
        "text",
        selectedTarget.id,
      );
      const filePath = join(folder, "roteiro.txt");
      await writeFile(filePath, String(body?.content || ""), "utf8");
      sendJson(response, request, 200, {
        ok: true,
        path: filePath,
        fileName: "roteiro.txt",
        exportTarget: selectedTarget.id,
      });
      return true;
    }

    const characterMatch = url.pathname.match(
      /^\/roteiros\/export-characters\/([a-zA-Z0-9_-]+)$/,
    );
    if (characterMatch && request.method === "POST") {
      const exportStartedAt = performance.now();
      let phaseStartedAt = exportStartedAt;
      const timings = {
        requestBodyMs: 0,
        zipParseMs: 0,
        extractWriteMs: 0,
        publishMs: 0,
        totalMs: 0,
      };

      const characterId = safeId(characterMatch[1]);
      const metadata = readMetadata(request);
      assertMimeType(
        contentTypeOf(request, metadata),
        ZIP_MIME_TYPES,
        "O pacote do personagem precisa ser ZIP.",
      );
      const body = await requestBody(request, BODY_LIMITS.zip);
      timings.requestBodyMs = performance.now() - phaseStartedAt;
      if (!body.length) throw new Error("ZIP do personagem vazio");

      const selectedTarget = exportTarget(metadata.exportTarget);
      const exportRoot = characterExportRoot(metadata.scriptTitle, selectedTarget.id);
      const scriptId = safeId(metadata.scriptId);
      const characterFolderName = safeExportFolderName(
        metadata.characterName || characterId,
        characterId,
      );
      const scriptFolder = projectRoot(metadata.scriptTitle || "Roteiro", selectedTarget.id);
      const folder = join(exportRoot, characterFolderName);
      if (!inside(exportRoot, folder)) throw new Error("Destino do personagem inválido");

      phaseStartedAt = performance.now();
      const zip = await JSZip.loadAsync(body);
      timings.zipParseMs = performance.now() - phaseStartedAt;
      const exportEntries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
      if (!exportEntries.length) throw new Error("ZIP sem arquivos exportáveis");

      const stagingFolder = join(
        exportRoot,
        `.nymi-character-staging-${characterId}-${randomBytes(8).toString("hex")}`,
      );
      const previousFolder = join(
        exportRoot,
        `.nymi-character-previous-${characterId}-${randomBytes(8).toString("hex")}`,
      );
      if (!inside(exportRoot, stagingFolder) || !inside(exportRoot, previousFolder)) {
        throw new Error("Pasta temporária de exportação inválida");
      }

      let files = 0;
      let previousMoved = false;
      let promoted = false;
      try {
        phaseStartedAt = performance.now();
        await mkdir(stagingFolder, { recursive: true });
        const written = await runWithConcurrency(
          exportEntries,
          2,
          async ([zipName, entry]) => {
            const segments = String(zipName).split(/[\\/]/).filter(Boolean);
            if (!segments.length) return false;
            const relativeSegments = segments.length > 1 ? segments.slice(1) : segments;
            const target = join(stagingFolder, ...relativeSegments);
            if (!inside(stagingFolder, target)) {
              throw new Error("Arquivo ZIP fora da pasta permitida");
            }
            await mkdir(resolve(target, ".."), { recursive: true });
            await writeFile(target, await entry.async("nodebuffer"));
            return true;
          },
        );
        files = written.filter(Boolean).length;
        timings.extractWriteMs = performance.now() - phaseStartedAt;
        if (!files) throw new Error("ZIP sem arquivos exportáveis");

        phaseStartedAt = performance.now();
        await stat(stagingFolder);
        try {
          await rename(folder, previousFolder);
          previousMoved = true;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }

        try {
          await rename(stagingFolder, folder);
        } catch (error) {
          if (previousMoved) await rename(previousFolder, folder).catch(() => undefined);
          throw error;
        }
        promoted = true;

        await writeExportManifest(
          scriptFolder,
          scriptId,
          metadata.scriptTitle,
          "characters",
          selectedTarget.id,
        );
        if (previousMoved) {
          await rm(previousFolder, { recursive: true, force: true });
        }
        timings.publishMs = performance.now() - phaseStartedAt;
      } catch (error) {
        await rm(stagingFolder, { recursive: true, force: true }).catch(() => undefined);
        if (previousMoved) {
          if (promoted) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
          await rename(previousFolder, folder).catch(() => undefined);
        }
        throw error;
      }

      timings.totalMs = performance.now() - exportStartedAt;
      const roundedTimings = Object.fromEntries(
        Object.entries(timings).map(([key, value]) => [
          key,
          Math.round(value * 100) / 100,
        ]),
      );
      sendJson(response, request, 200, {
        ok: true,
        characterId,
        folder,
        files,
        bytes: body.length,
        timings: roundedTimings,
        exportTarget: selectedTarget.id,
      });
      return true;
    }

    return false;
  }

  return { handle };
}
