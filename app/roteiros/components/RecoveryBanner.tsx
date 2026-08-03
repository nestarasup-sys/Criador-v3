"use client";

import type { RecoveryJournalEntry } from "../recovery-types";
import styles from "../roteiros.module.css";

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

export default function RecoveryBanner({ candidate, onRestore, onDismiss }: { candidate: RecoveryJournalEntry | null; onRestore: () => void; onDismiss: () => void }) {
  if (!candidate) return null;
  return <aside className={styles.recoveryBanner} role="status">
    <div className={styles.recoveryIcon}>↻</div>
    <div className={styles.recoveryCopy}><strong>Recuperação local encontrada</strong><p>Há alterações do navegador de {formatDate(candidate.savedAt)} que ainda não aparecem no estado salvo no PC.</p></div>
    <div className={styles.recoveryActions}><button className={styles.primaryButton} onClick={onRestore}>Usar recuperação</button><button className={styles.secondaryButton} onClick={onDismiss}>Descartar</button></div>
  </aside>;
}
