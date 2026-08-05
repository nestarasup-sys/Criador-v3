import { useRef, type ChangeEvent } from "react";
import styles from "../studio.module.css";
import type { StudioAsset, StudioBackground } from "../types";

type StudioBackgroundLibraryProps = {
  assets: StudioAsset[];
  background: StudioBackground | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (asset: StudioAsset) => void;
  onAdd: (file: File) => void;
  onRemove: (asset: StudioAsset) => void;
  onUpdate: (patch: Partial<StudioBackground>, history?: boolean) => void;
  onBeginAdjust: () => void;
  onCenter: () => void;
  onReset: () => void;
};

export function StudioBackgroundLibrary({ assets, background, busy, onClose, onSelect, onAdd, onRemove, onUpdate, onBeginAdjust, onCenter, onReset }: StudioBackgroundLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onAdd(file);
  };
  const scale = background?.scale ?? 1;
  const offsetX = background?.offsetX ?? 0;
  const offsetY = background?.offsetY ?? 0;
  return <section className={styles.backgroundLibrary} aria-label="Biblioteca de fundos">
    <header className={styles.backgroundLibraryHeader}>
      <div><span>BIBLIOTECA</span><h3>Fundos</h3><small>{assets.length} imagem(ns) disponíveis</small></div>
      <button type="button" className={styles.closePanelButton} onClick={onClose} aria-label="Fechar biblioteca de fundos">×</button>
    </header>
    <button type="button" className={styles.addBackgroundButton} disabled={busy} onClick={() => inputRef.current?.click()}>＋ Adicionar fundo</button>
    <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
    <div className={styles.backgroundGrid}>
      {assets.length ? assets.map((asset) => {
        const active = background?.assetId === asset.id;
        return <article key={asset.id} className={`${styles.backgroundTile} ${active ? styles.backgroundTileActive : ""}`}>
          <button type="button" className={styles.backgroundTileSelect} onClick={() => onSelect(asset)} aria-pressed={active}>
            <img src={asset.fileUrl} alt={asset.name} />
            <span>{active ? "✓ Aplicado" : asset.name}</span>
          </button>
          <button type="button" className={styles.backgroundTileRemove} disabled={busy} onClick={() => onRemove(asset)} aria-label={`Remover fundo ${asset.name}`} title="Remover fundo">×</button>
        </article>;
      }) : <div className={styles.backgroundLibraryEmpty}><span>▱</span><strong>Nenhum fundo salvo</strong><small>Adicione uma imagem para começar.</small></div>}
    </div>
    {background && <div className={styles.backgroundControls}>
      <div className={styles.backgroundControlsHeading}><div><span>FUNDO ATUAL</span><strong>Transformação</strong></div><span className={styles.backgroundAppliedMark}>✓</span></div>
      <label className={styles.rangeField}><span>Escala <b>{Math.round(scale * 100)}%</b></span><input type="range" min=".1" max="4" step=".05" value={scale} onPointerDown={onBeginAdjust} onChange={(event) => onUpdate({ scale: Number(event.target.value) }, false)} /></label>
      <div className={styles.backgroundZoomButtons}><button type="button" onClick={() => onUpdate({ scale: Math.max(.1, Math.min(4, scale - .1)) })}>− Zoom</button><button type="button" onClick={() => onUpdate({ scale: Math.max(.1, Math.min(4, scale + .1)) })}>＋ Zoom</button></div>
      <label className={styles.rangeField}><span>Horizontal <b>{Math.round(offsetX)}px</b></span><input type="range" min="-960" max="960" step="1" value={offsetX} onPointerDown={onBeginAdjust} onChange={(event) => onUpdate({ offsetX: Number(event.target.value) }, false)} /></label>
      <label className={styles.rangeField}><span>Vertical <b>{Math.round(offsetY)}px</b></span><input type="range" min="-540" max="540" step="1" value={offsetY} onPointerDown={onBeginAdjust} onChange={(event) => onUpdate({ offsetY: Number(event.target.value) }, false)} /></label>
      <div className={styles.backgroundTransformActions}><button type="button" onClick={onCenter}>⌖ Centralizar</button><button type="button" onClick={onReset}>↺ Restaurar original</button></div>
      <button type="button" className={styles.backgroundFitButton} onClick={() => onUpdate({ fit: background.fit === "cover" ? "contain" : "cover" })}>{background.fit === "cover" ? "Mostrar inteiro" : "Preencher tela"}</button>
      <small className={styles.backgroundDragHint}>Com a biblioteca aberta, arraste o fundo diretamente no canvas.</small>
    </div>}
  </section>;
}
