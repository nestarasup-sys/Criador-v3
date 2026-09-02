import { ToolsTopbar } from "./ToolsTopbar";
import styles from "../legacy-tool.module.css";

type LegacyToolPageProps = {
  title: string;
  subtitle: string;
  source: string;
};

export function LegacyToolPage({ title, subtitle, source }: LegacyToolPageProps) {
  return <div className={styles.page}>
    <ToolsTopbar title={title} subtitle={subtitle} />
    <main className={styles.workspace}>
      <section className={styles.frame} aria-label={`${title} — ferramenta integrada`}>
        <iframe src={source} title={title} allow="clipboard-read; clipboard-write" />
      </section>
    </main>
  </div>;
}
