"use client";

import type { CalibrationSettings } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export function CalibrationPanel({ settings, onChange }: { settings: CalibrationSettings; onChange: (settings: CalibrationSettings) => void }) {
  const number = (key: keyof CalibrationSettings, value: string) => onChange({ ...settings, [key]: Number(value) });
  return <details className={styles.advancedPanel}>
    <summary><span>Calibração, recorte e chroma</span><small>Controles avançados</small></summary>
    <div className={styles.controls}>
    <div className={styles.sectionLabel}>Calibração e chroma</div>
    <label className={styles.field}>Escala base <output>{Math.round(settings.baseScale * 100)}%</output><input type="range" min="0.8" max="1.3" step="0.01" value={settings.baseScale} onChange={(event) => number("baseScale", event.target.value)} /></label>
    <label className={styles.field}>Intensidade Folha 1 <output>{Math.round(settings.primaryStrength * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={settings.primaryStrength} onChange={(event) => number("primaryStrength", event.target.value)} /></label>
    <label className={styles.field}>Correção máxima Folha 1 <output>{Math.round(settings.primaryMaxCorrection * 100)}%</output><input type="range" min="0" max="0.15" step="0.01" value={settings.primaryMaxCorrection} onChange={(event) => number("primaryMaxCorrection", event.target.value)} /></label>
    <label className={styles.field}>Correção global Folha 2 <output>{Math.round(settings.extensionMaxCorrection * 100)}%</output><input type="range" min="0" max="0.12" step="0.01" value={settings.extensionMaxCorrection} onChange={(event) => number("extensionMaxCorrection", event.target.value)} /></label>
    <label className={styles.field}>Microajuste Folha 2 <output>{Math.round(settings.extensionMicroAdjustment * 100)}%</output><input type="range" min="0" max="0.05" step="0.005" value={settings.extensionMicroAdjustment} onChange={(event) => number("extensionMicroAdjustment", event.target.value)} /></label>
    <label className={styles.field}>Tolerância chroma <output>{settings.tolerance}</output><input type="range" min="8" max="72" step="1" value={settings.tolerance} onChange={(event) => number("tolerance", event.target.value)} /></label>
    <label className={styles.field}>Suavidade chroma <output>{settings.softness}</output><input type="range" min="0" max="100" step="1" value={settings.softness} onChange={(event) => number("softness", event.target.value)} /></label>
    <label className={styles.field}>Feather da borda <output>{settings.feather}px</output><input type="range" min="0" max="8" step="1" value={settings.feather} onChange={(event) => number("feather", event.target.value)} /></label>
    <label className={styles.field}>Despill <output>{settings.despill}%</output><input type="range" min="0" max="100" step="1" value={settings.despill} onChange={(event) => number("despill", event.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" checked={settings.preserveExpressiveDetails} onChange={(event) => onChange({ ...settings, preserveExpressiveDetails: event.target.checked })} /> Preservar detalhes expressivos</label>
    <label className={styles.check}><input type="checkbox" checked={settings.cleanEdges} onChange={(event) => onChange({ ...settings, cleanEdges: event.target.checked })} /> Limpar bordas residuais</label>
    <label className={styles.field}>Padding do recorte <output>{settings.contentPadding}px</output><input type="range" min="0" max="24" step="1" value={settings.contentPadding} onChange={(event) => number("contentPadding", event.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" checked={settings.tightCrop} onChange={(event) => onChange({ ...settings, tightCrop: event.target.checked })} /> Recorte justo (sem padding)</label>
    <label className={styles.check}><input type="checkbox" checked={settings.squareCrop} onChange={(event) => onChange({ ...settings, squareCrop: event.target.checked })} /> Manter recorte quadrado</label>
    <div className={styles.twoFields}><label className={styles.field}>Âncora X<input type="number" min="0" max="1920" value={settings.anchorX} onChange={(event) => number("anchorX", event.target.value)} /></label><label className={styles.field}>Âncora Y<input type="number" min="0" max="1080" value={settings.anchorY} onChange={(event) => number("anchorY", event.target.value)} /></label></div>
    <p className={styles.helpText}>Folha 2 usa apenas escala X/Y global e microajustes de até 2%. Nenhum warp regional é aplicado.</p>
    </div>
  </details>;
}
