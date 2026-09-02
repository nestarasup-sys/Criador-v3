import styles from "../../ferramentas.module.css";

export function ExportPanel({ count, busy, onValidate }: { count: number; busy: boolean; onValidate: () => void }) {
  return <div><div className={styles.actions}><button className={`${styles.button} ${styles.secondary}`} type="button" disabled={busy || count === 0} onClick={onValidate}>Verificar modelo</button></div></div>;
}
