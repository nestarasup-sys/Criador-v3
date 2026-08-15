import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { emptyRoteirosState, normalizeRoteirosState as normalizeState, validateRoteirosState } from "../../app/domain/document-schemas.mjs";

const EMPTY_STATE = emptyRoteirosState();
const AI_TIMEOUT_MS = 45_000;
const AI_QUEUE_LIMIT = 4;
const AI_MAX_TARGET_BLOCKS = 32;
const AI_MAX_CONTEXT_CHARACTERS = 12;
const AI_MAX_PROMPT_FIELD = 700;
const AI_MAX_GENERATED_TEXT = 2_000;
const AI_MAX_GENERATED_EMOTION = 600;

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
  if (response.writableEnded || response.destroyed) return;
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

function promptText(value, limit = AI_MAX_PROMPT_FIELD) {
  const text = String(value ?? "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
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

function cancelledAiError() {
  return Object.assign(new Error("Geração cancelada."), { code: "AI_CANCELLED", status: 499 });
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancelledAiError();
}

async function fetchWithTimeout(url, init = {}, timeoutMs = AI_TIMEOUT_MS, externalSignal) {
  const controller = new AbortController();
  let cancelledByCaller = false;
  const abortFromCaller = () => {
    cancelledByCaller = true;
    controller.abort();
  };
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (cancelledByCaller || externalSignal?.aborted) throw cancelledAiError();
    if (error?.name === "AbortError") throw new Error("A IA demorou demais para responder.");
    if (error instanceof TypeError) throw new Error("Não foi possível conectar ao provedor local de IA.");
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
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

async function listModels(settings, signal) {
  const provider = settings?.aiProvider;
  if (provider !== "lmstudio" && provider !== "ollama") throw new Error("Selecione LM Studio ou Ollama nas configurações.");
  const config = { provider, baseUrl: safeLocalBaseUrl(settings.aiBaseUrl, provider) };
  const endpoint = config.provider === "ollama"
    ? `${config.baseUrl.replace(/\/api(?:\/.*)?$/, "")}/api/tags`
    : `${config.baseUrl}/models`;
  const response = await fetchWithTimeout(endpoint, {}, 12_000, signal);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`O provedor respondeu com erro ${response.status}.`);
  if (config.provider === "ollama") return (data.models || []).map((item) => item.name || item.model).filter(Boolean);
  return (data.data || []).map((item) => item.id).filter(Boolean);
}

async function testSelectedModel(settings, signal) {
  const config = providerConfig(settings);
  if (config.provider === "ollama") {
    const base = config.baseUrl.replace(/\/api(?:\/.*)?$/, "");
    const response = await fetchWithTimeout(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: 8, num_ctx: 512 },
        messages: [{ role: "user", content: "Responda somente: OK" }],
      }),
    }, 30_000, signal);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `O Ollama respondeu com erro ${response.status}.`);
    if (!data.message?.content) throw new Error("O modelo não retornou resposta.");
    return { ok: true, model: data.model || config.model, provider: config.provider, response: String(data.message.content).trim() };
  }
  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, stream: false, temperature: 0, max_tokens: 8, messages: [{ role: "user", content: "Responda somente: OK" }] }),
  }, 30_000, signal);
  const data = await response.json().catch(() => ({}));
  const detail = typeof data.error === "string" ? data.error : data.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  if (!data.choices?.[0]?.message?.content) throw new Error("O modelo não retornou resposta.");
  return { ok: true, model: data.model || config.model, provider: config.provider, response: String(data.choices[0].message.content).trim() };
}

async function callAi(settings, prompt, schema, system = "Você escreve roteiros de reação para personagens fictícios. Responda somente com JSON válido.", signal, options = {}) {
  const config = providerConfig(settings);
  const numPredict = Math.max(64, Math.min(1_200, Number(options.numPredict) || 800));
  if (config.provider === "ollama") {
    const base = config.baseUrl.replace(/\/api(?:\/.*)?$/, "");
    const response = await fetchWithTimeout(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        keep_alive: -1,
        think: false,
        format: schema,
        options: { temperature: config.temperature, num_predict: numPredict, num_ctx: 4096 },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    }, AI_TIMEOUT_MS, signal);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `O Ollama respondeu com erro ${response.status}.`);
    if (!data.message?.content) throw new Error("O Ollama retornou uma resposta vazia.");
    return { data: extractJson(data.message.content), model: data.model || config.model };
  }

  const payload = {
    model: config.model,
    stream: false,
    temperature: config.temperature,
    max_tokens: numPredict,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: { name: "gacha_roteiros_response", strict: true, schema } },
  };
  let response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, AI_TIMEOUT_MS, signal);
  let result = await response.json().catch(() => ({}));
  if (!response.ok && response.status === 400) {
    response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, response_format: { type: "json_object" } }),
    }, AI_TIMEOUT_MS, signal);
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

async function translateStudioText(settings, text, signal) {
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
    }, AI_TIMEOUT_MS, signal);
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
  }, AI_TIMEOUT_MS, signal);
  const result = await response.json().catch(() => ({}));
  const detail = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  const translatedText = cleanTranslation(result.choices?.[0]?.message?.content);
  if (!translatedText) throw new Error("A IA retornou uma tradução vazia.");
  return { translatedText, model: result.model || config.model, config };
}

async function warmStudioModel(settings, signal, contextSize = 2048) {
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
        options: { num_predict: 1, num_ctx: contextSize },
      }),
    }, 120_000, signal);
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
  }, 120_000, signal);
  const result = await response.json().catch(() => ({}));
  const detail = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  return { model: result.model || config.model, config };
}

async function unloadStudioModel(loaded, signal) {
  if (!loaded) return;
  try {
    if (loaded.provider === "ollama") {
      const base = loaded.baseUrl.replace(/\/api(?:\/.*)?$/, "");
      await fetchWithTimeout(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: loaded.model, prompt: "", stream: false, keep_alive: 0 }),
      }, 12_000, signal);
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
          }, 12_000, signal);
          if (response.ok) break;
        } catch { /* Some LM Studio versions do not expose an unload endpoint. */ }
      }
    }
  } catch { /* Leaving Studio must never be blocked by an optional unload call. */ }
}

function rulesText(rules) {
  const enabled = (Array.isArray(rules) ? rules : []).filter((rule) => rule?.enabled && String(rule.description || "").trim());
  if (!enabled.length) return "Nenhuma regra personalizada ativa.";
  return enabled.slice(0, 16).map((rule) => `[${String(rule.priority || "normal").toUpperCase()}] ${promptText(rule.title, 120)}: ${promptText(rule.description, AI_MAX_PROMPT_FIELD)}`).join("\n");
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
            // Ollama's grammar parser does not accept maxLength; size limits
            // are enforced immediately after parsing the provider response.
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
  const compact = (characters || []).map((character, index) => {
    const basic = { id: character.id, nome: promptText(character.name, 120), genero: character.gender };
    if (index >= AI_MAX_CONTEXT_CHARACTERS) return { ...basic, observacao: "Ficha detalhada omitida pelo orçamento de contexto." };
    return {
      ...basic,
      personalidade: promptText(character.personality, AI_MAX_PROMPT_FIELD),
      historia: promptText(character.backstory, AI_MAX_PROMPT_FIELD),
      relacaoComFyn: promptText(character.fynRelationship, AI_MAX_PROMPT_FIELD),
      estiloDeFala: promptText(character.speakingStyle, AI_MAX_PROMPT_FIELD),
      regrasParticulares: promptText(character.additionalRules, AI_MAX_PROMPT_FIELD),
      relacoes: (Array.isArray(character.relationships) ? character.relationships : []).slice(0, 12).map((relationship) => ({
        targetCharacterId: relationship.targetCharacterId,
        targetCharacterName: promptText(relationship.targetCharacterName, 120),
        description: promptText(relationship.description, 800),
      })),
    };
  });
  return JSON.stringify(compact);
}

function compactHistory(previousSections, limit) {
  const compact = (previousSections || []).slice(-Math.min(6, Math.max(1, Number(limit) || 5))).map((section, index) => ({
    ordem: index + 1,
    titulo: promptText(section.title, 120),
    descricao: promptText(section.description, AI_MAX_PROMPT_FIELD),
    linhaTemporal: section.timeline || "unspecified",
    reacoes: (section.reactionBlocks || []).filter((block) => block.characterId && (block.text || block.emotion)).slice(-12).map((block) => ({
      characterId: block.characterId,
      type: block.type,
      emotion: promptText(block.emotion, 300),
      text: promptText(block.text, 700),
    })),
  }));
  return JSON.stringify(compact);
}

function compactBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).slice(0, AI_MAX_TARGET_BLOCKS).map((block) => ({
    id: block.id,
    characterId: block.characterId || "",
    type: block.type || "auto",
    emotion: promptText(block.emotion, 300),
    text: promptText(block.text, 700),
  }));
}

function targetIndicesFor(section, value) {
  const raw = Array.isArray(value) ? value : [];
  const blockCount = Array.isArray(section.reactionBlocks) ? section.reactionBlocks.length : 0;
  const indices = [...new Set(raw.map((index) => Number(index)).filter((index) => Number.isInteger(index) && index >= 0 && index < blockCount))];
  if (raw.length !== indices.length) throw new Error("A IA recebeu blocos-alvo inválidos. Atualize o roteiro e tente novamente.");
  if (indices.length > AI_MAX_TARGET_BLOCKS) throw new Error(`Selecione no máximo ${AI_MAX_TARGET_BLOCKS} blocos por geração.`);
  return indices;
}

function normalizedReaction(reaction, target, characterIds, index) {
  const requestedCharacterId = target?.characterId;
  const characterId = requestedCharacterId && characterIds.includes(requestedCharacterId) ? requestedCharacterId : reaction?.characterId;
  const requestedType = target?.type;
  const type = requestedType === "auto" || !requestedType ? reaction?.type : requestedType;
  const normalizedType = ["speech", "thought", "silent"].includes(type) ? type : "speech";
  const emotion = promptText(reaction?.emotion, AI_MAX_GENERATED_EMOTION);
  const text = normalizedType === "silent" ? "" : promptText(reaction?.text, AI_MAX_GENERATED_TEXT);
  if (!characterIds.includes(characterId)) throw new Error(`A IA retornou um personagem inválido no bloco ${index + 1}.`);
  if (normalizedType === "silent" && !emotion) throw new Error(`A IA retornou uma reação silenciosa sem emoção no bloco ${index + 1}.`);
  if (normalizedType !== "silent" && !text) throw new Error(`A IA retornou uma fala/pensamento vazio no bloco ${index + 1}.`);
  return { characterId, type: normalizedType, emotion, text };
}

async function improveContext(body, signal) {
  const schema = { type: "object", properties: { improvedContext: { type: "string" } }, required: ["improvedContext"], additionalProperties: false };
  const prompt = `Reescreva a descrição do vídeo para ficar clara para uma IA gerar reações de espectadores.\n\nDESCRIÇÃO ORIGINAL:\n${promptText(body.description, 1_400)}\n\nCONTEXTO GERAL:\n${promptText(body.generalContext, 1_000) || "Não informado."}\n\nOBJETIVO:\n${promptText(body.sceneGoal, 500) || "Não informado."}\n\nLINHA DO TEMPO:\n${timelineNotice(body.timeline)}\n\nINSTRUÇÃO:\n${promptText(body.userInstruction, 700) || "Nenhuma."}\n\nHISTÓRICO:\n${JSON.stringify((Array.isArray(body.previousDescriptions) ? body.previousDescriptions : []).slice(-6).map((description) => promptText(description, 500)))}\n\nREGRAS:\n- Preserve todos os fatos.\n- Não invente personagens, ações, falas, emoções ou motivos.\n- Deixe claro quem pratica e quem sofre cada ação.\n- Preserve incertezas.\n- Escreva em português brasileiro.\n- Retorne somente JSON no formato {"improvedContext":"..."}.`;
  const result = await callAi(body.settings, prompt, schema, undefined, signal, { numPredict: 500 });
  if (!result.data?.improvedContext) throw new Error("A IA não retornou o contexto melhorado.");
  return { improvedContext: String(result.data.improvedContext), model: result.model };
}

async function generateReactions(body, signal) {
  const opening = body.opening === true;
  const section = opening
    ? { ...(body.section || {}), description: `ABERTURA ANTES DOS VÍDEOS (não reaja a um vídeo ainda não iniciado):\n${body.section?.description || ""}` }
    : (body.section || {});
  const targetIndices = targetIndicesFor(section, body.targetIndices);
  const characterIds = (body.characters || []).map((character) => character.id).filter(Boolean);
  if (!characterIds.length) throw new Error("Selecione pelo menos um personagem ativo.");
  if (!targetIndices.length) throw new Error("Não há blocos para gerar.");
  if (!String(section.description || "").trim()) throw new Error(opening ? "Descreva a abertura antes de gerar." : "Escreva a descrição do TikTok antes de gerar.");
  const targets = targetIndices.map((index) => ({ index, block: compactBlocks([section.reactionBlocks?.[index] || {}])[0] || {} }));
  const existing = body.mode === "replace-all" ? [] : (section.reactionBlocks || []).filter((block) => block.characterId && (block.text || block.emotion));
  section.userInstruction = `TIPO DOS BLOCOS:\n- Para type auto, escolha entre speech, thought e silent conforme a reação.\n- Para speech, thought ou silent, preserve o tipo escolhido pelo usuário.\n\n${section.userInstruction || ""}`;
  const prompt = `Crie EXATAMENTE ${targetIndices.length} blocos novos de uma sala de reação. A sequência deve parecer uma conversa contínua.\n\nMODO:\n${body.mode === "replace-all" ? "Substituir todos os blocos." : "Preencher somente os blocos vazios."}\n\nPERSONAGENS:\n${compactCharacters(body.characters)}\n\nCONTEXTO GERAL:\n${promptText(body.generalContext, 1_000) || "Não informado."}\n\nREGRAS PERSONALIZADAS DESTE ROTEIRO:\n${rulesText(body.globalRules)}\n\nHISTÓRICO RECENTE:\n${compactHistory(body.previousSections, body.settings?.historyLimit)}\n\nDESCRIÇÃO LITERAL DO VÍDEO:\n${promptText(section.description, 1_400)}\n\nOBJETIVO:\n${promptText(section.sceneGoal, 500) || "Não informado."}\n\nLINHA DO TEMPO:\n${timelineNotice(section.timeline)}\n\nREGRAS ESPECÍFICAS DESTE TIKTOK:\n${promptText(section.specificRules, 700) || "Nenhuma."}\n\nINSTRUÇÃO ADICIONAL:\n${promptText(section.userInstruction, 700) || "Nenhuma."}\n\nREAÇÕES EXISTENTES:\n${JSON.stringify(compactBlocks(existing))}\n\nBLOCOS ALVO (preserve personagem/tipo quando já escolhidos):\n${JSON.stringify(targets)}\n\n${PROTECTED_RULES}\n\nDIVERSIDADE DRAMÁTICA:\nDistribua funções diferentes entre os blocos: dúvida, defesa, suspeita, culpa, ciúme, ironia, medo, proteção, tensão, negação, contraste, silêncio ou percepção.\n${section.shortLines ? "Use falas e pensamentos curtos, preferencialmente com até 12 palavras." : ""}\nRetorne somente JSON: {"reactions":[{"characterId":"id","type":"speech|thought|silent","emotion":"...","text":"..."}]}.`;
  const result = await callAi(body.settings, prompt, reactionSchema(characterIds, targetIndices.length), undefined, signal, { numPredict: Math.min(900, 300 + targetIndices.length * 140) });
  const reactions = Array.isArray(result.data?.reactions) ? result.data.reactions : [];
  if (reactions.length !== targetIndices.length) throw new Error("A IA retornou uma quantidade diferente de blocos.");
  const normalized = reactions.map((reaction, index) => normalizedReaction(reaction, targets[index].block, characterIds, index));
  return { reactions: normalized, model: result.model };
}

async function blockAction(body, signal) {
  const opening = body.opening === true;
  const section = opening
    ? { ...(body.section || {}), description: `ABERTURA ANTES DOS VÍDEOS (não reaja a um vídeo ainda não iniciado):\n${body.section?.description || ""}` }
    : (body.section || {});
  const block = section.reactionBlocks?.[body.blockIndex];
  if (!block?.characterId) throw new Error("Escolha o personagem deste bloco.");
  const characterIds = (body.characters || []).map((character) => character.id).filter(Boolean);
  const previous = (section.reactionBlocks || []).slice(0, body.blockIndex).reverse().find((item) => item.characterId && (item.text || item.emotion));
  const next = (section.reactionBlocks || []).slice(body.blockIndex + 1).find((item) => item.characterId && (item.text || item.emotion));
  const prompt = `${body.action === "rewrite" ? "Reescreva somente a frase do bloco alvo, preservando personagem, tipo, fatos, intenção e sentido." : "Crie uma alternativa para o bloco alvo sem quebrar a conversa."}\n\nPERSONAGENS:\n${compactCharacters(body.characters)}\n\nCONTEXTO GERAL:\n${promptText(body.generalContext, 1_000) || "Não informado."}\n\nREGRAS DESTE ROTEIRO:\n${rulesText(body.globalRules)}\n\nHISTÓRICO:\n${compactHistory(body.previousSections, body.settings?.historyLimit)}\n\nDESCRIÇÃO DO VÍDEO:\n${promptText(section.description, 1_400)}\n\nOBJETIVO:\n${promptText(section.sceneGoal, 500) || "Não informado."}\n\nLINHA DO TEMPO:\n${timelineNotice(section.timeline)}\n\nBLOCO ANTERIOR:\n${JSON.stringify(compactBlocks(previous ? [previous] : []))}\n\nBLOCO ALVO:\n${JSON.stringify(compactBlocks([block]))}\n\nBLOCO SEGUINTE:\n${JSON.stringify(compactBlocks(next ? [next] : []))}\n\n${PROTECTED_RULES}\n\nREGRAS FINAIS:\n- Use characterId ${block.characterId}.\n- Use type ${block.type}.\n- Se for silent, deixe text vazio.\n- Retorne exatamente uma reação.\nRetorne somente JSON no formato solicitado.`;
  const result = await callAi(body.settings, prompt, reactionSchema(characterIds, 1), undefined, signal, { numPredict: 420 });
  const reaction = result.data?.reactions?.[0];
  if (!reaction) throw new Error("A IA não retornou o bloco.");
  return { reaction: normalizedReaction(reaction, block, characterIds, 0), model: result.model };
}

async function translate(body, signal) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error("Não há falas ou pensamentos para traduzir.");
  if (items.length > AI_MAX_TARGET_BLOCKS) throw new Error(`Traduza no máximo ${AI_MAX_TARGET_BLOCKS} falas ou pensamentos por vez.`);
  const schema = {
    type: "object",
    properties: { translations: { type: "array", minItems: items.length, maxItems: items.length, items: { type: "object", properties: { id: { type: "string" }, translatedText: { type: "string" } }, required: ["id", "translatedText"], additionalProperties: false } } },
    required: ["translations"], additionalProperties: false,
  };
  const compactItems = items.map((item) => ({ id: item.id, type: item.type, characterName: promptText(item.characterName, 120), text: promptText(item.text, AI_MAX_GENERATED_TEXT) }));
  const prompt = `Traduza todos os itens para inglês natural, mantendo intenção, personalidade, tom e subtexto.\n\nCENA:\n${promptText(body.sceneDescription, 1_500) || "Não informada."}\n\nITENS:\n${JSON.stringify(compactItems)}\n\nREGRAS:\n- Não adicione informação.\n- Não explique.\n- Preserve ids e nomes próprios.\n- Retorne exatamente ${items.length} traduções.\nRetorne somente JSON: {"translations":[{"id":"...","translatedText":"..."}]}.`;
  const result = await callAi(body.settings, prompt, schema, undefined, signal, { numPredict: Math.min(900, 220 + items.length * 100) });
  const translations = Array.isArray(result.data?.translations) ? result.data.translations : [];
  if (translations.length !== items.length) throw new Error("A IA retornou uma quantidade diferente de traduções.");
  if (translations.some((item) => !String(item?.id || "").trim() || !String(item?.translatedText || "").trim())) throw new Error("A IA retornou uma tradução vazia ou sem identificador.");
  return { translations, model: result.model };
}

export function createRoteirosService(rootFolder) {
  const root = resolve(rootFolder);
  const statePath = join(root, "estado.json");
  const backupsRoot = join(root, "backups");
  let state = structuredClone(EMPTY_STATE);
  let writeQueue = Promise.resolve();
  let aiQueueTail = Promise.resolve();
  let aiQueueSize = 0;
  let lastBackupAt = 0;
  let studioAiLoaded = null;

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
    backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
    await Promise.all([mkdir(root, { recursive: true }), mkdir(backupsRoot, { recursive: true })]);
    try {
      state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        await writeJsonAtomic(statePath, state);
        return;
      }
      const recovered = await findLatestValidBackup();
      const corruptedPath = join(root, `estado.corrompido-${Date.now()}.json`);
      try { await rename(statePath, corruptedPath); } catch { /* preserve original if quarantine is unavailable */ }
      state = recovered || structuredClone(EMPTY_STATE);
      await writeJsonAtomic(statePath, state);
    }
  }

  function save(nextState) {
    const normalized = normalizeState(nextState);
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

  async function handle(request, response, url, corsHeaders) {
    const isRoteirosRoute = url.pathname.startsWith("/roteiros/");
    const isStudioAiRoute = url.pathname.startsWith("/studio/ai/");
    if (!isRoteirosRoute && !isStudioAiRoute) return false;
    const headers = corsHeaders(request);
    const client = clientAbortController(response);
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
      if (request.method === "POST" && url.pathname.startsWith("/roteiros/ai/")) {
        const body = await readJson(request);
        const result = await enqueueAi(async (signal) => {
          if (url.pathname === "/roteiros/ai/models") return { models: await listModels(body.settings, signal) };
          if (url.pathname === "/roteiros/ai/test") return testSelectedModel(body.settings, signal);
          if (url.pathname === "/roteiros/ai/warmup") {
            const warmed = await warmStudioModel(body.settings, signal, 4096);
            studioAiLoaded = warmed.config;
            return { ok: true, model: warmed.model };
          }
          if (url.pathname === "/roteiros/ai/improve-context") return improveContext(body, signal);
          if (url.pathname === "/roteiros/ai/generate") return generateReactions(body, signal);
          if (url.pathname === "/roteiros/ai/block") return blockAction(body, signal);
          if (url.pathname === "/roteiros/ai/translate") return translate(body, signal);
          throw Object.assign(new Error("Ação de IA não encontrada."), { status: 404 });
        }, client.signal);
        sendJson(response, headers, 200, await result);
        return true;
      }
      sendJson(response, headers, 404, { error: "Rota de Roteiros não encontrada" });
      return true;
    } catch (error) {
      if (!client.signal.aborted) sendJson(response, headers, error?.status || 400, { error: error?.message || "Erro no módulo Roteiros" });
      return true;
    } finally {
      client.cleanup();
    }
  }

  return { init, handle };
}
