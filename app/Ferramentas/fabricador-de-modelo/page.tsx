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
import { PreviewGrid, type ReviewFilter } from "./components/PreviewGrid";
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

function anatomiesFromSheet(sheet: SheetResult) {
  return [
    ...sheet.expressions.map((expression) => expression.default.anatomy),
    ...sheet.expressions.map((expression) => expression.blink.anatomy),
    ...sheet.expressions.map((expression) => expression.talk.anatomy),
  ];
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
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [step, setStep] = useState(1);
  const [showFinalPreview, setShowFinalPreview] = useState(false);
  const [previousEdits, setPreviousEdits] = useState<Record<string, Partial<SpriteAdjustment>> | null>(null);
  const [compareSheet, setCompareSheet] = useState<SheetId>("primary");
  const [compareColumn, setCompareColumn] = useState(0);
  const [compareState, setCompareState] = useState<"default" | "blink" | "talk">("default");
  const [playback, setPlayback] = useState<PlaybackMode>("static");
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [animationScope, setAnimationScope] = useState<"selected" | "both">("selected");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregue a Folha 1 para começar. A Folha 2 é opcional.");
  const [tone, setTone] = useState<"" | "error" | "ok">("");

  useEffect(() => {
    let active = true;
    void localDataFetch("/models", { cache: "no-store" }).then((response) => response.json()).then((models: Record<string, Array<{ id: string }>>) => {
      if (!active) return;
      const ids = (models[gender] ?? []).map((model) => Number(model.id.match(/modelo-(\d+)/i)?.[1] ?? 0));
      const next = Math.max(0, ...ids) + 1;
      setName(`Modelo ${next}`); setFolderName(`modelo-${next}`);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [gender]);

  const allSprites = useMemo(() => sheets.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])), [sheets]);
  const currentSprite = allSprites.find((sprite) => keyOf(sprite) === selectedKey) ?? allSprites[0];
  const primarySheet = sheets.find((sheet) => sheet.id === "primary");
  const extensionSheet = sheets.find((sheet) => sheet.id === "extension");
  const comparisonSourceSheet = compareSheet === "extension" ? extensionSheet : primarySheet;
  const comparisonExpression = comparisonSourceSheet?.expressions[compareColumn];
  const comparisonCurrent = comparisonExpression?.[compareState];
  const comparisonGhost = compareSheet === "primary" ? extensionSheet?.expressions[compareColumn]?.[compareState] : primarySheet?.expressions[compareColumn]?.[compareState];
  const comparisonTrio = comparisonExpression ? [comparisonExpression.default, comparisonExpression.blink, comparisonExpression.talk] : [];
  const comparisonFrames = sheets.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk]));
  const criticalSprites = allSprites.filter((sprite) => sprite.quality.critical);
  const unreviewedCriticalCount = criticalSprites.filter((sprite) => !reviewed.has(keyOf(sprite)) && !sprite.adjustment.reviewed).length;
  const expectedCount = extension ? 42 : 21;
  const warningCount = allSprites.filter((sprite) => sprite.quality.warning && !sprite.quality.critical).length;
  const reviewedCount = allSprites.filter((sprite) => reviewed.has(keyOf(sprite)) || sprite.adjustment.reviewed).length;
  const readyCount = allSprites.length - criticalSprites.length - warningCount;

  useEffect(() => {
    const saved = window.localStorage.getItem("nymi:fabricador-draft");
    if (!saved) return;
    const restore = window.setTimeout(() => {
      try {
        const draft = JSON.parse(saved) as { name?: string; folderName?: string; gender?: "feminino" | "masculino"; settings?: CalibrationSettings; manualEdits?: Record<string, Partial<SpriteAdjustment>> };
        if (draft.name) setName(draft.name);
        if (draft.folderName) setFolderName(draft.folderName);
        if (draft.gender === "feminino" || draft.gender === "masculino") setGender(draft.gender);
        if (draft.settings) setSettings((current) => ({ ...current, ...draft.settings }));
        if (draft.manualEdits) setManualEdits(draft.manualEdits);
      } catch { window.localStorage.removeItem("nymi:fabricador-draft"); }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("nymi:fabricador-draft", JSON.stringify({ name, folderName, gender, settings, manualEdits }));
  }, [name, folderName, gender, settings, manualEdits]);

  async function generate(edits = manualEdits) {
    if (!primary) { setTone("error"); setMessage("A Folha 1 é obrigatória."); return; }
    setBusy(true); setStep(2); setTone(""); setMessage("Processando chroma, detecção, anatomia e calibração…");
    try {
      const base = await processSheet(primary, "primary", { settings, manualAdjustments: manualArray("primary", edits) });
      const result = extension ? [base, await processSheet(extension, "extension", { referenceMaster: base.headMaster, referenceAnatomies: anatomiesFromSheet(base), settings, manualAdjustments: manualArray("extension", edits) })] : [base];
      setSheets(result); setStep(3); setSelectedKey((current) => current && result.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])).some((sprite) => keyOf(sprite) === current) ? current : keyOf(result[0].expressions[0].default)); setTone("ok"); setMessage(`${result.reduce((total, sheet) => total + sheet.expressions.length * 3, 0)} sprites gerados. Revise a qualidade antes de salvar.`);
    } catch (error) { setSheets([]); setStep(1); setTone("error"); setMessage(error instanceof Error ? error.message : "Não foi possível processar a folha."); }
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
    setPreviousEdits(manualEdits); setManualEdits(next); setReviewed((current) => { const copy = new Set(current); if (adjustment.reviewed) copy.add(keyOf(currentSprite)); else copy.delete(keyOf(currentSprite)); return copy; });
    await generate(next);
  }

  async function copyColumn() {
    if (!currentSprite) return;
    const next = { ...manualEdits };
    const stateOffset = compareState === "default" ? 0 : compareState === "blink" ? 7 : 14;
    for (let index = 0; index < 7; index += 1) next[`${currentSprite.sourceSheet}:${spriteKey(currentSprite.sourceSheet, stateOffset + index)}`] = { ...currentSprite.adjustment };
    setPreviousEdits(manualEdits); setManualEdits(next); await generate(next);
  }

  async function undoAdjustment() {
    if (!previousEdits) return;
    setManualEdits(previousEdits); const restore = previousEdits; setPreviousEdits(null); await generate(restore);
  }

  async function applyPanToAll(deltaX: number, deltaY: number, stageWidth: number, stageHeight: number) {
    if (!allSprites.length) return;
    const outputX = Math.round(deltaX * 1920 / Math.max(1, stageWidth));
    const outputY = Math.round(deltaY * 1080 / Math.max(1, stageHeight));
    if (!outputX && !outputY) return;
    const next = { ...manualEdits };
    allSprites.forEach((sprite) => { next[keyOf(sprite)] = { ...sprite.adjustment, dx: Math.max(-120, Math.min(120, sprite.adjustment.dx + outputX)), dy: Math.max(-120, Math.min(120, sprite.adjustment.dy + outputY)) }; });
    setPreviousEdits(manualEdits); setManualEdits(next); await generate(next);
  }

  function validateModel() {
    const keys = new Set(allSprites.map((sprite) => sprite.key));
    const missingStates = allSprites.length === 0 || allSprites.some((sprite) => !sprite.dataUrl.startsWith("data:image/png") || !sprite.key);
    if (allSprites.length !== expectedCount || missingStates || !keys.has("normal")) { setTone("error"); setMessage(`Verificação encontrou pendências: ${allSprites.length}/${expectedCount} sprites válidos.`); return; }
    setTone("ok"); setStep(4); setMessage(`Verificação concluída: ${allSprites.length} sprites PNG prontos, nomes únicos e âncora ${settings.anchorX}×${settings.anchorY}.`);
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
      window.localStorage.removeItem("nymi:fabricador-draft"); window.dispatchEvent(new CustomEvent("nymi:models-updated")); setStep(4); setTone("ok"); setMessage("Modelo salvo. O catálogo recebeu as expressões e já pode ser atualizado sem reiniciar a aplicação.");
    } catch (error) { setTone("error"); setMessage(error instanceof Error ? error.message : "Falha ao salvar o modelo."); }
    finally { setBusy(false); }
  }

  const stageMeta = {
    1: { label: "Entrada", title: "Comece pelas folhas", description: "Envie a Folha 1 e, se quiser, a Folha 2. O modelo e a pasta de destino podem ser definidos agora ou depois." },
    2: { label: "Processamento", title: "Construindo o modelo", description: "O Fabricador está detectando as cabeças, removendo o fundo e estabilizando os trios. Esta etapa é automática." },
    3: { label: "Revisão", title: "Confira cada expressão", description: "A bancada de revisão mostra as cabeças ampliadas. Selecione qualquer sprite para ajustar, revisar e testar a animação." },
    4: { label: "Catálogo", title: "Tudo pronto para salvar", description: "Revise o resumo final, execute a verificação e salve o modelo no catálogo local." },
  }[step as 1 | 2 | 3 | 4];

  function goToStep(nextStep: number) {
    if (nextStep === 2 && !busy) return;
    if (nextStep >= 3 && allSprites.length === 0) return;
    setStep(nextStep);
  }

  const renderReview = () => <>
    <section className={styles.panel}>
      <div className={styles.previewHeader}><div><span className={styles.sectionLabel}>03 · Revisão visual</span><h2>Prévias geradas</h2><p>Selecione um rosto para abrir a qualidade e os ajustes manuais.</p></div><span className={styles.count}>{allSprites.length}/{expectedCount}</span></div>
      <div className={styles.reviewSummary}><span className={styles.summaryGood}>{readyCount} prontos</span><span className={styles.summaryWarning}>{warningCount} revisar</span><span className={styles.summaryCritical}>{criticalSprites.length} críticos</span><span>{reviewedCount} revisados</span></div>
      <div className={styles.filterGroups}><div className={styles.filterGroup}><small>Folha</small><div className={styles.filterBar}>{(["all", "primary", "extension"] as const).map((item) => <button key={item} type="button" className={`${styles.filterButton} ${view === item ? styles.filterActive : ""}`} disabled={item === "extension" && !extensionSheet} onClick={() => setView(item)}>{item === "all" ? `Alternar ${expectedCount}` : item === "primary" ? "Folha 1 (21)" : "Folha 2 (21)"}</button>)}</div></div><div className={styles.filterGroup}><small>Estado</small><div className={styles.filterBar}>{(["all","critical","warning","unreviewed","default","blink","talk"] as ReviewFilter[]).map((item) => <button key={item} type="button" className={`${styles.filterButton} ${reviewFilter === item ? styles.filterActive : ""}`} onClick={() => setReviewFilter(item)}>{item === "all" ? "Todos" : item === "critical" ? "Críticos" : item === "warning" ? "Avisos" : item === "unreviewed" ? "Não revisados" : item}</button>)}</div></div></div>
      {allSprites.length ? <PreviewGrid sheets={sheets} view={view} filter={reviewFilter} selectedKey={selectedKey} onSelect={selectSprite} reviewed={reviewed} /> : <div className={styles.emptyState}>Gere as prévias para abrir a bancada de revisão.</div>}
    </section>
    <section className={styles.panel}>
      <div className={styles.previewHeader}><div><span className={styles.sectionLabel}>03 · Comparação</span><h2>Trio de expressão</h2><p>Amplie a cabeça, arraste o enquadramento e teste uma folha ou as duas em sequência.</p></div><div className={styles.compareSelects}><select value={compareSheet} onChange={(event) => { setCompareSheet(event.target.value as SheetId); setCompareColumn(0); setPlayback("static"); }} disabled={!primarySheet}><option value="primary">Folha 1</option><option value="extension" disabled={!extensionSheet}>Folha 2</option></select><select value={compareColumn} onChange={(event) => { setCompareColumn(Number(event.target.value)); setPlayback("static"); }} disabled={!comparisonSourceSheet}>{(compareSheet === "primary" ? PRIMARY_EXPRESSIONS : EXTENSION_EXPRESSIONS).map((expression, index) => <option key={expression} value={index}>{expression}</option>)}</select><select value={compareState} onChange={(event) => { setCompareState(event.target.value as typeof compareState); setPlayback("static"); }} disabled={!comparisonExpression}><option value="default">default</option><option value="blink">blink</option><option value="talk">talk</option></select></div></div>
      <ComparisonPlayer current={comparisonCurrent} ghost={comparisonGhost} trio={comparisonTrio} animationFrames={comparisonFrames} mode={playback} onMode={setPlayback} speed={animationSpeed} onSpeed={setAnimationSpeed} animationScope={animationScope} onAnimationScope={setAnimationScope} onPanCommit={(x, y, width, height) => void applyPanToAll(x, y, width, height)} reference={comparisonSourceSheet?.headMaster} anchorX={settings.anchorX} anchorY={settings.anchorY} baseScale={settings.baseScale} />
    </section>
  </>;

  return <div className={styles.page}>
    <ToolsTopbar title="Fabricador de Modelo" subtitle="Importador e calibrador head-only" />
    <div className={styles.actionDock}><div className={styles.actionDockStatus}><strong>{busy ? "Processando…" : `${allSprites.length}/${expectedCount} sprites`}</strong><small>{message}</small></div><div className={styles.actionDockActions}><button type="button" className={styles.button} disabled={busy || !primary} onClick={() => void generate()}>{busy ? "Processando…" : allSprites.length ? "Reprocessar prévias" : "Gerar prévias"}</button><button type="button" className={`${styles.button} ${styles.secondary}`} disabled={busy || allSprites.length === 0} onClick={() => void save()}>Salvar modelo no catálogo</button></div></div>
    <main className={`${styles.main} ${styles.fabricatorMain}`}>
      <div className={styles.breadcrumb}><Link href="/Ferramentas">Ferramentas</Link><b>/</b><strong>Fabricador de Modelo</strong></div>
      <nav className={styles.stepper} aria-label="Etapas do fabricador">{[[1,"Importar folhas"],[2,"Processar"],[3,"Revisar e calibrar"],[4,"Salvar no catálogo"]].map(([number, label]) => { const stepNumber = Number(number); return <button key={String(number)} type="button" aria-current={step === stepNumber ? "step" : undefined} className={step === stepNumber ? styles.stepCurrent : step > stepNumber ? styles.stepDone : ""} disabled={(stepNumber === 2 && !busy) || (stepNumber >= 3 && !allSprites.length)} onClick={() => goToStep(stepNumber)}><span>{step > stepNumber ? "✓" : number}</span><strong>{label}</strong></button>; })}</nav>
      <section className={styles.hero}><div><span className={styles.eyebrow}>Ferramenta nativa · etapa {step} de 4</span><h1>Fabricador de Modelo</h1><p>{stageMeta.description}</p></div><div className={styles.heroProgress}><span>{allSprites.length ? `${allSprites.length} sprites em memória` : "Nenhum processamento ainda"}</span><div><i style={{ width: `${step * 25}%` }} /></div><strong>{step * 25}%</strong></div></section>
      <div className={styles.stageHeader}><div><span className={styles.sectionLabel}>Etapa {String(step).padStart(2, "0")} · {stageMeta.label}</span><h2>{stageMeta.title}</h2></div><span className={styles.stageHint}>{step === 1 ? "Obrigatório: Folha 1" : step === 2 ? "Não feche esta página" : step === 3 ? "Ajustes aplicam-se ao conjunto" : "Sem arquivos críticos"}</span></div>

      {step === 1 && <div className={`${styles.layout} ${styles.setupLayout}`}><div><section className={styles.panel}><div className={styles.panelHeading}><div><span className={styles.sectionLabel}>01 · Entrada</span><h2>Folhas de rostos</h2><p>A Folha 1 é a base. A Folha 2 é opcional e adiciona mais sete expressões.</p></div><span className={styles.pipelineBadge}>{extension ? "42 sprites" : "21 sprites"}</span></div><div className={styles.uploadGrid}><SheetUploader title="Folha 1 · obrigatória" description="PNG, JPG ou WebP · 7 × 3" file={primary} onChange={setPrimary} /><SheetUploader title="Folha 2 · opcional" description="7 expressões adicionais · 7 × 3" file={extension} onChange={setExtension} /></div><StatusMessage tone={tone}>{message}</StatusMessage></section></div><aside className={styles.sideColumn}><section className={styles.panel}><div className={styles.panelHeading}><div><span className={styles.sectionLabel}>01 · Destino</span><h2>Identidade do modelo</h2><p>Esses dados definem como o modelo será encontrado no catálogo.</p></div><span className={styles.secureBadge}>Local</span></div><ModelSettingsPanel name={name} folderName={folderName} gender={gender} onName={setName} onFolder={setFolderName} onGender={setGender} /><div className={styles.nextStepCard}><strong>Quando estiver pronto</strong><span>Use <b>Gerar prévias</b> no topo. A ferramenta vai criar todos os sprites mantendo o fundo transparente.</span></div></section></aside></div>}

      {step === 2 && <section className={`${styles.panel} ${styles.processingPanel}`}><div className={styles.processingIcon}><span /></div><span className={styles.sectionLabel}>02 · Processamento automático</span><h2>Montando seu modelo</h2><p>{message}</p><div className={styles.processingTrack}><i /></div><div className={styles.processingSteps}><span className={styles.processingActive}>Detectar cabeças</span><span>Remover fundo</span><span>Calibrar trios</span><span>Gerar PNGs</span></div></section>}

      {step === 3 && <div className={styles.layout}><div>{renderReview()}</div><aside className={styles.sideColumn}><section className={styles.panel}><div className={styles.panelHeading}><div><span className={styles.sectionLabel}>02 · Ajuste global</span><h2>Configuração</h2></div><span className={styles.secureBadge}>Local</span></div><ModelSettingsPanel name={name} folderName={folderName} gender={gender} onName={setName} onFolder={setFolderName} onGender={setGender} /><CalibrationPanel settings={settings} onChange={setSettings} /><button type="button" className={styles.previewModelButton} disabled={!allSprites.length} onClick={() => setShowFinalPreview((value) => !value)}>{showFinalPreview ? "Ocultar prévia do catálogo" : "Prévia do modelo final"}</button>{showFinalPreview && currentSprite && <div className={styles.finalPreview}><img src={currentSprite.dataUrl} alt={`Prévia final ${currentSprite.key}`} /><span>{currentSprite.key} · transparente · âncora real</span></div>}</section><section className={styles.panel}><QualityPanel sprite={currentSprite} compatibility={currentSprite?.sourceSheet === "extension" ? extensionSheet?.compatibility : undefined} /><ManualAdjustmentPanel key={`${selectedKey ?? "empty"}:${currentSprite?.adjustment.scale ?? ""}:${currentSprite?.adjustment.scaleX ?? ""}:${currentSprite?.adjustment.scaleY ?? ""}:${currentSprite?.adjustment.dx ?? ""}:${currentSprite?.adjustment.dy ?? ""}`} sprite={currentSprite} onApply={(adjustment) => void applyAdjustment(adjustment)} onReview={reviewCurrent} onCopyTrio={() => void copyTrio()} onCopyColumn={() => void copyColumn()} onReset={() => void resetAdjustment()} /><button type="button" className={`${styles.previewModelButton} ${!previousEdits ? styles.disabledAction : ""}`} disabled={!previousEdits || busy} onClick={() => void undoAdjustment()}>Desfazer último ajuste</button></section><section className={styles.panel}><span className={styles.sectionLabel}>Legenda</span><div className={styles.legend}><span><i className={styles.dotGood} /> pronto</span><span><i className={styles.dotWarning} /> revisar</span><span><i className={styles.dotCritical} /> crítico</span></div><p className={styles.helpText}>Estados críticos bloqueiam o salvamento. Avisos permanecem disponíveis para revisão manual.</p></section></aside></div>}

      {step === 4 && <div className={`${styles.layout} ${styles.saveLayout}`}><div><section className={styles.panel}><div className={styles.previewHeader}><div><span className={styles.sectionLabel}>04 · Prévia final</span><h2>Assim o modelo entrará no catálogo</h2><p>Uma última conferência rápida antes de gravar os arquivos.</p></div><span className={styles.pipelineBadge}>{allSprites.length} PNGs</span></div><div className={styles.savePreviewGrid}>{(comparisonTrio.length ? comparisonTrio : [currentSprite]).filter((sprite): sprite is GeneratedSprite => Boolean(sprite)).map((sprite) => <div key={sprite.key} className={styles.savePreviewCard}><img src={sprite.dataUrl} alt={sprite.key} /><strong>{sprite.key}</strong><small>1920 × 1080 · transparente</small></div>)}</div><div className={styles.saveChecklist}><span className={allSprites.length === expectedCount ? styles.checkPassed : styles.checkPending}><b>{allSprites.length === expectedCount ? "✓" : "!"}</b>{allSprites.length}/{expectedCount} sprites gerados</span><span className={unreviewedCriticalCount === 0 ? styles.checkPassed : styles.checkPending}><b>{unreviewedCriticalCount === 0 ? "✓" : "!"}</b>{unreviewedCriticalCount === 0 ? "Nenhum crítico pendente" : `${unreviewedCriticalCount} críticos para revisar`}</span><span className={styles.checkPassed}><b>✓</b>Âncora {settings.anchorX} × {settings.anchorY}</span></div></section><StatusMessage tone={tone}>{message}</StatusMessage></div><aside className={styles.sideColumn}><section className={styles.panel}><div className={styles.panelHeading}><div><span className={styles.sectionLabel}>04 · Destino</span><h2>Salvar no catálogo</h2><p>Confirme o nome e execute a verificação antes de salvar.</p></div><span className={styles.secureBadge}>Local</span></div><ModelSettingsPanel name={name} folderName={folderName} gender={gender} onName={setName} onFolder={setFolderName} onGender={setGender} /><div className={styles.saveSummary}><span><small>Nome</small><strong>{name}</strong></span><span><small>Pasta</small><strong>{folderName}</strong></span><span><small>Gênero</small><strong>{gender}</strong></span></div><ExportPanel count={allSprites.length} busy={busy} onValidate={validateModel} /></section></aside></div>}
    </main>
  </div>;
}
