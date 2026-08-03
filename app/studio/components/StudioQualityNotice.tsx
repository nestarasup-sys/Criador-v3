import { useEffect, useState } from "react";
import { loadStudioImage } from "../image-loader";
import { analyzeSourceQuality, characterRect, fitMediaRect, objectRect, STUDIO_SCENE_HEIGHT, STUDIO_SCENE_WIDTH } from "../scene-layout.mjs";
import styles from "../studio.module.css";

type QualityKind = "background" | "character" | "object";
type QualityReport = ReturnType<typeof analyzeSourceQuality>;

type StudioQualityNoticeProps = {
  src?: string | null;
  kind: QualityKind;
  scale?: number;
  fit?: "cover" | "contain";
};

function targetSize(kind: QualityKind, sourceWidth: number, sourceHeight: number, scale: number, fit: "cover" | "contain") {
  if (kind === "background") return fitMediaRect(sourceWidth, sourceHeight, STUDIO_SCENE_WIDTH, STUDIO_SCENE_HEIGHT, fit);
  if (kind === "character") return characterRect(sourceWidth, sourceHeight, scale);
  return objectRect(sourceWidth, sourceHeight, scale);
}

export function StudioQualityNotice({ src, kind, scale = 1, fit = "cover" }: StudioQualityNoticeProps) {
  const qualityKey = `${src ?? ""}|${kind}|${scale}|${fit}`;
  const [result, setResult] = useState<{ key: string; report: QualityReport } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!src) return () => { cancelled = true; };
    loadStudioImage(src).then((image) => {
      if (cancelled) return;
      const target = targetSize(kind, image.naturalWidth, image.naturalHeight, scale, fit);
      setResult({ key: qualityKey, report: analyzeSourceQuality(image.naturalWidth, image.naturalHeight, target.width, target.height) });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [fit, kind, qualityKey, scale, src]);

  const report = result?.key === qualityKey ? result.report : null;
  if (!src || !report) return null;
  const warning = report.status === "warning";
  return <div className={`${styles.qualityNotice} ${warning ? styles.qualityWarning : styles.qualityNative}`}>
    <span>{warning ? "QUALIDADE LIMITADA PELA FONTE" : "QUALIDADE MÁXIMA"}</span>
    <strong>{report.sourceWidth} × {report.sourceHeight}px</strong>
    <small>{warning ? `Ampliação de ${report.upscale.toFixed(1)}× pode perder nitidez.` : "A resolução original atende ao tamanho atual."}</small>
  </div>;
}
