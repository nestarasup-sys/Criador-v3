import type { GeneratedSprite } from "../types/face-model";
import styles from "../../ferramentas.module.css";

export function QualityPanel({ sprite, compatibility }: { sprite?: GeneratedSprite; compatibility?: { overall: number; status: string; size: number; proportion: number; silhouette: number; jaw: number; neck: number } }) {
  if (!sprite) return null;
  const quality = sprite.quality;
  const adjustment = sprite.adjustment;
  const alignmentNotes = [
    Math.abs(adjustment.dx) >= 1 ? `Enquadramento ${Math.abs(Math.round(adjustment.dx))} px para ${adjustment.dx > 0 ? "a direita" : "a esquerda"}` : "Centro horizontal alinhado",
    Math.abs(adjustment.dy) >= 1 ? `Base deslocada ${Math.abs(Math.round(adjustment.dy))} px ${adjustment.dy > 0 ? "para baixo" : "para cima"}` : "Base inferior alinhada",
    Math.abs(adjustment.scaleX - 1) >= .005 ? `Largura corrigida em ${Math.round((adjustment.scaleX - 1) * 100)}%` : "Largura consistente",
  ];
  return <div className={styles.qualityPanel}><div className={styles.qualityHeader}><div><span className={styles.sectionLabel}>Qualidade</span><strong>{Math.round(quality.overall)} / 100</strong></div><span className={`${styles.qualityBadge} ${quality.critical ? styles.qualityCritical : quality.warning ? styles.qualityWarning : styles.qualityGood}`}>{quality.critical ? "Crítico" : quality.warning ? "Revisar" : "Pronto"}</span></div><div className={styles.metricGrid}>{[["Escala", quality.scale], ["Posição", quality.position], ["Proporção", quality.proportion], ["Silhueta", quality.shape], ["Pescoço", quality.neck]].map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{Math.round(Number(value))}</strong></div>)}</div><div className={styles.alignmentNotes}><small>Leitura do enquadramento</small>{alignmentNotes.map((note) => <span key={note}>{note}</span>)}<em>Referência estrutural: laterais, centro do pescoço e base inferior. O topo não entra no alinhamento.</em></div>{compatibility && <div className={styles.compatibility}><small>Compatibilidade da Folha 2 · {compatibility.status}</small><strong>{compatibility.overall}/100</strong><span>Tamanho {compatibility.size} · proporção {compatibility.proportion} · silhueta {compatibility.silhouette} · mandíbula {compatibility.jaw} · pescoço {compatibility.neck}</span></div>}{quality.reasons.length > 0 && <p className={styles.warningText}>{quality.reasons.join(" · ")}</p>}</div>;
}
