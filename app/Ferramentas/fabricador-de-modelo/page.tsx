"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ToolsTopbar } from "../components/ToolsTopbar";
import { localDataFetch } from "../../lib/local-data-client";
import { DEFAULT_CALIBRATION_SETTINGS, EXTENSION_EXPRESSIONS, PRIMARY_EXPRESSIONS } from "./constants/expressions";
import { processSheet } from "./core/build-model";
import type { CalibrationSettings, GeneratedSprite, SheetId, SheetResult, SpriteAdjustment } from "./types/face-model";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { ComparisonPlayer, type PlaybackMode } from "./components/ComparisonPlayer";
import { ExportPanel } from "./components/ExportPanel";
import { ManualAdjustmentPanel } from "./components/ManualAdjustmentPanel";
import { ModelSettingsPanel } from "./components/ModelSettingsPanel";
import { PreviewGrid } from "./components/PreviewGrid";
import { QualityPanel } from "./components/QualityPanel";
import { SheetUploader } from "./components/SheetUploader";
import { StatusMessage } from "./components/StatusMessage";
import styles from "../ferramentas.module.css";

function spritePayload(sheets: SheetResult[]) {
  return sheets.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])).map((sprite) => ({ fileName: `${sprite.key}.png`, dataUrl: sprite.dataUrl }));
}

function spriteKey(sheet: SheetId, index: number) {
  const expressions = sheet === "primary" ? PRIMARY_EXPRESSIONS : EXTENSION_EXPRESSIONS;
  const state = Math.floor(index / 7); const suffix = state === 0 ? "" : state === 1 ? "_blink" : "_talk";
  return `${expressions[index % 7]}${suffix}`;
}

function keyOf(sprite: GeneratedSprite) { return `${sprite.sourceSheet}:${sprite.key}`; }

function manualArray(sheet: SheetId, edits: Record<string, Partial<SpriteAdjustment>>) {
  return Array.from({ length: 21 }, (_, index) => edits[`${sheet}:${spriteKey(sheet, index)}`]);
}

export default function FabricadorDeModeloPage() {
  const [primary, setPrimary] = useState<File | null>(null);
  const [extension, setExtension] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetResult[]>([]);
  const [name, setName] = useState("Modelo novo");
  const [folderName, setFolderName] = useState("modelo-13");
  const [gender, setGender] = useState<"feminino" | "masculino">("feminino");
  const [settings, setSettings] = useState<CalibrationSettings>({ ...DEFAULT_CALIBRATION_SETTINGS });
  const [manualEdits, setManualEdits] = useState<Record<string, Partial<SpriteAdjustment>>>({});
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string>();
  const [view, setView] = useState<"all" | SheetId>("all");
  const [compareSheet, setCompareSheet] = useState<SheetId>("primary");
  const [compareColumn, setCompareColumn] = useState(0);
  const [compareState, setCompareState] = useState<"default" | "blink" | "talk">("default");
  const [playback, setPlayback] = useState<PlaybackMode>("static");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregue a Folha 1 para começar. A Folha 2 é opcional.");
  const [tone, setTone] = useState<"" | "error" | "ok">("");

  useEffect(() => {
    let active = true;
    void localDataFetch("/models", { cache: "no-store" }).then((response) => response.json()).then((models: Record<string, Array<{ id: string }>>) => {
      if (!active) return;
      const ids = (models.feminino ?? []).concat(models.masculino ?? []).map((model) => Number(model.id.match(/modelo-(\d+)/i)?.[1] ?? 0));
      const next = Math.max(0, ...ids) + 1;
      setName(`Modelo ${next}`); setFolderName(`modelo-${next}`);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const allSprites = useMemo(() => sheets.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])), [sheets]);
  const currentSprite = allSprites.find((sprite) => keyOf(sprite) === selectedKey) ?? allSprites[0];
  const primarySheet = sheets.find((sheet) => sheet.id === "primary");
  const extensionSheet = sheets.find((sheet) => sheet.id === "extension");
  const comparisonSourceSheet = compareSheet === "extension" ? extensionSheet : primarySheet;
  const comparisonExpression = comparisonSourceSheet?.expressions[compareColumn];
  const comparisonCurrent = comparisonExpression?.[compareState];
  const comparisonGhost = compareSheet === "primary" ? extensionSheet?.expressions[compareColumn]?.[compareState] : primarySheet?.expressions[compareColumn]?.[compareState];
  const comparisonTrio = comparisonExpression ? [comparisonExpression.default, comparisonExpression.blink, comparisonExpression.talk] : [];
  const criticalSprites = allSprites.filter((sprite) => sprite.quality.critical);
  const unreviewedCriticalCount = criticalSprites.filter((sprite) => !reviewed.has(keyOf(sprite)) && !sprite.adjustment.reviewed).length;
  const expectedCount = extension ? 42 : 21;

  async function generate(edits = manualEdits) {
    if (!primary) { setTone("error"); setMessage("A Folha 1 é obrigatória."); return; }
    setBusy(true); setTone(""); setMessage("Processando chroma, detecção, anatomia e calibração…");
    try {
      const base = await processSheet(primary, "primary", { settings, manualAdjustments: manualArray("primary", edits) });
      const result = extension ? [base, await processSheet(extension, "extension", { referenceMaster: base.headMaster, settings, manualAdjustments: manualArray("extension", edits) })] : [base];
      setSheets(result); setSelectedKey((current) => current && result.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])).some((sprite) => keyOf(sprite) === current) ? current : keyOf(result[0].expressions[0].default)); setTone("ok"); setMessage(`${result.reduce((total, sheet) => total + sheet.expressions.length * 3, 0)} sprites gerados. Revise a qualidade antes de salvar.`);
    } catch (error) { setSheets([]); setTone("error"); setMessage(error instanceof Error ? error.message : "Não foi possível processar a folha."); }
    finally { setBusy(false); }
  }

  function selectSprite(sprite: GeneratedSprite) {
    setSelectedKey(keyOf(sprite));
    const expressions = sprite.sourceSheet === "primary" ? PRIMARY_EXPRESSIONS : EXTENSION_EXPRESSIONS;
    const baseKey = sprite.key.replace(/_(blink|talk)$/, "");
    const column = expressions.indexOf(baseKey as never);
    if (column >= 0) { setCompareSheet(sprite.sourceSheet); setCompareColumn(column); setCompareState(sprite.state); }
  }

  async function applyAdjustment(adjustment: SpriteAdjustment) {
    if (!currentSprite) return;
    const next = { ...manualEdits, [keyOf(currentSprite)]: adjustment };
    setManualEdits(next); setReviewed((current) => { const copy = new Set(current); if (adjustment.reviewed) copy.add(keyOf(currentSprite)); else copy.delete(keyOf(currentSprite)); return copy; });
    await generate(next);
  }

  async function copyTrio() {
    if (!currentSprite) return;
    const next = { ...manualEdits };
    for (const state of ["default", "blink", "talk"] as const) next[`${currentSprite.sourceSheet}:${spriteKey(currentSprite.sourceSheet, compareColumn + (state === "default" ? 0 : state === "blink" ? 7 : 14))}`] = { ...currentSprite.adjustment };
    setManualEdits(next); await generate(next);
  }

  async function resetAdjustment() {
    if (!currentSprite) return;
    const next = { ...manualEdits }; delete next[keyOf(currentSprite)]; setManualEdits(next); await generate(next);
  }

  function reviewCurrent() {
    if (!currentSprite) return;
    setReviewed((current) => { const copy = new Set(current); copy.add(keyOf(currentSprite)); return copy; });
  }

  async function save() {
    if (allSprites.length !== expectedCount) { setTone("error"); setMessage(`Gere ${expectedCount} sprites antes de salvar.`); return; }
    if (unreviewedCriticalCount > 0) { setTone("error"); setMessage(`Não é possível salvar: ${unreviewedCriticalCount} rosto(s) críticos ainda não foram revisados.`); return; }
    setBusy(true); setTone(""); setMessage("Salvando modelo no catálogo local…");
    try {
      const response = await localDataFetch("/models/fabricator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folderName, gender, config: { anchorX: settings.anchorX, anchorY: settings.anchorY, baseScale: settings.baseScale, expressions: allSprites.map((sprite) => sprite.key) }, sprites: spritePayload(sheets) }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o modelo.");
      window.dispatchEvent(new CustomEvent("nymi:models-updated")); setTone("ok"); setMessage("Modelo salvo. O catálogo recebeu as expressões e já pode ser atualizado sem reiniciar a aplicação.");
    } catch (error) { setTone("error"); setMessage(error instanceof Error ? error.message : "Falha ao salvar o modelo."); }
    finally { setBusy(false); }
  }

  return <div className={styles.page}><ToolsTopbar title="Fabricador de Modelo" subtitle="Importador e calibrador head-only" /><main className={`${styles.main} ${styles.fabricatorMain}`}>
    <div className={styles.breadcrumb}><Link href="/Ferramentas">Ferramentas</Link><b>/</b><strong>Fabricador de Modelo</strong></div>
    <section className={styles.hero}><div><span className={styles.eyebrow}>Ferramenta nativa</span><h1>Fabricador de Modelo</h1><p>Transforme uma ou duas folhas de rostos em um modelo consistente, revise cada sprite e salve direto no catálogo local.</p></div><div className={styles.heroStat}><strong>{allSprites.length || 0}</strong><span>sprites prontos</span></div></section>
    <div className={styles.layout}><div>
      <section className={styles.panel}><div className={styles.panelHeading}><div><span className={styles.sectionLabel}>Entrada</span><h2>Folhas de rostos</h2><p>A Folha 1 é a base. A Folha 2 entra como extensão com escala X/Y limitada.</p></div><span className={styles.pipelineBadge}>21 + 21</span></div><div className={styles.uploadGrid}><SheetUploader title="Folha 1 · obrigatória" description="PNG, JPG ou WebP · 7 × 3" file={primary} onChange={setPrimary} /><SheetUploader title="Folha 2 · opcional" description="7 expressões adicionais · 7 × 3" file={extension} onChange={setExtension} /></div><StatusMessage tone={tone}>{message}</StatusMessage></section>
      <section className={styles.panel}><div className={styles.previewHeader}><div><span className={styles.sectionLabel}>Revisão visual</span><h2>Prévias geradas</h2><p>Selecione um rosto para abrir a qualidade e os ajustes manuais.</p></div><span className={styles.count}>{allSprites.length}/{expectedCount}</span></div><div className={styles.filterBar}>{(["all", "primary", "extension"] as const).map((item) => <button key={item} type="button" className={`${styles.filterButton} ${view === item ? styles.filterActive : ""}`} disabled={item === "extension" && !extensionSheet} onClick={() => setView(item)}>{item === "all" ? `Alternar ${expectedCount}` : item === "primary" ? "Folha 1 (21)" : "Folha 2 (21)"}</button>)}</div>{allSprites.length ? <PreviewGrid sheets={sheets} view={view} selectedKey={selectedKey} onSelect={selectSprite} reviewed={reviewed} /> : <div className={styles.emptyState}>As 21 ou 42 prévias aparecerão aqui depois de “Gerar prévias”.</div>}</section>
      <section className={styles.panel}><div className={styles.previewHeader}><div><span className={styles.sectionLabel}>Comparação</span><h2>Trio de expressão</h2><p>Compare default, blink e talk do mesmo rosto sem sair da tela.</p></div><div className={styles.compareSelects}><select value={compareSheet} onChange={(event) => { setCompareSheet(event.target.value as SheetId); setCompareColumn(0); setPlayback("static"); }} disabled={!primarySheet}><option value="primary">Folha 1</option><option value="extension" disabled={!extensionSheet}>Folha 2</option></select><select value={compareColumn} onChange={(event) => { setCompareColumn(Number(event.target.value)); setPlayback("static"); }} disabled={!comparisonSourceSheet}>{(compareSheet === "primary" ? PRIMARY_EXPRESSIONS : EXTENSION_EXPRESSIONS).map((expression, index) => <option key={expression} value={index}>{expression}</option>)}</select><select value={compareState} onChange={(event) => { setCompareState(event.target.value as typeof compareState); setPlayback("static"); }} disabled={!comparisonExpression}><option value="default">default</option><option value="blink">blink</option><option value="talk">talk</option></select></div></div><ComparisonPlayer current={comparisonCurrent} ghost={comparisonGhost} trio={comparisonTrio} mode={playback} onMode={setPlayback} /></section>
    </div><aside className={styles.sideColumn}>
      <section className={styles.panel}><div className={styles.panelHeading}><div><span className={styles.sectionLabel}>Modelo final</span><h2>Configuração</h2></div><span className={styles.secureBadge}>Local</span></div><ModelSettingsPanel name={name} folderName={folderName} gender={gender} onName={setName} onFolder={setFolderName} onGender={setGender} /><div className={styles.divider} /><CalibrationPanel settings={settings} onChange={setSettings} /><ExportPanel count={allSprites.length} busy={busy} onGenerate={() => void generate()} onSave={() => void save()} /></section>
      <section className={styles.panel}><QualityPanel sprite={currentSprite} compatibility={currentSprite?.sourceSheet === "extension" ? extensionSheet?.compatibility : undefined} /><ManualAdjustmentPanel key={`${selectedKey ?? "empty"}:${currentSprite?.adjustment.scale ?? ""}:${currentSprite?.adjustment.scaleX ?? ""}:${currentSprite?.adjustment.scaleY ?? ""}:${currentSprite?.adjustment.dx ?? ""}:${currentSprite?.adjustment.dy ?? ""}`} sprite={currentSprite} onApply={(adjustment) => void applyAdjustment(adjustment)} onReview={reviewCurrent} onCopyTrio={() => void copyTrio()} onReset={() => void resetAdjustment()} /></section>
      <section className={styles.panel}><span className={styles.sectionLabel}>Legenda</span><div className={styles.legend}><span><i className={styles.dotGood} /> pronto</span><span><i className={styles.dotWarning} /> revisar</span><span><i className={styles.dotCritical} /> crítico</span></div><p className={styles.helpText}>Estados críticos bloqueiam o salvamento. Avisos permanecem disponíveis para revisão manual.</p></section>
    </aside></div>
  </main></div>;
}
