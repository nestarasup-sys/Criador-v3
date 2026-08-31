import styles from "../../ferramentas.module.css";

export function ModelSettingsPanel({ name, folderName, gender, onName, onFolder, onGender }: { name: string; folderName: string; gender: "feminino" | "masculino"; onName: (value: string) => void; onFolder: (value: string) => void; onGender: (value: "feminino" | "masculino") => void }) {
  return <div className={styles.controls}><label className={styles.field}>Nome do modelo<input value={name} onChange={(event) => onName(event.target.value)} placeholder="Modelo 13" /></label><label className={styles.field}>Pasta<input value={folderName} onChange={(event) => onFolder(event.target.value)} placeholder="modelo-13" /></label><label className={styles.field}>Gênero<select value={gender} onChange={(event) => onGender(event.target.value as "feminino" | "masculino")}><option value="feminino">Feminino</option><option value="masculino">Masculino</option></select></label></div>;
}
