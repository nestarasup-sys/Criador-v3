import type { GeneratedSprite, SheetResult, SheetId } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export type ReviewFilter = "all" | "critical" | "warning" | "unreviewed" | "default" | "blink" | "talk";

export function PreviewGrid({ sheets, view, filter = "all", selectedKey, onSelect, reviewed }: { sheets: SheetResult[]; view: "all" | SheetId; filter?: ReviewFilter; selectedKey?: string; onSelect: (sprite: GeneratedSprite) => void; reviewed: Set<string> }) {
  const sprites = sheets.filter((sheet) => view === "all" || sheet.id === view).flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk])).filter((sprite) => {
    const isReviewed = reviewed.has(`${sprite.sourceSheet}:${sprite.key}`) || sprite.adjustment.reviewed;
    if (filter === "critical") return sprite.quality.critical;
    if (filter === "warning") return sprite.quality.warning && !sprite.quality.critical;
    if (filter === "unreviewed") return !isReviewed;
    return filter === "all" || sprite.state === filter;
  });
  return <div className={styles.previewGrid}>{sprites.map((sprite, index) => { const key = `${sprite.sourceSheet}:${sprite.key}`; const status = reviewed.has(key) || sprite.adjustment.reviewed ? "Revisado" : sprite.quality.critical ? "Crítico" : sprite.quality.warning ? "Revisar" : "OK"; return <button className={`${styles.preview} ${selectedKey === key ? styles.previewSelected : ""}`} key={key} type="button" onClick={() => onSelect(sprite)}><span className={styles.previewThumb}><img src={sprite.dataUrl} alt={sprite.key} /><span className={styles.previewIndex}>{String(index + 1).padStart(2, "0")}</span></span><span className={styles.previewMeta}><strong>{sprite.key}</strong><small>{sprite.sourceSheet === "primary" ? "Folha 1" : "Folha 2"} · {status}</small></span></button>; })}</div>;
}
