import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { emptyRoteirosState, normalizeRoteirosState as normalizeState } from "../../app/domain/document-schemas.mjs";

const EMPTY_STATE = emptyRoteirosState();

const PROTECTED_RULES = `REGRAS ESTRUTURAIS:
- Os personagens reatores estão juntos assistindo ao vídeo; eles não estão dentro da cena mostrada.
- Uma versão do personagem mostrada no vídeo é diferente do personagem presente na sala.
- Fala é ouvida. Pensamento é privado e ninguém pode responder diretamente a ele.
- Reação silenciosa não possui fala: deixe text vazio e descreva gesto, expressão ou tensão em emotion.
- Preserve dúvidas e ambiguidades. Suspeita, ciúme ou medo não transformam hipótese em fato.
- Interprete literalmente quem pratica e quem sofre cada ação. Nunca inverta agressor e vítima.
- Respeite a linha do tempo. Não trate futuro como fato consumado nem passado como previsão.
- Os blocos formam uma conversa contínua. Evite repetição, resumo genérico e reações isoladas.
- Use personalidade, história, relações e estilo de fala sem repetir a ficha artificialmente.
- Não invente fatos, falas, motivos ou conhecimentos que não estejam no contexto fornecido.
- Personagens presentes devem se tratar como presentes; ao confrontar alguém, use você ou o nome.
- Não faça todos comentarem a mesma coisa com palavras diferentes.`;

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
  response.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function safeLocalBaseUrl(value, provider) {
  const fallback = provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1";
  const parsed = new URL(String(value || fallback));
  if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error("A IA deve usar um endereço local (localhost ou 127.0.0.1).");
  }
  return parsed.toString().replace(/\/$/, "");
}

function safeModel(value) {
  const model = String(value || "").trim();
  if (!model) throw new Error("Selecione um modelo de IA.");
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) throw new Error("Nome de modelo inválido.");
  return model;
}

function extractJson(text) {
  const clean = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("A IA não retornou JSON válido.");
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 150_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("A IA demorou demais para responder.");
    if (error instanceof TypeError) throw new Error("Não foi possível conectar ao provedor local de IA.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function providerConfig(settings) {
  const provider = settings?.aiProvider;
  if (provider !== "lmstudio" && provider !== "ollama") throw new Error("Selecione LM Studio ou Ollama nas configurações.");
  return {
    provider,
    baseUrl: safeLocalBaseUrl(settings.aiBaseUrl, provider),
    model: safeModel(settings.aiModel),
    temperature: Math.max(0, Math.min(1.5, Number(settings.temperature) || 0.45)),
  };
}

async function listModels(settings) {
  const provider = settings?.aiProvider;
  if (provider !== "lmstudio" && provider !== "ollama") throw new Error("Selecione LM Studio ou Ollama nas configurações.");
  const config = { provider, baseUrl: safeLocalBaseUrl(settings.aiBaseUrl, provider) };
  const endpoint = config.provider === "ollama"
    ? `${config.baseUrl.replace(/\/api(?:\/.*)?$/, "")}/api/tags`
    : `${config.baseUrl}/models`;
  const response = await fetchWithTimeout(endpoint, {}, 12_000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`O provedor respondeu com erro ${response.status}.`);
  if (config.provider === "ollama") return (data.models || []).map((item) => item.name || item.model).filter(Boolean);
  return (data.data || []).map((item) => item.id).filter(Boolean);
}

async function callAi(settings, prompt, schema, system = "Você escreve roteiros de reação para personagens fictícios. Responda somente com JSON válido.") {
  const config = providerConfig(settings);
  if (config.provider === "ollama") {
    const base = config.baseUrl.replace(/\/api(?:\/.*)?$/, "");
    const response = await fetchWithTimeout(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: schema,
        options: { temperature: config.temperature, num_predict: 5000, num_ctx: 16384 },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `O Ollama respondeu com erro ${response.status}.`);
    if (!data.message?.content) throw new Error("O Ollama retornou uma resposta vazia.");
    return { data: extractJson(data.message.content), model: data.model || config.model };
  }

  const payload = {
    model: config.model,
    stream: false,
    temperature: config.temperature,
    max_tokens: 5000,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: { name: "gacha_roteiros_response", strict: true, schema } },
  };
  let response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let result = await response.json().catch(() => ({}));
  if (!response.ok && response.status === 400) {
    response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, response_format: { type: "json_object" } }),
    });
    result = await response.json().catch(() => ({}));
  }
  const detail = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("O LM Studio retornou uma resposta vazia.");
  return { data: extractJson(content), model: result.model || config.model };
}

function studioSettings(settings) {
  const provider = settings?.aiProvider === "lmstudio" || settings?.aiProvider === "ollama"
    ? settings.aiProvider
    : "ollama";
  const defaultBaseUrl = provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1";
  return {
    aiProvider: provider,
    aiBaseUrl: settings?.aiProvider === provider && settings?.aiBaseUrl ? settings.aiBaseUrl : defaultBaseUrl,
    // This is the model installed for the local Studio translation workflow.
    aiModel: String(settings?.aiModel || "").trim() || "gemma4:e4b",
    temperature: 0.2,
  };
}

function cleanTranslation(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();
}

async function translateStudioText(settings, text) {
  const config = providerConfig(studioSettings(settings));
  const system = "You are a professional native English dialogue translator. Translate the supplied Portuguese speech or thought into natural, idiomatic English. Preserve meaning, emotion, tone, subtext, names and character voice. Return only the translated text, with no quotes, notes or explanation.";
  const user = `Translate this ${String(settings?.bubbleType || "dialogue")} from Portuguese to natural English.\n\n${text}`;
  if (config.provider === "ollama") {
    const base = config.baseUrl.replace(/\/api(?:\/.*)?$/, "");
    const response = await fetchWithTimeout(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        // Keep Gemma resident while the user is working in the Studio.
        keep_alive: -1,
        // A bubble is a short translation; a small context/output budget avoids
        // wasting time and VRAM on the much larger roteiro defaults.
        think: false,
        options: { temperature: config.temperature, num_predict: 160, num_ctx: 2048 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `O Ollama respondeu com erro ${response.status}.`);
    const translatedText = cleanTranslation(data.message?.content);
    if (!translatedText) throw new Error("A IA retornou uma tradução vazia.");
    return { translatedText, model: data.model || config.model, config };
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature: config.temperature,
      max_tokens: 800,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const result = await response.json().catch(() => ({}));
  const detail = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  const translatedText = cleanTranslation(result.choices?.[0]?.message?.content);
  if (!translatedText) throw new Error("A IA retornou uma tradução vazia.");
  return { translatedText, model: result.model || config.model, config };
}

async function warmStudioModel(settings) {
  const config = providerConfig(studioSettings(settings));
  if (config.provider === "ollama") {
    const base = config.baseUrl.replace(/\/api(?:\/.*)?$/, "");
    const response = await fetchWithTimeout(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt: "",
        stream: false,
        keep_alive: -1,
        think: false,
        options: { num_predict: 1, num_ctx: 2048 },
      }),
    }, 120_000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `O Ollama respondeu com erro ${response.status}.`);
    return { model: data.model || config.model, config };
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature: 0,
      max_tokens: 1,
      messages: [{ role: "user", content: " " }],
    }),
  }, 120_000);
  const result = await response.json().catch(() => ({}));
  const detail = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  return { model: result.model || config.model, config };
}

async function unloadStudioModel(loaded) {
  if (!loaded) return;
  try {
    if (loaded.provider === "ollama") {
      const base = loaded.baseUrl.replace(/\/api(?:\/.*)?$/, "");
      await fetchWithTimeout(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: loaded.model, prompt: "", stream: false, keep_alive: 0 }),
      }, 12_000);
    } else {
      const root = loaded.baseUrl.replace(/\/v1\/?$/, "");
      const candidates = [
        `${root}/api/v1/models/unload`,
        `${root}/api/models/${encodeURIComponent(loaded.model)}/unload`,
      ];
      for (const endpoint of candidates) {
        try {
          const response = await fetchWithTimeout(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: loaded.model }),
          }, 12_000);
          if (response.ok) break;
        } catch { /* Some LM Studio versions do not expose an unload endpoint. */ }
      }
    }
  } catch { /* Leaving Studio must never be blocked by an optional unload call. */ }
}

function rulesText(rules) {
  const enabled = (Array.isArray(rules) ? rules : []).filter((rule) => rule?.enabled && String(rule.description || "").trim());
  return enabled.length ? enabled.map((rule) => `[${String(rule.priority || "normal").toUpperCase()}] ${rule.title}: ${rule.description}`).join("\n") : "Nenhuma regra personalizada ativa.";
}

function timelineNotice(value) {
  if (value === "past") return "O vídeo se passa no passado em relação aos espectadores.";
  if (value === "present") return "O vídeo se passa no presente da narrativa.";
  if (value === "future") return "O vídeo se passa no futuro; não trate como algo já ocorrido.";
  return "A linha temporal não foi definida; não afirme quando ocorreu.";
}

function reactionSchema(characterIds, count) {
  return {
    type: "object",
    properties: {
      reactions: {
        type: "array", minItems: count, maxItems: count,
        items: {
          type: "object",
          properties: {
            characterId: { type: "string", enum: characterIds },
            type: { type: "string", enum: ["speech", "thought", "silent"] },
            emotion: { type: "string" },
            text: { type: "string" },
          },
          required: ["characterId", "type", "emotion", "text"], additionalProperties: false,
        },
      },
    },
    required: ["reactions"], additionalProperties: false,
  };
}

function compactCharacters(characters) {
  return JSON.stringify((characters || []).map((character) => ({
    id: character.id,
    nome: character.name,
    genero: character.gender,
    personalidade: character.personality || "",
    historia: character.backstory || "",
    relacaoComFyn: character.fynRelationship || "",
    estiloDeFala: character.speakingStyle || "",
    regrasParticulares: character.additionalRules || "",
    relacoes: character.relationships || [],
  })));
}

function compactHistory(previousSections, limit) {
  return JSON.stringify((previousSections || []).slice(-Math.max(1, Number(limit) || 5)).map((section, index) => ({
    ordem: index + 1,
    titulo: section.title || "",
    descricao: section.description || "",
    linhaTemporal: section.timeline || "unspecified",
    reacoes: (section.reactionBlocks || []).filter((block) => block.characterId && (block.text || block.emotion)).slice(-12),
  })));
}

async function improveContext(body) {
  const schema = { type: "object", properties: { improvedContext: { type: "string" } }, required: ["improvedContext"], additionalProperties: false };
  const prompt = `Reescreva a descrição do vídeo para ficar clara para uma IA gerar reações de espectadores.\n\nDESCRIÇÃO ORIGINAL:\n${body.description || ""}\n\nCONTEXTO GERAL:\n${body.generalContext || "Não informado."}\n\nOBJETIVO:\n${body.sceneGoal || "Não informado."}\n\nLINHA DO TEMPO:\n${timelineNotice(body.timeline)}\n\nINSTRUÇÃO:\n${body.userInstruction || "Nenhuma."}\n\nHISTÓRICO:\n${JSON.stringify(body.previousDescriptions || [])}\n\nREGRAS:\n- Preserve todos os fatos.\n- Não invente personagens, ações, falas, emoções ou motivos.\n- Deixe claro quem pratica e quem sofre cada ação.\n- Preserve incertezas.\n- Escreva em português brasileiro.\n- Retorne somente JSON no formato {"improvedContext":"..."}.`;
  const result = await callAi(body.settings, prompt, schema);
  if (!result.data?.improvedContext) throw new Error("A IA não retornou o contexto melhorado.");
  return { improvedContext: String(result.data.improvedContext), model: result.model };
}

async function generateReactions(body) {
  const section = body.section || {};
  const targetIndices = Array.isArray(body.targetIndices) ? body.targetIndices : [];
  const characterIds = (body.characters || []).map((character) => character.id).filter(Boolean);
  if (!characterIds.length) throw new Error("Selecione pelo menos um personagem ativo.");
  if (!targetIndices.length) throw new Error("Não há blocos para gerar.");
  if (!String(section.description || "").trim()) throw new Error("Escreva a descrição do TikTok antes de gerar.");
  const targets = targetIndices.map((index) => ({ index, block: section.reactionBlocks?.[index] || {} }));
  const existing = body.mode === "replace-all" ? [] : (section.reactionBlocks || []).filter((block) => block.characterId && (block.text || block.emotion));
  const prompt = `Crie EXATAMENTE ${targetIndices.length} blocos novos de uma sala de reação. A sequência deve parecer uma conversa contínua.\n\nMODO:\n${body.mode === "replace-all" ? "Substituir todos os blocos." : "Preencher somente os blocos vazios."}\n\nPERSONAGENS:\n${compactCharacters(body.characters)}\n\nCONTEXTO GERAL:\n${body.generalContext || "Não informado."}\n\nREGRAS PERSONALIZADAS GLOBAIS:\n${rulesText(body.globalRules)}\n\nHISTÓRICO RECENTE:\n${compactHistory(body.previousSections, body.settings?.historyLimit)}\n\nDESCRIÇÃO LITERAL DO VÍDEO:\n${section.description}\n\nOBJETIVO:\n${section.sceneGoal || "Não informado."}\n\nLINHA DO TEMPO:\n${timelineNotice(section.timeline)}\n\nREGRAS ESPECÍFICAS DESTE TIKTOK:\n${section.specificRules || "Nenhuma."}\n\nINSTRUÇÃO ADICIONAL:\n${section.userInstruction || "Nenhuma."}\n\nREAÇÕES EXISTENTES:\n${JSON.stringify(existing)}\n\nBLOCOS ALVO (preserve personagem/tipo quando já escolhidos):\n${JSON.stringify(targets)}\n\n${PROTECTED_RULES}\n\nDIVERSIDADE DRAMÁTICA:\nDistribua funções diferentes entre os blocos: dúvida, defesa, suspeita, culpa, ciúme, ironia, medo, proteção, tensão, negação, contraste, silêncio ou percepção.\n${section.shortLines ? "Use falas e pensamentos curtos, preferencialmente com até 12 palavras." : ""}\nRetorne somente JSON: {"reactions":[{"characterId":"id","type":"speech|thought|silent","emotion":"...","text":"..."}]}.`;
  const result = await callAi(body.settings, prompt, reactionSchema(characterIds, targetIndices.length));
  const reactions = Array.isArray(result.data?.reactions) ? result.data.reactions : [];
  if (reactions.length !== targetIndices.length) throw new Error("A IA retornou uma quantidade diferente de blocos.");
  const normalized = reactions.map((reaction, index) => {
    const target = targets[index].block;
    const characterId = target.characterId && characterIds.includes(target.characterId) ? target.characterId : reaction.characterId;
    const type = target.type || reaction.type;
    return {
      characterId: characterIds.includes(characterId) ? characterId : characterIds[0],
      type: ["speech", "thought", "silent"].includes(type) ? type : "speech",
      emotion: String(reaction.emotion || ""),
      text: type === "silent" ? "" : String(reaction.text || ""),
    };
  });
  return { reactions: normalized, model: result.model };
}

async function blockAction(body) {
  const section = body.section || {};
  const block = section.reactionBlocks?.[body.blockIndex];
  if (!block?.characterId) throw new Error("Escolha o personagem deste bloco.");
  const characterIds = (body.characters || []).map((character) => character.id).filter(Boolean);
  const previous = (section.reactionBlocks || []).slice(0, body.blockIndex).reverse().find((item) => item.characterId && (item.text || item.emotion));
  const next = (section.reactionBlocks || []).slice(body.blockIndex + 1).find((item) => item.characterId && (item.text || item.emotion));
  const prompt = `${body.action === "rewrite" ? "Reescreva somente a frase do bloco alvo, preservando personagem, tipo, fatos, intenção e sentido." : "Crie uma alternativa para o bloco alvo sem quebrar a conversa."}\n\nPERSONAGENS:\n${compactCharacters(body.characters)}\n\nCONTEXTO GERAL:\n${body.generalContext || "Não informado."}\n\nREGRAS GLOBAIS:\n${rulesText(body.globalRules)}\n\nHISTÓRICO:\n${compactHistory(body.previousSections, body.settings?.historyLimit)}\n\nDESCRIÇÃO DO VÍDEO:\n${section.description || ""}\n\nOBJETIVO:\n${section.sceneGoal || "Não informado."}\n\nLINHA DO TEMPO:\n${timelineNotice(section.timeline)}\n\nBLOCO ANTERIOR:\n${JSON.stringify(previous || null)}\n\nBLOCO ALVO:\n${JSON.stringify(block)}\n\nBLOCO SEGUINTE:\n${JSON.stringify(next || null)}\n\n${PROTECTED_RULES}\n\nREGRAS FINAIS:\n- Use characterId ${block.characterId}.\n- Use type ${block.type}.\n- Se for silent, deixe text vazio.\n- Retorne exatamente uma reação.\nRetorne somente JSON no formato solicitado.`;
  const result = await callAi(body.settings, prompt, reactionSchema(characterIds, 1));
  const reaction = result.data?.reactions?.[0];
  if (!reaction) throw new Error("A IA não retornou o bloco.");
  return { reaction: { characterId: block.characterId, type: block.type, emotion: String(reaction.emotion || ""), text: block.type === "silent" ? "" : String(reaction.text || "") }, model: result.model };
}

async function translate(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error("Não há falas ou pensamentos para traduzir.");
  const schema = {
    type: "object",
    properties: { translations: { type: "array", minItems: items.length, maxItems: items.length, items: { type: "object", properties: { id: { type: "string" }, translatedText: { type: "string" } }, required: ["id", "translatedText"], additionalProperties: false } } },
    required: ["translations"], additionalProperties: false,
  };
  const prompt = `Traduza todos os itens para inglês natural, mantendo intenção, personalidade, tom e subtexto.\n\nCENA:\n${body.sceneDescription || "Não informada."}\n\nITENS:\n${JSON.stringify(items)}\n\nREGRAS:\n- Não adicione informação.\n- Não explique.\n- Preserve ids e nomes próprios.\n- Retorne exatamente ${items.length} traduções.\nRetorne somente JSON: {"translations":[{"id":"...","translatedText":"..."}]}.`;
  const result = await callAi(body.settings, prompt, schema);
  const translations = Array.isArray(result.data?.translations) ? result.data.translations : [];
  if (translations.length !== items.length) throw new Error("A IA retornou uma quantidade diferente de traduções.");
  return { translations, model: result.model };
}

export function createRoteirosService(rootFolder) {
  const root = resolve(rootFolder);
  const statePath = join(root, "estado.json");
  const backupsRoot = join(root, "backups");
  let state = structuredClone(EMPTY_STATE);
  let writeQueue = Promise.resolve();
  let activeAiRequests = 0;
  let lastBackupAt = 0;
  let studioAiLoaded = null;

  async function init() {
    await Promise.all([mkdir(root, { recursive: true }), mkdir(backupsRoot, { recursive: true })]);
    try {
      state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeJsonAtomic(statePath, state);
    }
  }

  function save(nextState) {
    const normalized = normalizeState(nextState);
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      if (Date.now() - lastBackupAt > 5 * 60 * 1000) {
        try {
          await stat(statePath);
          const backupPath = join(backupsRoot, `roteiros-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
          if (inside(backupsRoot, backupPath)) await copyFile(statePath, backupPath);
          lastBackupAt = Date.now();
          const backups = (await readdir(backupsRoot)).filter((name) => name.endsWith(".json")).sort();
          for (const oldName of backups.slice(0, -20)) {
            const oldPath = join(backupsRoot, oldName);
            if (inside(backupsRoot, oldPath)) await rm(oldPath, { force: true });
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      state = normalized;
      await writeJsonAtomic(statePath, state);
    });
    return writeQueue;
  }

  async function handle(request, response, url, corsHeaders) {
    const isRoteirosRoute = url.pathname.startsWith("/roteiros/");
    const isStudioAiRoute = url.pathname.startsWith("/studio/ai/");
    if (!isRoteirosRoute && !isStudioAiRoute) return false;
    const headers = corsHeaders(request);
    try {
      if (request.method === "POST" && url.pathname === "/studio/ai/unload") {
        await unloadStudioModel(studioAiLoaded);
        studioAiLoaded = null;
        sendJson(response, headers, 200, { ok: true });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/studio/ai/warmup") {
        if (activeAiRequests >= 2) throw Object.assign(new Error("Já existem gerações em andamento. Aguarde um instante."), { status: 429 });
        activeAiRequests += 1;
        try {
          const targetSettings = studioSettings(state.settings);
          const targetConfig = providerConfig(targetSettings);
          if (studioAiLoaded && (studioAiLoaded.provider !== targetConfig.provider || studioAiLoaded.baseUrl !== targetConfig.baseUrl || studioAiLoaded.model !== targetConfig.model)) {
            await unloadStudioModel(studioAiLoaded);
            studioAiLoaded = null;
          }
          const result = await warmStudioModel(targetSettings);
          studioAiLoaded = result.config;
          sendJson(response, headers, 200, { ok: true, model: result.model });
          return true;
        } finally {
          activeAiRequests -= 1;
        }
      }
      if (request.method === "POST" && url.pathname === "/studio/ai/translate") {
        if (activeAiRequests >= 2) throw Object.assign(new Error("Já existe uma geração em andamento. Aguarde um instante."), { status: 429 });
        activeAiRequests += 1;
        try {
          const body = await readJson(request);
          const text = String(body?.text || "").trim();
          if (!text) throw new Error("Digite um texto antes de gerar o inglês.");
          const translationSettings = { ...studioSettings(state.settings), bubbleType: body?.bubbleType };
          const targetConfig = providerConfig(translationSettings);
          if (studioAiLoaded && (studioAiLoaded.provider !== targetConfig.provider || studioAiLoaded.baseUrl !== targetConfig.baseUrl || studioAiLoaded.model !== targetConfig.model)) {
            await unloadStudioModel(studioAiLoaded);
            studioAiLoaded = null;
          }
          const result = await translateStudioText(translationSettings, text);
          studioAiLoaded = result.config;
          sendJson(response, headers, 200, { translatedText: result.translatedText, model: result.model });
          return true;
        } finally {
          activeAiRequests -= 1;
        }
      }
      if (request.method === "GET" && url.pathname === "/roteiros/state") {
        sendJson(response, headers, 200, state);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/roteiros/state") {
        await save(await readJson(request));
        sendJson(response, headers, 200, { ok: true });
        return true;
      }
      if (request.method === "POST" && url.pathname.startsWith("/roteiros/ai/")) {
        if (activeAiRequests >= 2) throw Object.assign(new Error("Já existem gerações em andamento. Aguarde um instante."), { status: 429 });
        activeAiRequests += 1;
        try {
          const body = await readJson(request);
          let result;
          if (url.pathname === "/roteiros/ai/models") result = { models: await listModels(body.settings) };
          else if (url.pathname === "/roteiros/ai/test") result = { ok: true, models: await listModels(body.settings) };
          else if (url.pathname === "/roteiros/ai/improve-context") result = await improveContext(body);
          else if (url.pathname === "/roteiros/ai/generate") result = await generateReactions(body);
          else if (url.pathname === "/roteiros/ai/block") result = await blockAction(body);
          else if (url.pathname === "/roteiros/ai/translate") result = await translate(body);
          else throw Object.assign(new Error("Ação de IA não encontrada."), { status: 404 });
          sendJson(response, headers, 200, result);
          return true;
        } finally {
          activeAiRequests -= 1;
        }
      }
      sendJson(response, headers, 404, { error: "Rota de Roteiros não encontrada" });
      return true;
    } catch (error) {
      sendJson(response, headers, error?.status || 400, { error: error?.message || "Erro no módulo Roteiros" });
      return true;
    }
  }

  return { init, handle };
}
