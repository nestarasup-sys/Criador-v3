import styles from "../../ferramentas.module.css";

export function ExportPanel({ count, busy, onGenerate, onSave, onValidate }: { count: number; busy: boolean; onGenerate: () => void; onSave: () => void; onValidate: () => void }) {
  return <div><div className={styles.actions}><button className={styles.button} type="button" disabled={busy} onClick={onGenerate}>{busy ? "Processando…" : "Gerar prévias"}</button><button className={`${styles.button} ${styles.secondary}`} type="button" disabled={busy || count === 0} onClick={onValidate}>Verificar modelo</button><button className={`${styles.button} ${styles.secondary}`} type="button" disabled={busy || count === 0} onClick={onSave}>Salvar modelo no catálogo</button></div></div>;
}
