"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAiPromptCatalog, resetAiPromptOverride, saveAiPromptOverride, type AiPromptCatalogEntry, type AiPromptSnapshot, type AiUsageSummary } from "../storage";
import styles from "../roteiros.module.css";

function formatDate(value: string | null | undefined) {
  if (!value) return "sem execução";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date) : "data desconhecida";
}

function usageText(snapshot: AiPromptSnapshot | null) {
  if (!snapshot?.usage) return "uso não informado";
  const usage = snapshot.usage as Record<string, unknown>;
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  return total ? `${total} tokens` : "uso não informado";
}

function snapshotText(snapshot: AiPromptSnapshot | null) {
  if (!snapshot) return "Nenhuma execução registrada para esta operação. Execute o botão correspondente em um roteiro para capturar o prompt real.";
  return `=== INSTRUCTIONS / SYSTEM ===\n${snapshot.instructions || "(vazio)"}\n\n=== INPUT / PROMPT COMPLETO ===\n${snapshot.input || "(vazio)"}`;
}

function numberText(value: number) { return new Intl.NumberFormat("pt-BR").format(Math.max(0, Math.round(value || 0))); }

export default function PromptSettingsV2({ pcAvailable }: { pcAvailable: boolean }) {
  const [operations, setOperations] = useState<AiPromptCatalogEntry[]>([]);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const selectedIdRef = useRef("");

  const refresh = useCallback(async () => {
    if (!pcAvailable) { setMessage("O servidor local está indisponível; não é possível carregar o catálogo."); return; }
    setLoading(true); setMessage("");
    try {
      const result = await loadAiPromptCatalog();
      setOperations(result.operations);
      setUsage(result.usage ?? null);
      const nextId = result.operations.some((entry) => entry.id === selectedIdRef.current) ? selectedIdRef.current : result.operations[0]?.id || "";
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      setDraft(result.operations.find((entry) => entry.id === nextId)?.customPrompt || "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível carregar os prompts."); }
    finally { setLoading(false); }
  }, [pcAvailable]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return operations.filter((entry) => !normalized || `${entry.label} ${entry.button} ${entry.id}`.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [operations, query]);
  const selected = operations.find((entry) => entry.id === selectedId) || visible[0] || null;
  const selectOperation = (entry: AiPromptCatalogEntry) => { selectedIdRef.current = entry.id; setSelectedId(entry.id); setDraft(entry.customPrompt || ""); setMessage(""); };

  const save = async () => {
    if (!selected || !selected.editable) return;
    setLoading(true); setMessage("");
    try {
      await saveAiPromptOverride(selected.id, draft);
      await refresh();
      setMessage("Prompt personalizado salvo.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar o prompt."); }
    finally { setLoading(false); }
  };

  const reset = async () => {
    if (!selected || !selected.editable || !window.confirm(`Restaurar o prompt padrão de “${selected.label}”?`)) return;
    setLoading(true); setMessage("");
    try { await resetAiPromptOverride(selected.id); await refresh(); setDraft(""); setMessage("Prompt padrão restaurado."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível restaurar o prompt."); }
    finally { setLoading(false); }
  };

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copiado.`); }
    catch { setMessage("Não foi possível copiar para a área de transferência."); }
  };

  return <main className={styles.settingsPage}>
    <section className={styles.heroRow}><div><span className={styles.eyebrow}>INSPEÇÃO DA API</span><h1>Configurações v2</h1><p>Veja e edite os prompts usados pelas operações de IA de Roteiros.</p></div><button className={styles.secondaryButton} onClick={() => void refresh()} disabled={loading}>↻ Atualizar catálogo</button></section>
    {!pcAvailable && <div className={styles.aiWarning} role="status">Servidor local indisponível. O catálogo e as personalizações ficam temporariamente indisponíveis.</div>}
    {usage && <section className={styles.summaryGrid} aria-label="Uso acumulado da IA"><article><span>TOKENS TOTAIS</span><strong>{numberText(usage.totalTokens)}</strong><small>{numberText(usage.inputTokens)} entrada · {numberText(usage.outputTokens)} saída</small></article><article><span>CHAMADAS</span><strong>{numberText(usage.calls)}</strong><small>inclui tentativas e lotes</small></article><article><span>ÚLTIMA OPERAÇÃO</span><strong>{usage.lastOperation ? usage.lastOperation.replace("roteiros.", "") : "—"}</strong><small>{usage.lastModel || "modelo não informado"}</small></article></section>}
    <div className={styles.promptCatalogLayout}>
      <aside className={styles.promptOperationList} aria-label="Operações de IA"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar operação…" />{visible.map((entry) => <button key={entry.id} className={entry.id === selected?.id ? styles.active : ""} onClick={() => selectOperation(entry)}><strong>{entry.label}</strong><small>{entry.button} · {entry.promptKind === "none" ? "sem prompt" : entry.promptVersion === "custom" ? "personalizado" : "padrão"}</small></button>)}{!visible.length && <p className={styles.subtleEmpty}>Nenhuma operação encontrada.</p>}</aside>
      {selected ? <section className={styles.promptDetail} aria-live="polite">
        <div className={styles.promptDetailHeader}><div><span className={styles.eyebrow}>{selected.id}</span><h2>{selected.label}</h2><p>{selected.description}</p></div><span className={selected.promptVersion === "custom" ? styles.promptBadgeCustom : styles.promptBadge}>{selected.promptVersion === "custom" ? "PERSONALIZADO" : "PADRÃO"}</span></div>
        <div className={styles.promptMeta}><span><strong>Botão:</strong> {selected.button}</span><span><strong>Endpoint:</strong> {selected.endpoint}</span><span><strong>Variáveis:</strong> {selected.variables.length ? selected.variables.join(", ") : "nenhuma"}</span><span><strong>Última execução:</strong> {formatDate(selected.lastExecution?.sentAt)}</span></div>
        {selected.promptKind !== "none" && <section className={styles.promptEditorCard}><div className={styles.sectionTitle}><span>◇</span><div><h3>Prompt narrativo padrão</h3><p>Esta é a política usada quando não existe personalização. Dados e proteções são acrescentados separadamente pelo backend.</p></div></div><pre className={styles.promptPreview}>{selected.defaultPrompt || "Esta operação técnica não possui política narrativa."}</pre>{selected.defaultPrompt && <button className={styles.secondaryButton} onClick={() => void copy(selected.defaultPrompt, "Prompt padrão")}>Copiar padrão</button>}</section>}
        {selected.editable ? <section className={styles.promptEditorCard}><div className={styles.sectionTitle}><span>✎</span><div><h3>Prompt personalizado</h3><p>Quando salvo, este texto substitui somente o prompt narrativo padrão. Dados, schema e regras protegidas continuam ativos. Variáveis funcionais: {selected.variables.length ? selected.variables.map((variable) => `{{${variable}}}`).join(", ") : "nenhuma"}.</p></div></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={12000} rows={12} placeholder="Deixe vazio para usar o prompt narrativo padrão." /><div className={styles.inlineActions}><button className={styles.primaryButton} disabled={loading} onClick={() => void save()}>Salvar prompt</button><button className={styles.secondaryButton} disabled={loading || !selected.customPrompt} onClick={() => void reset()}>Restaurar padrão</button><span className={styles.aiStatus}>{draft.length}/12000</span></div></section> : selected.promptKind === "none" ? <section className={styles.promptEditorCard}><h3>Operação sem prompt</h3><p>Esta operação consulta dados técnicos e não envia conteúdo narrativo.</p></section> : null}
        <section className={styles.promptEditorCard}><div className={styles.sectionTitle}><span>⌕</span><div><h3>Último prompt realmente enviado</h3><p>{selected.lastExecution ? `${selected.lastExecution.provider} · ${selected.lastExecution.model || "modelo desconhecido"} · ${usageText(selected.lastExecution)} · ${selected.lastExecution.durationMs || "?"} ms · tentativa ${selected.lastExecution.attempt}` : "O prompt aparecerá aqui depois que o botão for usado."}</p></div></div><pre className={styles.promptPreview}>{snapshotText(selected.lastExecution)}</pre>{selected.lastExecution && <div className={styles.inlineActions}><button className={styles.secondaryButton} onClick={() => void copy(snapshotText(selected.lastExecution), "Prompt completo")}>Copiar prompt completo</button><button className={styles.secondaryButton} onClick={() => void copy(selected.lastExecution?.instructions || "", "Instruções")}>Copiar instruções</button><button className={styles.secondaryButton} onClick={() => void copy(selected.lastExecution?.input || "", "Contexto")}>Copiar contexto</button></div>}</section>
        <details className={styles.promptEditorCard}><summary>Ver schema e regras protegidas</summary><p>Essas regras não são substituídas pelo prompt personalizado. O formato final continua validado pelo backend e por Structured Outputs.</p><ol>{selected.protectedRules.map((rule) => <li key={rule}>{rule}</li>)}</ol></details>
        {selected.executions.length > 1 && <details className={styles.promptEditorCard}><summary>Ver tentativas recentes ({selected.executions.length})</summary>{selected.executions.slice().reverse().map((execution, index) => <article className={styles.promptExecutionRow} key={`${execution.sentAt}-${index}`}><strong>{formatDate(execution.sentAt)}</strong><span>{execution.status} · tentativa {execution.attempt} · {execution.model || "modelo desconhecido"}</span><button className={styles.secondaryButton} onClick={() => void copy(snapshotText(execution), "Prompt da tentativa")}>Copiar</button></article>)}</details>}
      </section> : <div className={styles.emptyState}><h2>Nenhuma operação selecionada</h2></div>}
    </div>
    {message && <p className={styles.aiStatus}>{message}</p>}
  </main>;
}
