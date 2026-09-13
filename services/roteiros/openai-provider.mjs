import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_MAX_OUTPUT = 2400;
const DEFAULT_TIMEOUT = 90_000;
const AVAILABLE_MODELS = ["gpt-5.6-luna"];

let usagePath = "";
let usage = { version: 1, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, errors: 0, lastCallAt: null, lastModel: null };

function cleanModel(value) {
  const model = String(value || DEFAULT_MODEL).trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) throw new Error("Modelo OpenAI inválido.");
  return model;
}

function config(settings = {}) {
  return {
    model: cleanModel(settings.openAiModel || DEFAULT_MODEL),
    reasoningEffort: ["low", "medium", "high"].includes(settings.openAiReasoningEffort) ? settings.openAiReasoningEffort : "medium",
    maxOutputTokens: Math.max(256, Math.min(8000, Number(settings.openAiMaxOutputTokens) || DEFAULT_MAX_OUTPUT)),
    timeoutMs: Math.max(5_000, Math.min(180_000, Number(settings.openAiTimeoutMs) || DEFAULT_TIMEOUT)),
  };
}

function key(environment = process.env) {
  const value = String(environment.OPENAI_API_KEY || "").trim();
  if (!value) throw Object.assign(new Error("OPENAI_API_KEY não está configurada no servidor local."), { status: 503, code: "OPENAI_KEY_MISSING" });
  return value;
}

function cancelled() { return Object.assign(new Error("Geração cancelada."), { status: 499, code: "AI_CANCELLED" }); }

async function request(url, init, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let callerAborted = false;
  const abort = () => { callerAborted = true; controller.abort(); };
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (callerAborted || externalSignal?.aborted) throw cancelled();
    if (error?.name === "AbortError") throw Object.assign(new Error("A OpenAI demorou demais para responder."), { status: 504, code: "OPENAI_TIMEOUT" });
    throw Object.assign(new Error("Não foi possível conectar à OpenAI."), { status: 503, code: "OPENAI_UNAVAILABLE" });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function apiError(response, body) {
  const message = String(body?.error?.message || body?.error || "").trim();
  if (response.status === 401 || response.status === 403) return Object.assign(new Error("A chave da OpenAI foi recusada. Verifique OPENAI_API_KEY."), { status: 401, code: "OPENAI_AUTH" });
  if (response.status === 429) return Object.assign(new Error("A OpenAI atingiu um limite de uso. Aguarde e tente novamente."), { status: 429, code: "OPENAI_RATE_LIMIT" });
  if (response.status >= 500) return Object.assign(new Error("A OpenAI está temporariamente indisponível."), { status: 503, code: "OPENAI_UNAVAILABLE" });
  return Object.assign(new Error(message || `A OpenAI respondeu com erro ${response.status}.`), { status: response.status || 502, code: "OPENAI_REQUEST" });
}

function outputText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const content = (Array.isArray(body?.output) ? body.output : []).flatMap((item) => Array.isArray(item?.content) ? item.content : []);
  const refusal = content.find((item) => item?.type === "refusal");
  if (refusal) throw Object.assign(new Error("A OpenAI recusou esta solicitação."), { status: 422, code: "OPENAI_REFUSAL" });
  const text = content.filter((item) => item?.type === "output_text").map((item) => item.text).join("\n").trim();
  if (text) return text;
  throw Object.assign(new Error("A OpenAI retornou uma resposta vazia."), { status: 422, code: "OPENAI_EMPTY" });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {
    const start = text.indexOf("{"); const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw Object.assign(new Error("A OpenAI retornou JSON inválido."), { status: 422, code: "OPENAI_INVALID_JSON" });
  }
}

async function record(callUsage, model, error = false) {
  usage = {
    ...usage,
    calls: usage.calls + (error ? 0 : 1),
    errors: usage.errors + (error ? 1 : 0),
    inputTokens: usage.inputTokens + Number(callUsage?.input_tokens || 0),
    outputTokens: usage.outputTokens + Number(callUsage?.output_tokens || 0),
    totalTokens: usage.totalTokens + Number(callUsage?.total_tokens || 0),
    lastCallAt: new Date().toISOString(),
    lastModel: model || usage.lastModel,
  };
  if (usagePath) await writeJsonAtomic(usagePath, usage).catch(() => undefined);
}

export async function configureOpenAiUsage(path) {
  usagePath = path;
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    if (saved && typeof saved === "object") usage = { ...usage, ...saved };
  } catch { /* primeiro uso ou arquivo inválido: começa limpo */ }
}

export function openAiStatus(settings = {}, environment = process.env) {
  const cfg = config(settings);
  return { configured: Boolean(String(environment.OPENAI_API_KEY || "").trim()), model: cfg.model, reasoningEffort: cfg.reasoningEffort, maxOutputTokens: cfg.maxOutputTokens, usage: structuredClone(usage) };
}

export function openAiModels(settings = {}) {
  const configured = cleanModel(settings.openAiModel || DEFAULT_MODEL);
  return [...new Set([...AVAILABLE_MODELS, configured])];
}

export async function testOpenAi(settings, signal, environment = process.env) {
  const cfg = config(settings); const startedAt = Date.now();
  const response = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key(environment)}` }, body: JSON.stringify({ model: cfg.model, input: "Responda somente OK.", store: false, max_output_tokens: 16, reasoning: { effort: cfg.reasoningEffort } }) }, 30_000, signal);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { await record(body.usage, cfg.model, true); throw apiError(response, body); }
  const text = outputText(body); await record(body.usage, cfg.model);
  return { ok: true, provider: "openai", model: body.model || cfg.model, response: text, durationMs: Date.now() - startedAt, usage: body.usage || {} };
}

export async function callOpenAi(settings, { instructions, input, schema, operation = "generate" }, signal, environment = process.env) {
  const cfg = config(settings); const startedAt = Date.now();
  const payload = { model: cfg.model, instructions, input, store: false, max_output_tokens: cfg.maxOutputTokens, reasoning: { effort: cfg.reasoningEffort }, text: { format: { type: "json_schema", name: `nymi_${String(operation).replace(/[^a-z0-9_]+/gi, "_").slice(0, 50)}`, strict: true, schema } } };
  const response = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key(environment)}` }, body: JSON.stringify(payload) }, cfg.timeoutMs, signal);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { await record(body.usage, cfg.model, true); throw apiError(response, body); }
  const parsed = parseJson(outputText(body)); await record(body.usage, cfg.model);
  return { data: parsed, model: body.model || cfg.model, usage: body.usage || {}, durationMs: Date.now() - startedAt, responseId: body.id || null };
}
