import { ToolsTopbar } from "../components/ToolsTopbar";
import { ColorLabClient } from "./ColorLabClient";
import styles from "./color-lab.module.css";

export default function LaboratorioCorModeloPage() {
  return <div className={styles.page}>
    <ToolsTopbar title="Laboratório de Cor" subtitle="Máscaras precisas para pupilas e sobrancelhas" />
    <ColorLabClient />
  </div>;
}
