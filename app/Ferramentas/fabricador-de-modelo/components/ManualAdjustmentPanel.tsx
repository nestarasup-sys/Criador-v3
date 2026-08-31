"use client";

import { useState } from "react";
import type { GeneratedSprite, SpriteAdjustment } from "../types/face-model";
import styles from "../../ferramentas.module.css";

const blank: SpriteAdjustment = { scale: 1, scaleX: 1, scaleY: 1, dx: 0, dy: 0, reviewed: false };

export function ManualAdjustmentPanel({ sprite, onApply, onReview, onCopyTrio, onReset }: { sprite?: GeneratedSprite; onApply: (adjustment: SpriteAdjustment) => void; onReview: () => void; onCopyTrio: () => void; onReset: () => void }) {
  const [draft, setDraft] = useState<SpriteAdjustment>(() => sprite?.adjustment ?? blank);
  const update = (key: keyof SpriteAdjustment, value: string | boolean) => setDraft((current) => ({ ...current, [key]: typeof value === "boolean" ? value : Number(value) }));
  if (!sprite) return <div className={styles.emptyState}>Selecione uma prévia para editar.</div>;
  return <div className={styles.controls}>
    <div className={styles.sectionLabel}>Ajuste de {sprite.key}</div>
    <label className={styles.field}>Escala uniforme<input type="number" min="0.98" max="1.02" step="0.001" value={draft.scale} onChange={(event) => update("scale", event.target.value)} /></label><div className={styles.twoFields}><label className={styles.field}>Escala X<input type="number" min="0.98" max="1.02" step="0.001" value={draft.scaleX} onChange={(event) => update("scaleX", event.target.value)} /></label><label className={styles.field}>Escala Y<input type="number" min="0.98" max="1.02" step="0.001" value={draft.scaleY} onChange={(event) => update("scaleY", event.target.value)} /></label></div>
    <div className={styles.twoFields}><label className={styles.field}>Deslocamento X<input type="number" min="-40" max="40" step="1" value={draft.dx} onChange={(event) => update("dx", event.target.value)} /></label><label className={styles.field}>Deslocamento Y<input type="number" min="-40" max="40" step="1" value={draft.dy} onChange={(event) => update("dy", event.target.value)} /></label></div>
    <label className={styles.check}><input type="checkbox" checked={draft.reviewed} onChange={(event) => update("reviewed", event.target.checked)} /> Marcar este rosto como revisado</label>
    <div className={styles.actions}><button type="button" className={styles.button} onClick={() => onApply(draft)}>Aplicar</button><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={onReset}>Resetar</button></div>
    <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={onCopyTrio}>Copiar ajuste para o trio</button><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={onReview}>Marcar revisado</button></div>
    <p className={styles.helpText}>O ajuste é limitado para não desfigurar o modelo. A Folha 2 nunca recebe deformação regional.</p>
  </div>;
}
