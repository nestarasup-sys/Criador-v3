"use client";

import { useEffect, useState } from "react";
import type { GeneratedSprite } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export type PlaybackMode = "static" | "ghost" | "flicker" | "animation";

export function ComparisonPlayer({ current, ghost, trio, mode, onMode }: { current?: GeneratedSprite; ghost?: GeneratedSprite; trio: GeneratedSprite[]; mode: PlaybackMode; onMode: (mode: PlaybackMode) => void }) {
  const [frame, setFrame] = useState<GeneratedSprite | undefined>();
  useEffect(() => {
    if (mode === "static" || mode === "ghost") return undefined;
    const animationSequence = trio.length >= 3 ? [trio[0], trio[1], trio[0], trio[2], trio[0]] : trio;
    const sequence = mode === "animation" ? animationSequence : [current, ghost].filter((item): item is GeneratedSprite => Boolean(item));
    if (sequence.length < 2) return undefined;
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % sequence.length;
      setFrame(sequence[index]);
    }, mode === "animation" ? 520 : 320);
    return () => window.clearInterval(timer);
  }, [current, ghost, mode, trio]);
  if (!current) return <div className={styles.emptyState}>Gere as prévias para ativar o comparador.</div>;
  const isGhost = mode === "ghost" && ghost;
  return <div className={styles.comparisonShell}>
    <div className={styles.comparisonStage}>
      <img className={styles.comparisonImage} src={(mode === "static" || mode === "ghost" ? current : frame ?? current)?.dataUrl} alt={(mode === "static" || mode === "ghost" ? current : frame ?? current)?.key} />
      {isGhost && <img className={`${styles.comparisonImage} ${styles.ghostImage}`} src={ghost.dataUrl} alt={`${ghost.key} sobreposto`} />}
      <span className={styles.stageBadge}>{mode === "ghost" ? "Ghost" : mode === "flicker" ? "Flicker" : mode === "animation" ? "Animação" : "Prévia"}</span>
    </div>
    <div className={styles.compareControls}>
      <div><strong>{current.key}</strong><small>{current.sourceSheet === "primary" ? "Folha 1" : "Folha 2"} · {current.state}</small></div>
      <div className={styles.modeButtons}>
        {(["static", "ghost", "flicker", "animation"] as PlaybackMode[]).map((item) => <button key={item} type="button" className={`${styles.chipButton} ${mode === item ? styles.chipActive : ""}`} disabled={item === "ghost" && !ghost || item === "animation" && trio.length < 3} onClick={() => onMode(item)}>{item === "static" ? "Normal" : item === "ghost" ? "Ghost" : item === "flicker" ? "Flicker" : "Animar trio"}</button>)}
      </div>
    </div>
  </div>;
}
