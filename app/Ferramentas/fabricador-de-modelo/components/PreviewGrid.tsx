import type { GeneratedSprite, SheetResult, SheetId } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export function PreviewGrid({ sheets, view, selectedKey, onSelect, reviewed }: { sheets: SheetResult[]; view: "all" | SheetId; selectedKey?: string; onSelect: (sprite: GeneratedSprite) => void; reviewed: Set<string> }) {
  const sprites = sheets.filter((sheet) => view === "all" || sheet.id === view).flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk]));
  return <div className={styles.previewGrid}>{sprites.map((sprite) => { const key = `${sprite.sourceSheet}:${sprite.key}`; const status = reviewed.has(key) || sprite.adjustment.reviewed ? "Revisado" : sprite.quality.critical ? "Crítico" : sprite.quality.warning ? "Revisar" : "OK"; return <button className={`${styles.preview} ${selectedKey === key ? styles.previewSelected : ""}`} key={key} type="button" onClick={() => onSelect(sprite)}><img src={sprite.dataUrl} alt={sprite.key} /><span className={styles.previewMeta}><strong>{sprite.key}</strong><small>{sprite.sourceSheet === "primary" ? "Folha 1" : "Folha 2"} · {status}</small></span></button>; })}</div>;
}
