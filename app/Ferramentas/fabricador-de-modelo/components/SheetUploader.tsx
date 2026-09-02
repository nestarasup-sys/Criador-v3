import { useEffect, useMemo } from "react";
import styles from "../../ferramentas.module.css";

export function SheetUploader({ title, description, file, onChange }: { title: string; description: string; file: File | null; onChange: (file: File | null) => void }) {
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : undefined, [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  return <label className={`${styles.dropzone} ${file ? styles.dropzoneFilled : ""}`}>
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    {previewUrl ? <span className={styles.sheetPreviewFrame}><img className={styles.sheetPreview} src={previewUrl} alt={`Prévia de ${title}`} /><span className={styles.sheetPreviewBadge}>Folha carregada</span></span> : <span className={styles.dropIcon}>＋</span>}
    <span className={styles.dropzoneCopy}><strong>{title}</strong><small>{description}</small>{file ? <span className={styles.fileName}>{file.name}</span> : <span className={styles.uploadHint}>Clique para escolher ou arraste uma imagem</span>}</span>
  </label>;
}
