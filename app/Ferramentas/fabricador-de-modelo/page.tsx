"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NymiNavigation } from "../../shared/NymiShell";
import { localDataFetch } from "../../lib/local-data-client";
import { processSheet } from "./core/build-model";
import { emptyHeadMaster } from "./core/compositor";
import type { ModelExpression, SheetResult } from "./types/face-model";
import { ExportPanel } from "./components/ExportPanel";
import { ModelSettingsPanel } from "./components/ModelSettingsPanel";
import { PreviewGrid } from "./components/PreviewGrid";
import { SheetUploader } from "./components/SheetUploader";
import { StatusMessage } from "./components/StatusMessage";
import styles from "../ferramentas.module.css";

const PRIMARY_EXPRESSIONS = ["normal", "sorriso_canto", "serio", "raiva", "assustado", "corado", "surpreso"];
const EXTENSION_EXPRESSIONS = ["envergonhado_panico", "emburrado", "sonolento", "confuso", "flertando", "sorriso_maligno", "chocado"];

function spritePayload(sheets: SheetResult[]) {
  return sheets.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])).map((sprite) => ({ fileName: `${sprite.key}.png`, dataUrl: sprite.dataUrl }));
}

export default function FabricadorDeModeloPage() {
  const [primary, setPrimary] = useState<File | null>(null);
  const [extension, setExtension] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetResult[]>([]);
  const [name, setName] = useState("Modelo novo");
  const [folderName, setFolderName] = useState("modelo-13");
  const [gender, setGender] = useState<"feminino" | "masculino">("feminino");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregue a Folha 1 para começar. A Folha 2 é opcional.");
  const [tone, setTone] = useState<"" | "error" | "ok">("");
  const [compareIndex, setCompareIndex] = useState(0);

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
  const currentSprite = allSprites[compareIndex % Math.max(1, allSprites.length)];

  async function generate() {
    if (!primary) { setTone("error"); setMessage("A Folha 1 é obrigatória."); return; }
    setBusy(true); setTone(""); setMessage("Processando chroma, detecção, recorte e calibração…");
    try {
      const base = await processSheet(primary, "primary");
      const result = extension ? [base, await processSheet(extension, "extension", emptyHeadMaster(base.headMaster.width, base.headMaster.height))] : [base];
      setSheets(result); setCompareIndex(0); setTone("ok"); setMessage(`${result.reduce((total, sheet) => total + sheet.expressions.length * 3, 0)} sprites gerados. Revise as prévias antes de salvar.`);
    } catch (error) { setSheets([]); setTone("error"); setMessage(error instanceof Error ? error.message : "Não foi possível processar a folha."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!allSprites.length) return;
    setBusy(true); setTone(""); setMessage("Salvando modelo no catálogo local…");
    try {
      const response = await localDataFetch("/models/fabricator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folderName, gender, sprites: spritePayload(sheets) }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o modelo.");
      window.dispatchEvent(new CustomEvent("nymi:models-updated")); setTone("ok"); setMessage("Modelo salvo. O catálogo foi atualizado; ele já pode ser recarregado nas áreas do app.");
    } catch (error) { setTone("error"); setMessage(error instanceof Error ? error.message : "Falha ao salvar o modelo."); }
    finally { setBusy(false); }
  }

  return <div className={styles.page}><NymiNavigation active="tools" /><main className={styles.main}><div className={styles.toolbar}><Link className={styles.back} href="/Ferramentas">← Ferramentas</Link></div><section className={styles.hero}><div><span className={styles.eyebrow}>Ferramenta nativa</span><h1>Fabricador de Modelo</h1><p>Prepare folhas de rostos, revise os sprites e salve um modelo head-only diretamente no catálogo do Nymi Gacha.</p></div></section><div className={styles.layout}><div><section className={styles.panel}><h2>Folhas de rostos</h2><p>Folha 1 gera 21 sprites. Folha 2 adiciona mais 21 expressões ao mesmo modelo.</p><div className={styles.uploadGrid}><SheetUploader title="Folha 1 · obrigatória" description="PNG, JPG ou WebP · 7 × 3" file={primary} onChange={setPrimary} /><SheetUploader title="Folha 2 · opcional" description="7 expressões adicionais · 7 × 3" file={extension} onChange={setExtension} /></div><StatusMessage tone={tone}>{message}</StatusMessage></section><section className={styles.panel}><div className={styles.previewHeader}><div><h2>Prévia única do modelo</h2><p>Folha 1 e Folha 2 aparecem juntas, na ordem de processamento.</p></div><span className={styles.count}>{allSprites.length ? `${allSprites.length}/42` : "0/42"}</span></div>{allSprites.length ? <PreviewGrid sheets={sheets} /> : <StatusMessage>As prévias aparecerão aqui após clicar em “Gerar prévias”.</StatusMessage>}</section>{currentSprite && <section className={styles.panel}><div className={styles.previewHeader}><div><h2>Comparador</h2><p>Use anterior/próximo para revisar default, blink e talk.</p></div><span className={styles.count}>{compareIndex + 1}/{allSprites.length}</span></div><div className={styles.comparison}><img src={currentSprite.dataUrl} alt={currentSprite.key} /><div><h3>{currentSprite.key}</h3><p>Origem: {currentSprite.sourceSheet === "primary" ? "Folha 1" : "Folha 2"} · estado: {currentSprite.state}</p><div className={styles.actions}><button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setCompareIndex((index) => (index - 1 + allSprites.length) % allSprites.length)}>← Anterior</button><button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setCompareIndex((index) => (index + 1) % allSprites.length)}>Próximo →</button></div></div></div></section>}</div><aside className={styles.panel}><h2>Configuração</h2><p>O servidor cria o destino com segurança e nunca sobrescreve uma pasta existente.</p><ModelSettingsPanel name={name} folderName={folderName} gender={gender} onName={setName} onFolder={setFolderName} onGender={setGender} /><ExportPanel count={allSprites.length} busy={busy} onGenerate={() => void generate()} onSave={() => void save()} /><div className={styles.status}>Expressões da Folha 1: {PRIMARY_EXPRESSIONS.join(", ")}<br /><br />Folha 2: {EXTENSION_EXPRESSIONS.join(", ")}</div></aside></div></main></div>;
}
