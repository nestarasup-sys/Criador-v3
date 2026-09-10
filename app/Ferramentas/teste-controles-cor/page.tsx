import { ToolsTopbar } from "../components/ToolsTopbar";
import { ColorControlsTestClient } from "./ColorControlsTestClient";
import styles from "./teste-controles-cor.module.css";

export default function TesteControlesCorPage() {
  return <div className={styles.page}>
    <ToolsTopbar title="Teste de Controles de Cor" subtitle="O mesmo compositor usado pelo Criador" />
    <ColorControlsTestClient />
  </div>;
}
