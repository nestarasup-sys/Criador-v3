import Link from "next/link";
import { NymiBrand, NymiNavigation } from "../../shared/NymiShell";
import styles from "../ferramentas.module.css";

export function ToolsTopbar({ title, subtitle, backHref = "/Ferramentas" }: { title: string; subtitle: string; backHref?: string }) {
  return <header className={styles.topbar}>
    <div className={styles.topbarIdentity}>
      <Link className={styles.topbarBrandLink} href={backHref} aria-label="Voltar para Ferramentas">
        <NymiBrand />
      </Link>
      <span className={styles.topbarDivider} aria-hidden="true" />
      <div className={styles.topbarTitle}>
        <span>FERRAMENTAS</span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
    </div>
    <div className={styles.topbarActions}>
      <NymiNavigation active="tools" compact />
      <span className={styles.localStatus} title="Aplicação web local no Windows"><i aria-hidden="true" /> Local</span>
    </div>
  </header>;
}
