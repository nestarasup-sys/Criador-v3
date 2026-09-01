"use client";

import { useEffect, useState } from "react";
import type { GeneratedSprite } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export type PlaybackMode = "static" | "ghost" | "flicker" | "animation";

export function ComparisonPlayer({ current, ghost, trio, animationFrames = trio, mode, onMode, speed, onSpeed, animationScope, onAnimationScope }: { current?: GeneratedSprite; ghost?: GeneratedSprite; trio: GeneratedSprite[]; animationFrames?: GeneratedSprite[]; mode: PlaybackMode; onMode: (mode: PlaybackMode) => void; speed: number; onSpeed: (speed: number) => void; animationScope: "selected" | "both"; onAnimationScope: (scope: "selected" | "both") => void }) {
  const [frame, setFrame] = useState<GeneratedSprite | undefined>();
  const [zoom, setZoom] = useState(1.35);
  useEffect(() => {
    if (mode === "static" || mode === "ghost") return undefined;
    const scopedFrames = animationScope === "both" ? animationFrames : animationFrames.filter((item) => item.sourceSheet === current?.sourceSheet);
    const animationSequence = scopedFrames.length >= 2 ? scopedFrames : trio.length >= 3 ? [trio[0], trio[1], trio[0], trio[2], trio[0]] : trio;
    const sequence = mode === "animation" ? animationSequence : [current, ghost].filter((item): item is GeneratedSprite => Boolean(item));
    if (sequence.length < 2) return undefined;
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % sequence.length;
      setFrame(sequence[index]);
    }, Math.round((mode === "animation" ? 520 : 320) / speed));
    return () => window.clearInterval(timer);
  }, [animationFrames, animationScope, current, ghost, mode, speed, trio]);
  if (!current) return <div className={styles.emptyState}>Gere as prévias para ativar o comparador.</div>;
  const isGhost = mode === "ghost" && ghost;
  return <div className={styles.comparisonShell}>
    <div className={styles.comparisonStage}>
      <img className={styles.comparisonImage} style={{ transform: `scale(${zoom})` }} src={(mode === "static" || mode === "ghost" ? current : frame ?? current)?.dataUrl} alt={(mode === "static" || mode === "ghost" ? current : frame ?? current)?.key} />
      {isGhost && <img className={`${styles.comparisonImage} ${styles.ghostImage}`} src={ghost.dataUrl} alt={`${ghost.key} sobreposto`} />}
      <span className={styles.stageBadge}>{mode === "ghost" ? "Ghost" : mode === "flicker" ? "Flicker" : mode === "animation" ? "Animação" : "Prévia"}</span>
    </div>
    <div className={styles.compareControls}>
      <div><strong>{current.key}</strong><small>{current.sourceSheet === "primary" ? "Folha 1" : "Folha 2"} · {current.state}</small></div>
      <div className={styles.modeButtons}>
        {(["static", "ghost", "flicker", "animation"] as PlaybackMode[]).map((item) => <button key={item} type="button" className={`${styles.chipButton} ${mode === item ? styles.chipActive : ""}`} title={item === "animation" ? "Animar trio e todas as expressões" : undefined} disabled={item === "ghost" && !ghost || item === "animation" && animationFrames.length < 2} onClick={() => onMode(item)}>{item === "static" ? "Normal" : item === "ghost" ? "Ghost" : item === "flicker" ? "Flicker" : "Testar animação"}</button>)}
      </div>
      {mode === "animation" && <label className={styles.speedControl}><span>Velocidade <strong>{speed.toFixed(1)}×</strong></span><input type="range" min="0.25" max="2.5" step="0.05" value={speed} onChange={(event) => onSpeed(Number(event.target.value))} /><small>Mais lento</small><small>Mais rápido</small></label>}
      <label className={styles.speedControl}><span>Zoom da prévia <strong>{Math.round(zoom * 100)}%</strong></span><input type="range" min="0.8" max="2.2" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><small>Menor</small><small>Maior</small></label>
      {mode === "animation" && <div className={styles.animationScope}><span>Sequência</span><button type="button" className={`${styles.chipButton} ${animationScope === "selected" ? styles.chipActive : ""}`} onClick={() => onAnimationScope("selected")}>Folha atual</button><button type="button" className={`${styles.chipButton} ${animationScope === "both" ? styles.chipActive : ""}`} disabled={animationFrames.every((item) => item.sourceSheet === current.sourceSheet)} onClick={() => onAnimationScope("both")}>Folha 1 + Folha 2</button></div>}
      </div>
  </div>;
}
