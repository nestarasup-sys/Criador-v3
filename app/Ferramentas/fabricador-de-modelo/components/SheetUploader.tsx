import styles from "../../ferramentas.module.css";

export function SheetUploader({ title, description, file, onChange }: { title: string; description: string; file: File | null; onChange: (file: File | null) => void }) {
  return <label className={styles.dropzone}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} /><span><span className={styles.dropIcon}>▧</span><strong>{title}</strong><small>{description}</small>{file && <span className={styles.fileName}>{file.name}</span>}</span></label>;
}
