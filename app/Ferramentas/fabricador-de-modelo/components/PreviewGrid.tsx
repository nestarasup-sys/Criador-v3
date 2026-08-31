import type { SheetResult } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export function PreviewGrid({ sheets }: { sheets: SheetResult[] }) {
  const sprites = sheets.flatMap((sheet) => sheet.expressions.flatMap((expression) => [expression.default, expression.blink, expression.talk]));
  return <div className={styles.previewGrid}>{sprites.map((sprite) => <article className={styles.preview} key={`${sprite.sourceSheet}-${sprite.key}`}><img src={sprite.dataUrl} alt={sprite.key} /><small>{sprite.sourceSheet === "primary" ? "Folha 1" : "Folha 2"} · {sprite.key}</small></article>)}</div>;
}
