import Link from "next/link";
import { NymiNavigation } from "../shared/NymiShell";
import styles from "./ferramentas.module.css";

export default function FerramentasPage() {
  return <div className={styles.page}><NymiNavigation active="tools" /><main className={styles.main}>
    <section className={styles.hero}><div><span className={styles.eyebrow}>Área independente</span><h1>Ferramentas</h1><p>Ferramentas auxiliares para preparar e organizar os seus assets sem misturar o fluxo principal do Nymi Gacha.</p></div></section>
    <section className={styles.grid}><Link className={styles.toolCard} href="/Ferramentas/fabricador-de-modelo"><span className={styles.toolIcon}>✦</span><h2>Fabricador de Modelo</h2><p>Transforme folhas de rostos em um modelo head-only com expressões, calibração e exportação prontas para o catálogo.</p><span className={styles.back}>Abrir ferramenta →</span></Link></section>
  </main></div>;
}
