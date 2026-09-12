import { ToolsTopbar } from "../components/ToolsTopbar";
import { AlinhadorV2Client } from "./AlinhadorV2Client";
import styles from "./alinhador-v2.module.css";

export default function AlinhadorProfissionalV2Page() {
  return <div className={styles.page}>
    <ToolsTopbar title="Alinhador Profissional V2" subtitle="Landmarks, alinhamento regional e comparação não destrutiva" />
    <AlinhadorV2Client />
  </div>;
}
