import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { emptyRoteirosState, normalizeRoteirosState as normalizeState, validateRoteirosState } from "../../app/domain/document-schemas.mjs";
import { configureOpenAiUsage, openAiStatus } from "./openai-provider.mjs";
import { appendAiPromptSnapshot, createAiPromptSnapshot, hasAiPromptOperation, normalizeAiPromptOverrides, publicPromptCatalog, validateAiPromptOverride } from "./ai-prompt-catalog.mjs";
import {
  cancelledAiError,
  listModels,
  testSelectedModel,
  throwIfCancelled,
  translateStudioText,
  unloadStudioModel,
  warmStudioModel,
} from "./ai-gateway.mjs";
import {
  blockAction,
  generateReactions,
  improveContext,
  organizeProfile,
  translate,
} from "./ai-operations.mjs";

const EMPTY_STATE = emptyRoteirosState();
const AI_QUEUE_LIMIT = 4;

function requestedPromptOperation(pathname, body = {}) {
  if (pathname.endsWith("/test")) return "roteiros.test";
  if (pathname.endsWith("/translate")) return "roteiros.translate";
  if (pathname.endsWith("/improve-context")) return body.contextScope === "video-description" ? "roteiros.improve-video-description" : "roteiros.improve-general-context";
  if (pathname.endsWith("/block")) return body.action === "variations" || body.action === "rewrite" ? "roteiros.variations" : "roteiros.improve-sentence";
  if (pathname.endsWith("/organize-profile")) return body.profileMode === "relations" ? "roteiros.organize-profile-relations" : "roteiros.organize-profile-traits";
  if (pathname.endsWith("/generate")) return body.opening === true ? "roteiros.opening" : body.mode === "replace-all" ? "roteiros.replace-all" : "roteiros.fill-empty";
  return null;
}

function inside(parent, target) {
  const parentPath = resolve(parent) + sep;
  return resolve(target).startsWith(parentPath);
}

async function readBody(request, maximumBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("Dados grandes demais");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const bytes = await readBody(request);
  return JSON.parse(bytes.toString("utf8") || "null");
}

function sendJson(response, headers, status, value) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export function createRoteirosService(rootFolder) {
  const root = resolve(rootFolder);
  const statePath = join(root, "estado.json");
  const aiPromptConfigPath = join(root, "ai-prompts-v2.json");
  const aiPromptConfigBackupPath = join(root, "backups", "ai-prompts-v2.latest.json");
  const backupsRoot = join(root, "backups");
  const videosRoot = join(root, "videos");
  const backgroundsRoot = join(root, "backgrounds");
  let state = structuredClone(EMPTY_STATE);
  let writeQueue = Promise.resolve();
  let aiQueueTail = Promise.resolve();
  let aiQueueSize = 0;
  let lastBackupAt = 0;
  let studioAiLoaded = null;
  let aiPromptOverrides = {};
  let aiPromptSnapshots = {};
  let aiUsageTotals = emptyAiUsageTotals();
  let promptConfigWriteQueue = Promise.resolve();

  function emptyAiUsageTotals() {
    return { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, lastAt: null, lastOperation: null, lastModel: null };
  }

  function usageNumbers(value) {
    const usage = value && typeof value === "object" ? value : {};
    const inputTokens = Math.max(0, Math.round(Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.prompt_eval_count ?? usage.inputTokens ?? 0) || 0));
    const outputTokens = Math.max(0, Math.round(Number(usage.output_tokens ?? usage.completion_tokens ?? usage.eval_count ?? usage.outputTokens ?? 0) || 0));
    return {
      inputTokens,
      outputTokens,
      totalTokens: Math.max(0, Math.round(Number(usage.total_tokens ?? usage.totalTokens ?? (inputTokens + outputTokens)) || 0)),
    };
  }

  function addUsageTotals(current, delta) {
    const next = { ...emptyAiUsageTotals(), ...(current && typeof current === "object" ? current : {}) };
    return {
      calls: Math.max(0, Math.round(Number(next.calls) || 0)) + Math.max(0, Math.round(Number(delta.calls) || 0)),
      inputTokens: Math.max(0, Math.round(Number(next.inputTokens) || 0)) + delta.inputTokens,
      outputTokens: Math.max(0, Math.round(Number(next.outputTokens) || 0)) + delta.outputTokens,
      totalTokens: Math.max(0, Math.round(Number(next.totalTokens) || 0)) + delta.totalTokens,
      lastAt: delta.lastAt || next.lastAt || null,
      lastOperation: delta.lastOperation || next.lastOperation || null,
      lastModel: delta.lastModel || next.lastModel || null,
    };
  }

  function mergeUsageTotals(left, right) {
    const a = { ...emptyAiUsageTotals(), ...(left && typeof left === "object" ? left : {}) };
    const b = { ...emptyAiUsageTotals(), ...(right && typeof right === "object" ? right : {}) };
    const bIsNewer = String(b.lastAt || "") >= String(a.lastAt || "");
    return {
      calls: Math.max(Number(a.calls) || 0, Number(b.calls) || 0),
      inputTokens: Math.max(Number(a.inputTokens) || 0, Number(b.inputTokens) || 0),
      outputTokens: Math.max(Number(a.outputTokens) || 0, Number(b.outputTokens) || 0),
      totalTokens: Math.max(Number(a.totalTokens) || 0, Number(b.totalTokens) || 0),
      lastAt: bIsNewer ? b.lastAt : a.lastAt,
      lastOperation: bIsNewer ? b.lastOperation : a.lastOperation,
      lastModel: bIsNewer ? b.lastModel : a.lastModel,
    };
  }

  async function saveAiPromptConfig() {
    const snapshot = {};
    for (const [operation, values] of Object.entries(aiPromptSnapshots)) snapshot[operation] = Array.isArray(values) ? values.slice(-5) : [];
    promptConfigWriteQueue = promptConfigWriteQueue.catch(() => undefined).then(async () => {
      await mkdir(backupsRoot, { recursive: true });
      try { await copyFile(aiPromptConfigPath, aiPromptConfigBackupPath); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      await writeJsonAtomic(aiPromptConfigPath, { version: 2, overrides: aiPromptOverrides, snapshots: snapshot, usageTotals: aiUsageTotals });
    });
    await promptConfigWriteQueue;
  }

  async function recordPromptResult(result, fallbackOperation = null) {
    const previews = [
      ...(Array.isArray(result?.promptPreviews) ? result.promptPreviews : []),
      ...(result?.promptPreview ? [result.promptPreview] : []),
    ];
    for (const preview of previews) {
      if (!preview?.operation) continue;
      const normalized = createAiPromptSnapshot({ ...preview, status: result?.failureReason ? "error" : (preview.status || "success"), error: result?.failureReason || preview.error || null });
      aiPromptSnapshots[normalized.operation] = appendAiPromptSnapshot(aiPromptSnapshots[normalized.operation], normalized);
    }
    if (fallbackOperation && !previews.length) {
      aiPromptSnapshots[fallbackOperation] = appendAiPromptSnapshot(aiPromptSnapshots[fallbackOperation], createAiPromptSnapshot({ operation: fallbackOperation, provider: "unknown", status: "error", error: result?.error || "Falha sem prévia de prompt" }));
    }
    if (previews.length || fallbackOperation) await saveAiPromptConfig();
  }

  async function recordAiUsage(body, result, fallbackOperation = null) {
    const usage = usageNumbers(result?.usage || result?.diagnostics?.usage);
    const operation = result?.promptPreview?.operation || result?.diagnostics?.promptPreview?.operation || fallbackOperation || null;
    if (!operation && usage.inputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens === 0) return null;
    if (["roteiros.status", "roteiros.models"].includes(operation) && usage.inputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens === 0) return null;
    const requestCount = Math.max(1, Math.round(Number(result?.aiCallCount || result?.diagnostics?.aiCallCount || result?.diagnostics?.attempts || result?.promptPreviews?.length || 1)));
    const delta = { calls: requestCount, ...usage, lastAt: new Date().toISOString(), lastOperation: operation, lastModel: result?.model || result?.diagnostics?.model || null };
    aiUsageTotals = addUsageTotals(aiUsageTotals, delta);

    let scriptUsage = null;
    let sectionUsage = null;
    const scriptId = typeof body?.scriptId === "string" ? body.scriptId : "";
    const sectionId = typeof body?.sectionId === "string" ? body.sectionId : (typeof body?.section?.id === "string" ? body.section.id : "");
    if (scriptId) {
      const nextScripts = state.scripts.map((script) => {
        if (script.id !== scriptId) return script;
        scriptUsage = addUsageTotals(script.aiUsage, delta);
        const nextScript = { ...script, aiUsage: scriptUsage };
        if (sectionId) {
          if (body?.opening === true && script.opening?.id === sectionId) {
            sectionUsage = addUsageTotals(script.opening.aiUsage, delta);
            nextScript.opening = { ...script.opening, aiUsage: sectionUsage };
          } else {
            nextScript.tiktoks = script.tiktoks.map((section) => {
              if (section.id !== sectionId) return section;
              sectionUsage = addUsageTotals(section.aiUsage, delta);
              return { ...section, aiUsage: sectionUsage };
            });
          }
        }
        return nextScript;
      });
      if (scriptUsage) {
        state = normalizeState({ ...state, scripts: nextScripts });
        writeQueue = writeQueue.catch(() => undefined).then(() => writeJsonAtomic(statePath, state));
        await writeQueue;
      }
    }
    await saveAiPromptConfig();
    return { global: structuredClone(aiUsageTotals), script: scriptUsage ? structuredClone(scriptUsage) : null, section: sectionUsage ? structuredClone(sectionUsage) : null, delta: structuredClone(delta) };
  }

  async function loadAiPromptConfig() {
    try {
      const parsed = JSON.parse(await readFile(aiPromptConfigPath, "utf8"));
      aiPromptOverrides = normalizeAiPromptOverrides(parsed?.overrides);
      aiPromptSnapshots = parsed?.snapshots && typeof parsed.snapshots === "object" ? parsed.snapshots : {};
      aiUsageTotals = { ...emptyAiUsageTotals(), ...(parsed?.usageTotals && typeof parsed.usageTotals === "object" ? parsed.usageTotals : {}) };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        try {
          const recovered = JSON.parse(await readFile(aiPromptConfigBackupPath, "utf8"));
          aiPromptOverrides = normalizeAiPromptOverrides(recovered?.overrides);
          aiPromptSnapshots = recovered?.snapshots && typeof recovered.snapshots === "object" ? recovered.snapshots : {};
          aiUsageTotals = { ...emptyAiUsageTotals(), ...(recovered?.usageTotals && typeof recovered.usageTotals === "object" ? recovered.usageTotals : {}) };
        } catch {
          aiPromptOverrides = {};
          aiPromptSnapshots = {};
          aiUsageTotals = emptyAiUsageTotals();
        }
        try { await rename(aiPromptConfigPath, join(root, `ai-prompts-v2.corrupt-${Date.now()}.json`)); } catch { /* preserva no lugar se a quarentena falhar */ }
      }
      await saveAiPromptConfig();
    }
  }

  async function migrateLegacyFillPrompt() {
    const legacy = String(state?.settings?.fillEmptyPrompt || "").trim();
    if (!legacy) return;
    if (!aiPromptOverrides["roteiros.fill-empty"]) aiPromptOverrides["roteiros.fill-empty"] = legacy.slice(0, 12_000);
    if (!aiPromptOverrides["roteiros.opening"]) aiPromptOverrides["roteiros.opening"] = legacy.slice(0, 12_000);
    state = normalizeState({ ...state, settings: { ...state.settings, fillEmptyPrompt: "" } });
    await Promise.all([writeJsonAtomic(statePath, state), saveAiPromptConfig()]);
  }

  function clientAbortController(response) {
    const controller = new AbortController();
    if (typeof response.once !== "function" || typeof response.off !== "function") {
      return { signal: controller.signal, cleanup: () => undefined };
    }
    const onClose = () => {
      // A normal response is already marked writableEnded. A close before
      // that point means the browser cancelled or lost the connection.
      if (!response.writableEnded) controller.abort();
    };
    response.once("close", onClose);
    return {
      signal: controller.signal,
      cleanup: () => response.off("close", onClose),
    };
  }

  function enqueueAi(task, signal) {
    throwIfCancelled(signal);
    if (aiQueueSize >= AI_QUEUE_LIMIT) {
      throw Object.assign(new Error("A fila da IA está cheia. Aguarde as gerações atuais terminarem."), { status: 429 });
    }
    aiQueueSize += 1;
    const run = aiQueueTail.catch(() => undefined).then(async () => {
      throwIfCancelled(signal);
      return task(signal);
    });
    aiQueueTail = run.then(() => undefined, () => undefined);
    return run.finally(() => { aiQueueSize -= 1; });
  }

  function backupName(prefix = "roteiros") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}-${timestamp}-${Math.random().toString(36).slice(2, 8)}.json`;
  }

  async function pruneBackups() {
    const entries = [];
    for (const name of (await readdir(backupsRoot)).filter((item) => item.endsWith(".json"))) {
      const filePath = join(backupsRoot, name);
      if (!inside(backupsRoot, filePath)) continue;
      try { entries.push({ name, modified: (await stat(filePath)).mtimeMs }); } catch { /* file disappeared */ }
    }
    entries.sort((left, right) => left.modified - right.modified);
    for (const entry of entries.slice(0, -20)) await rm(join(backupsRoot, entry.name), { force: true });
  }

  async function createBackup(prefix = "roteiros") {
    await mkdir(backupsRoot, { recursive: true });
    try { await stat(statePath); } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const fileName = backupName(prefix);
    const backupPath = join(backupsRoot, fileName);
    if (!inside(backupsRoot, backupPath)) throw new Error("Destino de backup inválido.");
    await copyFile(statePath, backupPath);
    await pruneBackups();
    const details = await stat(backupPath);
    return { fileName, createdAt: details.mtime.toISOString(), bytes: details.size };
  }

  async function listBackups() {
    await mkdir(backupsRoot, { recursive: true });
    const backups = [];
    for (const fileName of (await readdir(backupsRoot)).filter((name) => name.endsWith(".json"))) {
      const filePath = join(backupsRoot, fileName);
      if (!inside(backupsRoot, filePath)) continue;
      try {
        const details = await stat(filePath);
        backups.push({ fileName, createdAt: details.mtime.toISOString(), bytes: details.size });
      } catch { /* ignore files removed while listing */ }
    }
    backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.fileName.localeCompare(left.fileName));
    return { folder: "dados-locais-premium/roteiros/backups", backups };
  }

  async function findLatestValidBackup() {
    const candidates = await listBackups();
    for (const item of candidates.backups) {
      try {
        const parsed = JSON.parse(await readFile(join(backupsRoot, item.fileName), "utf8"));
        if (validateRoteirosState(parsed).length === 0) return normalizeState(parsed);
      } catch { /* try the next newest backup */ }
    }
    return null;
  }

  async function restoreBackup(fileName) {
    const safeName = String(fileName || "");
    if (!/^[a-zA-Z0-9_-]{1,160}\.json$/.test(safeName)) throw new Error("Nome de backup inválido.");
    const backupPath = join(backupsRoot, safeName);
    if (!inside(backupsRoot, backupPath)) throw new Error("Backup fora da pasta permitida.");
    const parsed = JSON.parse(await readFile(backupPath, "utf8"));
    const issues = validateRoteirosState(parsed);
    if (issues.length) throw new Error(`Backup inválido: ${issues[0]}`);
    const normalized = normalizeState(parsed);
    let result;
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const safetyBackup = await createBackup("roteiros-antes-restauracao");
      state = normalized;
      await writeJsonAtomic(statePath, state);
      lastBackupAt = Date.now();
      result = { fileName: safeName, restoredAt: new Date().toISOString(), safetyBackup: safetyBackup?.fileName };
    });
    await writeQueue;
    return result;
  }

  async function init() {
    await Promise.all([mkdir(root, { recursive: true }), mkdir(backupsRoot, { recursive: true }), mkdir(videosRoot, { recursive: true }), mkdir(backgroundsRoot, { recursive: true }), configureOpenAiUsage(join(root, "openai-usage.json"))]);
    await loadAiPromptConfig();
    try {
      state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        await writeJsonAtomic(statePath, state);
      } else {
        const recovered = await findLatestValidBackup();
        const corruptedPath = join(root, `estado.corrompido-${Date.now()}.json`);
        try { await rename(statePath, corruptedPath); } catch { /* preserve original if quarantine is unavailable */ }
        state = recovered || structuredClone(EMPTY_STATE);
        await writeJsonAtomic(statePath, state);
      }
    }
    await migrateLegacyFillPrompt();
  }

  function save(nextState) {
    const incoming = normalizeState(nextState);
    const normalized = normalizeState({ ...incoming, scripts: incoming.scripts.map((script) => {
      const current = state.scripts.find((item) => item.id === script.id);
      if (!current) return script;
      return {
        ...script,
        aiUsage: mergeUsageTotals(current.aiUsage, script.aiUsage),
        ...(script.opening && current.opening ? { opening: { ...script.opening, aiUsage: mergeUsageTotals(current.opening.aiUsage, script.opening.aiUsage) } } : {}),
        tiktoks: script.tiktoks.map((section) => {
          const previous = current.tiktoks.find((item) => item.id === section.id);
          return previous ? { ...section, aiUsage: mergeUsageTotals(previous.aiUsage, section.aiUsage) } : section;
        }),
      };
    }) });
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      if (Date.now() - lastBackupAt > 5 * 60 * 1000) {
        const created = await createBackup();
        if (created) lastBackupAt = Date.now();
      }
      state = normalized;
      await writeJsonAtomic(statePath, state);
    });
    return writeQueue;
  }

  function safeScriptId(value) {
    const id = String(value || "");
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw Object.assign(new Error("Identificador de roteiro inválido."), { status: 400 });
    return id;
  }

  async function removeScript(scriptId) {
    const id = safeScriptId(scriptId);
    let result;
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const script = state.scripts.find((item) => item.id === id);
      if (!script) throw Object.assign(new Error("Roteiro não encontrado."), { status: 404 });
      const safetyBackup = await createBackup("roteiros-antes-exclusao");
      state = normalizeState({ ...state, scripts: state.scripts.filter((item) => item.id !== id) });
      await writeJsonAtomic(statePath, state);
      const folders = [join(videosRoot, id), join(backgroundsRoot, id)];
      for (const folder of folders) {
        if (!inside(root, folder)) throw new Error("Pasta do roteiro fora da área permitida.");
        await rm(folder, { recursive: true, force: true });
      }
      result = { script: structuredClone(script), safetyBackup: safetyBackup?.fileName ?? null, legacyTitleSafe: !state.scripts.some((item) => item.title === script.title), removedFolders: folders };
    });
    await writeQueue;
    return result;
  }

  async function listOrphanScriptFolders() {
    const knownIds = new Set(state.scripts.map((script) => script.id));
    const list = async (parent) => {
      try {
        return (await readdir(parent, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,160}$/.test(entry.name) && !knownIds.has(entry.name))
          .map((entry) => entry.name);
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
    };
    return { videos: await list(videosRoot), backgrounds: await list(backgroundsRoot) };
  }

  async function removeOrphanScriptFolders() {
    const orphans = await listOrphanScriptFolders();
    const removed = [];
    for (const [kind, ids] of Object.entries(orphans)) {
      const parent = kind === "videos" ? videosRoot : backgroundsRoot;
      for (const id of ids) {
        const folder = join(parent, id);
        if (!inside(root, folder)) throw new Error("Pasta órfã fora da área permitida.");
        await rm(folder, { recursive: true, force: true });
        removed.push({ kind, id });
      }
    }
    return { ...orphans, removed };
  }

  function getScriptIds() {
    return state.scripts.map((script) => script.id);
  }

  function getScriptTitles() {
    return state.scripts.map((script) => script.title);
  }

  async function syncLibraryVideoDurations(videos) {
    const durationById = new Map((Array.isArray(videos) ? videos : [])
      .filter((video) => video && typeof video.id === "string" && Number(video.durationSeconds) > 0)
      .map((video) => [video.id, Number(video.durationSeconds)]));
    let changed = false;
    let changedCount = 0;
    const nextScripts = state.scripts.map((script) => ({
      ...script,
      tiktoks: script.tiktoks.map((section) => {
        const libraryId = section.video?.libraryVideoId;
        const duration = libraryId ? durationById.get(libraryId) : undefined;
        if (!section.video || duration === undefined || section.video.durationSeconds === duration) return section;
        changed = true;
        changedCount += 1;
        return { ...section, video: { ...section.video, durationSeconds: duration }, updatedAt: new Date().toISOString() };
      }),
    }));
    if (!changed) return 0;
    await save({ ...state, scripts: nextScripts });
    return changedCount;
  }

  async function linkVideo(scriptId, tiktokId, video, metadata = {}) {
    const id = safeScriptId(scriptId);
    const sectionId = String(tiktokId || "");
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(sectionId)) throw Object.assign(new Error("Identificador de TikTok inválido."), { status: 400 });
    let linked;
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const script = state.scripts.find((item) => item.id === id);
      const section = script?.tiktoks.find((item) => item.id === sectionId);
      if (!script || !section) throw Object.assign(new Error("TikTok não encontrado no roteiro."), { status: 404 });
      const nextScripts = state.scripts.map((item) => item.id !== id ? item : {
        ...item,
        tiktoks: item.tiktoks.map((current) => current.id === sectionId ? {
          ...current,
          ...(Object.prototype.hasOwnProperty.call(metadata, "description") ? { description: String(metadata.description ?? "") } : {}),
          ...(Object.prototype.hasOwnProperty.call(metadata, "sceneEndSeconds") ? { sceneEndSeconds: Number(metadata.sceneEndSeconds) } : {}),
          ...(Object.prototype.hasOwnProperty.call(metadata, "firstGroupReactionSeconds") ? { firstGroupReactionSeconds: Number(metadata.firstGroupReactionSeconds) } : {}),
          ...(Object.prototype.hasOwnProperty.call(metadata, "secondGroupReactionSeconds") ? { secondGroupReactionSeconds: Number(metadata.secondGroupReactionSeconds) } : {}),
          video,
          updatedAt: new Date().toISOString(),
        } : current),
        updatedAt: new Date().toISOString(),
      });
      state = normalizeState({ ...state, scripts: nextScripts });
      await writeJsonAtomic(statePath, state);
      linked = structuredClone(state.scripts.find((item) => item.id === id)?.tiktoks.find((item) => item.id === sectionId)?.video);
    });
    await writeQueue;
    return linked;
  }

  async function handle(request, response, url, corsHeaders) {
    const isRoteirosRoute = url.pathname.startsWith("/roteiros/");
    const isStudioAiRoute = url.pathname.startsWith("/studio/ai/");
    if (!isRoteirosRoute && !isStudioAiRoute) return false;
    const headers = corsHeaders(request);
    const client = clientAbortController(response);
    let activeAiOperation = null;
    let aiRequestBody = null;
    try {
      if (request.method === "POST" && url.pathname === "/studio/ai/unload") {
        await enqueueAi(async (signal) => {
          await unloadStudioModel(studioAiLoaded, signal);
          studioAiLoaded = null;
        }, client.signal);
        sendJson(response, headers, 200, { ok: true });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/studio/ai/warmup") {
        const result = await enqueueAi(async (signal) => {
          const targetSettings = studioSettings(state.settings);
          const targetConfig = providerConfig(targetSettings);
          if (studioAiLoaded && (studioAiLoaded.provider !== targetConfig.provider || studioAiLoaded.baseUrl !== targetConfig.baseUrl || studioAiLoaded.model !== targetConfig.model)) {
            await unloadStudioModel(studioAiLoaded, signal);
            studioAiLoaded = null;
          }
          const result = await warmStudioModel(targetSettings, signal);
          studioAiLoaded = result.config;
          return result;
        }, client.signal);
        sendJson(response, headers, 200, { ok: true, model: result.model });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/studio/ai/translate") {
        const body = await readJson(request);
        const result = await enqueueAi(async (signal) => {
          const text = String(body?.text || "").trim();
          if (!text) throw new Error("Digite um texto antes de gerar o inglês.");
          const translationSettings = { ...studioSettings(state.settings), bubbleType: body?.bubbleType };
          const targetConfig = providerConfig(translationSettings);
          if (studioAiLoaded && (studioAiLoaded.provider !== targetConfig.provider || studioAiLoaded.baseUrl !== targetConfig.baseUrl || studioAiLoaded.model !== targetConfig.model)) {
            await unloadStudioModel(studioAiLoaded, signal);
            studioAiLoaded = null;
          }
          const result = await translateStudioText(translationSettings, text, signal);
          studioAiLoaded = result.config;
          return result;
        }, client.signal);
        sendJson(response, headers, 200, { translatedText: result.translatedText, model: result.model });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/roteiros/state") {
        sendJson(response, headers, 200, state);
        return true;
      }
      if (request.method === "GET" && url.pathname === "/roteiros/backups") {
        sendJson(response, headers, 200, await listBackups());
        return true;
      }
      if (request.method === "POST" && url.pathname === "/roteiros/backups/create") {
        const backup = await createBackup("roteiros-manual");
        if (!backup) throw new Error("Ainda não há um estado salvo para criar backup.");
        sendJson(response, headers, 200, backup);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/roteiros/backups/restore") {
        const body = await readJson(request);
        sendJson(response, headers, 200, await restoreBackup(body?.fileName));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/roteiros/state") {
        await save(await readJson(request));
        sendJson(response, headers, 200, { ok: true });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/roteiros/ai/prompts") {
        sendJson(response, headers, 200, { version: 2, usage: structuredClone(aiUsageTotals), operations: publicPromptCatalog(aiPromptOverrides, aiPromptSnapshots) });
        return true;
      }
      if (request.method === "GET" && url.pathname.startsWith("/roteiros/ai/prompts/")) {
        const operation = decodeURIComponent(url.pathname.slice("/roteiros/ai/prompts/".length));
        const catalog = publicPromptCatalog(aiPromptOverrides, aiPromptSnapshots);
        const entry = catalog.find((item) => item.id === operation);
        if (!entry) throw Object.assign(new Error("Operação de IA desconhecida."), { status: 404 });
        sendJson(response, headers, 200, entry);
        return true;
      }
      if ((request.method === "PUT" || request.method === "POST") && url.pathname.startsWith("/roteiros/ai/prompts/")) {
        const operation = decodeURIComponent(url.pathname.slice("/roteiros/ai/prompts/".length));
        if (request.method === "POST" && operation.endsWith("/reset")) {
          const target = operation.slice(0, -"/reset".length);
          if (!hasAiPromptOperation(target)) throw Object.assign(new Error("Operação de IA desconhecida."), { status: 404 });
          delete aiPromptOverrides[target];
          await saveAiPromptConfig();
          sendJson(response, headers, 200, { version: 1, operations: publicPromptCatalog(aiPromptOverrides, aiPromptSnapshots) });
          return true;
        }
        const body = await readJson(request);
        const prompt = validateAiPromptOverride(operation, body?.prompt);
        aiPromptOverrides[operation] = prompt;
        await saveAiPromptConfig();
        sendJson(response, headers, 200, { operation, prompt, version: "custom" });
        return true;
      }
      if (request.method === "POST" && url.pathname.startsWith("/roteiros/ai/")) {
        const body = { ...(await readJson(request)), promptOverrides: aiPromptOverrides };
        aiRequestBody = body;
        activeAiOperation = requestedPromptOperation(url.pathname, body);
        const result = await enqueueAi(async (signal) => {
          if (url.pathname === "/roteiros/ai/status") return openAiStatus(body.settings);
          if (url.pathname === "/roteiros/ai/models") return { models: await listModels(body.settings, signal) };
          if (url.pathname === "/roteiros/ai/test") return testSelectedModel(body.settings, signal);
          if (url.pathname === "/roteiros/ai/warmup") {
            const warmed = await warmStudioModel(body.settings, signal, 4096);
            studioAiLoaded = warmed.config;
            return { ok: true, model: warmed.model };
          }
          if (url.pathname === "/roteiros/ai/improve-context") return improveContext(body, signal);
          if (url.pathname === "/roteiros/ai/organize-profile") return organizeProfile(body, signal);
          if (url.pathname === "/roteiros/ai/generate") return generateReactions(body, signal);
          if (url.pathname === "/roteiros/ai/block") return blockAction(body, signal);
          if (url.pathname === "/roteiros/ai/translate") return translate(body, signal);
          throw Object.assign(new Error("Ação de IA não encontrada."), { status: 404 });
        }, client.signal);
        const resolved = await result;
        await recordPromptResult(resolved);
        const usageMetrics = await recordAiUsage(body, resolved, activeAiOperation);
        sendJson(response, headers, 200, { ...resolved, usageMetrics });
        return true;
      }
      sendJson(response, headers, 404, { error: "Rota de Roteiros não encontrada" });
      return true;
    } catch (error) {
      if (!client.signal.aborted) {
        await recordPromptResult(error?.diagnostics || error, error?.diagnostics?.promptPreview?.operation || activeAiOperation);
        const usageMetrics = await recordAiUsage(aiRequestBody || {}, error?.diagnostics || error, activeAiOperation);
        const payload = { error: error?.message || "Erro no módulo Roteiros" };
        if (error?.diagnostics) payload.diagnostics = error.diagnostics;
        if (usageMetrics?.delta?.totalTokens || usageMetrics?.delta?.inputTokens || usageMetrics?.delta?.outputTokens) payload.usageMetrics = usageMetrics;
        sendJson(response, headers, error?.status || 400, payload);
      }
      return true;
    } finally {
      client.cleanup();
    }
  }

  function getScript(id) {
    const script = state.scripts.find((item) => item.id === String(id));
    return script ? structuredClone(script) : null;
  }

  function getScripts() {
    return structuredClone(state.scripts);
  }

  return { init, handle, removeScript, listOrphanScriptFolders, removeOrphanScriptFolders, getScriptIds, getScriptTitles, getScript, getScripts, linkVideo, syncLibraryVideoDurations };
}
