import { AI_SYSTEM_INSTRUCTIONS } from "../../app/domain/roteiro-prompt-contract.mjs";
import { callOpenAi, openAiModels, testOpenAi } from "./openai-provider.mjs";
import { createAiPromptSnapshot } from "./ai-prompt-catalog.mjs";

export const AI_TIMEOUT_MS = 90_000;
export const AI_MAX_PROMPT_FIELD = 700;
export const DEFAULT_AI_SYSTEM = AI_SYSTEM_INSTRUCTIONS;

export function safeLocalBaseUrl(value, provider) {
  const fallback = provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1";
  const parsed = new URL(String(value || fallback));
  if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error("A IA deve usar um endereço local (localhost ou 127.0.0.1).");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function safeModel(value) {
  const model = String(value || "").trim();
  if (!model) throw new Error("Selecione um modelo de IA.");
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) throw new Error("Nome de modelo inválido.");
  return model;
}

export function promptText(value, limit = AI_MAX_PROMPT_FIELD) {
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

export function cancelledAiError() {
  return Object.assign(new Error("Geração cancelada."), { code: "AI_CANCELLED", status: 499 });
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancelledAiError();
}

async export function fetchWithTimeout(url, init = {}, timeoutMs = AI_TIMEOUT_MS, externalSignal) {
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

export function providerConfig(settings) {
  const provider = settings?.aiProvider;
  if (provider === "openai") return { provider, model: String(settings?.openAiModel || "gpt-5.6-luna") };
  if (provider !== "lmstudio" && provider !== "ollama") throw new Error("Selecione uma IA local ou a OpenAI nas configurações.");
  return {
    provider,
    baseUrl: safeLocalBaseUrl(settings.aiBaseUrl, provider),
    model: safeModel(settings.aiModel),
    temperature: Math.max(0, Math.min(1.5, Number(settings.temperature) || 0.45)),
  };
}

async export function listModels(settings, signal) {
  const provider = settings?.aiProvider;
  if (provider === "openai") return openAiModels(settings);
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

async export function testSelectedModel(settings, signal) {
  const config = providerConfig(settings);
  if (config.provider === "openai") return testOpenAi(settings, signal);
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

async export function callAi(settings, prompt, schema, system = DEFAULT_AI_SYSTEM, signal, options = {}) {
  const config = providerConfig(settings);
  const operation = options.operation || "generate";
  const promptPreview = createAiPromptSnapshot({ operation, provider: config.provider, model: config.model, instructions: system, input: prompt, variables: options.variables || {} });
  if (config.provider === "openai") {
    const result = await callOpenAi(settings, { instructions: system, input: prompt, schema, operation }, signal);
    return { ...result, promptPreview: { ...promptPreview, model: result.model, usage: result.usage, durationMs: result.durationMs, status: "success" } };
  }
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
    const usage = { input_tokens: Number(data.prompt_eval_count || 0), output_tokens: Number(data.eval_count || 0), total_tokens: Number(data.prompt_eval_count || 0) + Number(data.eval_count || 0) };
    const result = { data: extractJson(data.message.content), model: data.model || config.model, usage };
    return { ...result, promptPreview: { ...promptPreview, model: result.model, status: "success" } };
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
  const parsed = { data: extractJson(content), model: result.model || config.model, usage: result.usage || {} };
  return { ...parsed, promptPreview: { ...promptPreview, model: parsed.model, status: "success" } };
}

export function studioSettings(settings) {
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

export function cleanTranslation(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();
}

async export function translateStudioText(settings, text, signal) {
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

async export function warmStudioModel(settings, signal, contextSize = 2048) {
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
    }, 90_000, signal);
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
  }, 90_000, signal);
  const result = await response.json().catch(() => ({}));
  const detail = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok || detail) throw new Error(detail || `O LM Studio respondeu com erro ${response.status}.`);
  return { model: result.model || config.model, config };
}

async export function unloadStudioModel(loaded, signal) {
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
