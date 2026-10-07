import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BODY_LIMITS, VIDEO_MIME_TYPES, assertMimeType, contentTypeOf } from "../security/local-security.mjs";
import { inside, safeId } from "../storage/path-safety.mjs";
import { printTimestamp, safePrintName } from "../storage/naming.mjs";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";

const PNG_TYPES = new Set(["image/png"]);
const EXPORT_TYPES = new Set(["video/webm", "video/mp4", "application/octet-stream"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function runProcess(command, args, fallback) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-800) || fallback)));
  });
}

export function createVideoMakerService({
  host,
  port,
  charactersRoot,
  tiktoksRoot,
  projectsRoot,
  exportsRoot,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  serveFile,
}) {
  async function initialize() {
    await Promise.all([
      mkdir(charactersRoot, { recursive: true }),
      mkdir(tiktoksRoot, { recursive: true }),
      mkdir(projectsRoot, { recursive: true }),
      mkdir(exportsRoot, { recursive: true }),
    ]);
  }

  async function handle(request, response, url) {
    const manifestMatch = url.pathname.match(/^\/video-maker\/characters\/([a-zA-Z0-9_-]+)\/manifest$/);
    if (manifestMatch && request.method === "POST") {
      const characterId = safeId(manifestMatch[1]);
      const manifest = await requestJson(request);
      if (manifest?.format !== "gacha-premium.character-bundle") throw new Error("Manifesto de personagem do Video Maker inválido");
      if (manifest?.assetMode !== "flattened-expression-frames") throw new Error("O Video Maker aceita somente pacotes achatados de expressões");
      const folder = join(charactersRoot, characterId);
      if (!inside(charactersRoot, folder)) throw new Error("Destino inválido");
      await mkdir(folder, { recursive: true });
      await writeJsonAtomic(join(folder, "manifest.json"), manifest);
      sendJson(response, request, 200, { ok: true, characterId });
      return true;
    }

    const frameMatch = url.pathname.match(/^\/video-maker\/characters\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (frameMatch && request.method === "POST") {
      const characterId = safeId(frameMatch[1]);
      const frameKey = safeId(frameMatch[2]);
      assertMimeType(contentTypeOf(request), PNG_TYPES, "A expressão enviada precisa ser PNG.");
      const body = await requestBody(request, BODY_LIMITS.image);
      if (body.length < PNG_SIGNATURE.length || !body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("A expressão enviada não é um PNG válido");
      }
      const folder = join(charactersRoot, characterId);
      const filePath = join(folder, `${frameKey}.png`);
      if (!inside(charactersRoot, filePath)) throw new Error("Destino inválido");
      await mkdir(folder, { recursive: true });
      await writeFile(filePath, body);
      sendJson(response, request, 200, { ok: true, characterId, frameKey });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/video-maker/characters") {
      const entries = (await readdir(charactersRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name));
      const characters = [];
      for (const entry of entries) {
        const manifest = await readOptionalJson(join(charactersRoot, entry.name, "manifest.json"));
        if (!manifest) continue;
        const frameUrls = Object.fromEntries(Object.keys(manifest.frames ?? {}).map((key) => [
          key,
          `http://${host}:${port}/files/video-maker/characters/${entry.name}/${encodeURIComponent(key)}`,
        ]));
        characters.push({ ...manifest, characterId: entry.name, frameUrls });
      }
      sendJson(response, request, 200, { characters });
      return true;
    }

    const tiktokMatch = url.pathname.match(/^\/video-maker\/tiktoks\/([a-zA-Z0-9_-]+)$/);
    if (tiktokMatch && request.method === "POST") {
      const tiktokId = safeId(tiktokMatch[1]);
      const metadata = readMetadata(request);
      const body = await requestBody(request, BODY_LIMITS.video);
      if (!body.length) throw new Error("TikTok vazio");
      const contentType = contentTypeOf(request, metadata) || "video/mp4";
      assertMimeType(contentType, VIDEO_MIME_TYPES, "O arquivo do TikTok precisa ser MP4, WebM ou MOV.");
      const hash = createHash("sha256").update(body).digest("hex");
      const folder = join(tiktoksRoot, tiktokId);
      if (!inside(tiktoksRoot, folder)) throw new Error("Destino inválido");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "video.mp4"), body);
      await writeJsonAtomic(join(folder, "manifest.json"), {
        tiktokId,
        name: String(metadata.name || "TikTok"),
        path: `video-maker/tiktoks/${tiktokId}/video.mp4`,
        url: `http://${host}:${port}/files/video-maker/tiktoks/${tiktokId}`,
        audio: metadata.audio !== false,
        hash,
        duration: Number(metadata.duration) > 0 ? Number(metadata.duration) : undefined,
        contentType,
        createdAt: metadata.createdAt || new Date().toISOString(),
      });
      sendJson(response, request, 200, { ok: true, tiktokId, hash });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/video-maker/tiktoks") {
      const entries = (await readdir(tiktoksRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name));
      const tiktoks = [];
      for (const entry of entries) {
        const manifest = await readOptionalJson(join(tiktoksRoot, entry.name, "manifest.json"));
        if (manifest) tiktoks.push(manifest);
      }
      tiktoks.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      sendJson(response, request, 200, { tiktoks });
      return true;
    }

    const projectMatch = url.pathname.match(/^\/video-maker\/projects(?:\/([a-zA-Z0-9_-]+))?$/);
    if (projectMatch && request.method === "POST") {
      const projectId = safeId(projectMatch[1] || `project-${Date.now()}`);
      const project = await requestJson(request);
      if (project?.format !== "gacha-premium.video-project" || project?.version !== 1) throw new Error("Projeto do Video Maker inválido");
      const folder = join(projectsRoot, projectId);
      if (!inside(projectsRoot, folder)) throw new Error("Destino inválido");
      await mkdir(folder, { recursive: true });
      const currentPath = join(folder, "project.json");
      try {
        await stat(currentPath);
        await copyFile(currentPath, join(folder, `project.backup-${printTimestamp()}.json`));
        const history = (await readdir(folder)).filter((name) => name.startsWith("project.backup-") && name.endsWith(".json")).sort();
        for (const oldName of history.slice(0, -12)) await rm(join(folder, oldName), { force: true });
      } catch (error) { if (error?.code !== "ENOENT") throw error; }
      await writeJsonAtomic(currentPath, project);
      sendJson(response, request, 200, { ok: true, projectId, project });
      return true;
    }

    if (projectMatch && request.method === "GET") {
      if (projectMatch[1]) {
        const projectId = safeId(projectMatch[1]);
        const project = await readOptionalJson(join(projectsRoot, projectId, "project.json"));
        if (!project) throw Object.assign(new Error("Projeto não encontrado"), { code: "ENOENT" });
        sendJson(response, request, 200, { projectId, project });
        return true;
      }
      const entries = (await readdir(projectsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name));
      const projects = [];
      for (const entry of entries) {
        const project = await readOptionalJson(join(projectsRoot, entry.name, "project.json"));
        if (project) projects.push({ projectId: entry.name, project });
      }
      projects.sort((a, b) =>
        String(b.project?.source?.exportedAt || "").localeCompare(String(a.project?.source?.exportedAt || "")));
      sendJson(response, request, 200, { projects });
      return true;
    }

    if (projectMatch && request.method === "DELETE") {
      const projectId = safeId(projectMatch[1]);
      const folder = join(projectsRoot, projectId);
      if (inside(projectsRoot, folder)) await rm(folder, { recursive: true, force: true });
      sendJson(response, request, 200, { ok: true });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/video-maker/ai") {
      const body = await requestJson(request);
      const provider = body?.provider === "lmstudio" ? "lmstudio" : "ollama";
      const baseUrl = String(body?.baseUrl || (provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1")).replace(/\/$/, "");
      const model = String(body?.model || "gemma4:e4b").trim();
      const instruction = String(body?.instruction || "Corrija o JSON mantendo o contrato e devolva apenas JSON válido.");
      const prompt = `${instruction}\n\nProjeto atual:\n${JSON.stringify(body?.project || {}, null, 2)}\n\nRetorne somente o projeto JSON completo, sem markdown.`;
      const endpoint = provider === "ollama" ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
      const payload = provider === "ollama"
        ? { model, stream: false, format: "json", messages: [{ role: "user", content: prompt }] }
        : { model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] };
      const modelResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await modelResponse.json().catch(() => ({}));
      if (!modelResponse.ok) throw new Error(result?.error?.message || `A IA local respondeu ${modelResponse.status}`);
      const content = provider === "ollama" ? result?.message?.content : result?.choices?.[0]?.message?.content;
      if (!content) throw new Error("A IA não retornou uma proposta");
      const proposal = JSON.parse(String(content).replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "").trim());
      if (proposal?.format !== "gacha-premium.video-project") throw new Error("A IA devolveu um JSON que não é um projeto do Video Maker");
      sendJson(response, request, 200, { ok: true, proposal, model });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/video-maker/exports") {
      const metadata = readMetadata(request);
      assertMimeType(contentTypeOf(request, metadata), EXPORT_TYPES, "A exportação precisa ser um vídeo WebM ou MP4.");
      const body = await requestBody(request, BODY_LIMITS.export);
      if (!body.length) throw new Error("Exportação vazia");
      const projectName = safePrintName(metadata.projectName || "video-maker");
      const stamp = printTimestamp();
      const inputPath = join(exportsRoot, `${projectName}_${stamp}.webm`);
      const outputPath = join(exportsRoot, `${projectName}_${stamp}.mp4`);
      const audioPath = join(exportsRoot, `${projectName}_${stamp}.wav`);
      await mkdir(exportsRoot, { recursive: true });
      await writeFile(inputPath, body);

      let hasAudio = false;
      const timeline = Array.isArray(metadata.timeline) ? metadata.timeline : [];
      const tiktokIds = new Set(Array.isArray(metadata.tiktoks) ? metadata.tiktoks.map((item) => String(item?.tiktokId || "")) : []);
      const audioInputs = [];
      const audioFilters = [];
      for (const [index, event] of timeline.entries()) {
        const duration = Math.max(0.05, Number(event?.duration) || 0);
        const tiktokId = String(event?.tiktokId || "");
        const source = tiktokId && tiktokIds.has(tiktokId) ? join(tiktoksRoot, safeId(tiktokId), "video.mp4") : null;
        if (event?.type === "video" && source) {
          let exists = true;
          try { await stat(source); } catch { exists = false; }
          if (exists) {
            audioInputs.push(source);
            const inputIndex = audioInputs.length - 1;
            audioFilters.push(`[${inputIndex}:a]atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`);
            hasAudio = true;
          } else {
            audioFilters.push(`anullsrc=r=48000:cl=stereo:d=${duration.toFixed(3)}[a${index}]`);
          }
        } else {
          audioFilters.push(`anullsrc=r=48000:cl=stereo:d=${duration.toFixed(3)}[a${index}]`);
        }
      }

      if (hasAudio && audioFilters.length) {
        const concatInputs = timeline.map((_, index) => `[a${index}]`).join("");
        const args = ["-y"];
        for (const source of audioInputs) args.push("-i", source);
        args.push("-filter_complex", `${audioFilters.join(";")};${concatInputs}concat=n=${timeline.length}:v=0:a=1[outa]`, "-map", "[outa]", "-c:a", "pcm_s16le", audioPath);
        await runProcess("ffmpeg", args, "FFmpeg não criou o áudio");
      }

      const args = ["-y", "-i", inputPath];
      if (hasAudio) args.push("-i", audioPath);
      args.push("-map", "0:v:0");
      if (hasAudio) args.push("-map", "1:a:0");
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(hasAudio ? ["-c:a", "aac", "-shortest"] : []), "-movflags", "+faststart", outputPath);
      await runProcess("ffmpeg", args, "FFmpeg falhou");
      await rm(inputPath, { force: true });
      if (hasAudio) await rm(audioPath, { force: true });
      sendJson(response, request, 200, { ok: true, filePath: outputPath, fileName: `${projectName}_${stamp}.mp4` });
      return true;
    }

    const characterFileMatch = url.pathname.match(/^\/files\/video-maker\/characters\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (characterFileMatch && request.method === "GET") {
      const characterId = safeId(characterFileMatch[1]);
      const frameKey = safeId(characterFileMatch[2]);
      await serveFile(response, request, join(charactersRoot, characterId, `${frameKey}.png`));
      return true;
    }

    const tiktokFileMatch = url.pathname.match(/^\/files\/video-maker\/tiktoks\/([a-zA-Z0-9_-]+)$/);
    if (tiktokFileMatch && request.method === "GET") {
      const tiktokId = safeId(tiktokFileMatch[1]);
      await serveFile(response, request, join(tiktoksRoot, tiktokId, "video.mp4"));
      return true;
    }

    return false;
  }

  return { initialize, handle };
}
