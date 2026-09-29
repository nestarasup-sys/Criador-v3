"use client";

import type { ReactNode } from "react";
import { PLACEMENT_LIMITS } from "../fabricador-config";
import type { ChromaSettings } from "../core/eye-processing";
import type { EyePlacement } from "../types/eye-model";
import styles from "../fabricador.module.css";

export function PanelBlock({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className={styles.block}>
    <header><h3>{title}</h3>{description && <p>{description}</p>}</header>
    {children}
  </section>;
}

export function UploadTile({ title, detail, onFile }: { title: string; detail: string; onFile: (file?: File) => void }) {
  return <label className={styles.uploadTile}>
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      onFile(event.target.files?.[0]);
      event.currentTarget.value = "";
    }} />
    <span className={styles.uploadIcon}>＋</span>
    <strong>{title}</strong>
    <small>{detail}</small>
  </label>;
}

export function RangeControl({
  label,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number | string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return <label className={styles.rangeControl}>
    <span><b>{label}</b><output>{display}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

export function ChromaControls({
  settings,
  disabled,
  onChange,
  onReset,
}: {
  settings: ChromaSettings;
  disabled?: boolean;
  onChange: (key: keyof ChromaSettings, value: number) => void;
  onReset: () => void;
}) {
  return <div className={styles.controlStack}>
    <RangeControl label="Força" value={settings.strength} display={`${settings.strength}%`} min={0} max={100} step={1} disabled={disabled} onChange={(value) => onChange("strength", value)} />
    <RangeControl label="Tolerância" value={settings.tolerance} display={String(settings.tolerance)} min={2} max={100} step={1} disabled={disabled} onChange={(value) => onChange("tolerance", value)} />
    <RangeControl label="Suavidade" value={settings.softness} display={String(settings.softness)} min={0} max={80} step={1} disabled={disabled} onChange={(value) => onChange("softness", value)} />
    <button className={styles.secondaryButton} type="button" disabled={disabled} onClick={onReset}>Restaurar chroma</button>
  </div>;
}

export function PlacementControls({
  placement,
  single,
  disabled,
  onChange,
  onReset,
}: {
  placement: EyePlacement;
  single?: boolean;
  disabled?: boolean;
  onChange: (key: keyof EyePlacement, value: number) => void;
  onReset: () => void;
}) {
  return <div className={styles.controlStack}>
    <RangeControl label="Zoom" value={placement.scale} display={`${placement.scale.toFixed(2)}×`} min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" disabled={disabled} onChange={(value) => onChange("scale", value)} />
    <RangeControl label="Largura" value={placement.scaleX} display={`${placement.scaleX.toFixed(2)}×`} min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" disabled={disabled} onChange={(value) => onChange("scaleX", value)} />
    <RangeControl label="Altura" value={placement.scaleY} display={`${placement.scaleY.toFixed(2)}×`} min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" disabled={disabled} onChange={(value) => onChange("scaleY", value)} />
    <RangeControl label="Horizontal" value={placement.x} display={`${Math.round(placement.x)} px`} min={0} max={1000} step={1} disabled={disabled} onChange={(value) => onChange("x", value)} />
    <RangeControl label="Vertical" value={placement.y} display={`${Math.round(placement.y)} px`} min={0} max={1000} step={1} disabled={disabled} onChange={(value) => onChange("y", value)} />
    {!single && <RangeControl label="Distância" value={placement.gap} display={`${Math.round(placement.gap)} px`} min={PLACEMENT_LIMITS.gap.min} max={PLACEMENT_LIMITS.gap.max} step={1} disabled={disabled} onChange={(value) => onChange("gap", value)} />}
    <RangeControl label="Rotação" value={placement.rotation} display={`${placement.rotation.toFixed(1)}°`} min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" disabled={disabled} onChange={(value) => onChange("rotation", value)} />
    <button className={styles.secondaryButton} type="button" disabled={disabled} onClick={onReset}>Restaurar posição</button>
  </div>;
}
