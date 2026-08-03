import type { ChangeEvent, RefObject } from "react";
import styles from "../studio.module.css";
import type { SceneBubble } from "../types";

type StudioToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  isPrinting: boolean;
  selectedCharacterName?: string;
  backgroundInput: RefObject<HTMLInputElement | null>;
  objectInput: RefObject<HTMLInputElement | null>;
  onLeave: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddNarrator: () => void;
  onAddBubble: (type: SceneBubble["bubbleType"]) => void;
  onPrint: () => void;
  onOpenPrints: () => void;
  onView: () => void;
  onBackgroundChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onObjectChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function StudioToolbar({ canUndo, canRedo, isPrinting, selectedCharacterName, backgroundInput, objectInput, onLeave, onSave, onUndo, onRedo, onAddNarrator, onAddBubble, onPrint, onOpenPrints, onView, onBackgroundChange, onObjectChange }: StudioToolbarProps) {
  const bubbleTitle = selectedCharacterName ? `Criar balão para ${selectedCharacterName}` : "Criar balão livre; você poderá posicioná-lo depois";
  return <>
    <header className={styles.topbar}>
      <div className={styles.toolbarGrid}>
        <button className={styles.roundButton} title="Voltar aos Studios" onClick={onLeave}>←</button>
        <div className={styles.history}><button title="Salvar agora no PC" aria-label="Salvar agora no PC" onClick={onSave}>✓</button><button title="Desfazer" aria-label="Desfazer" disabled={!canUndo} onClick={onUndo}>↶</button><button title="Refazer" aria-label="Refazer" disabled={!canRedo} onClick={onRedo}>↷</button></div>
      </div>
    </header>
    <aside className={styles.leftTools}>
      <button onClick={() => backgroundInput.current?.click()}><span>▱</span><strong>Fundo</strong></button>
      <button onClick={() => objectInput.current?.click()}><span>✦</span><strong>Objetos</strong></button>
      <button onClick={onAddNarrator}><span>☷</span><strong>Narrador</strong></button>
      <button className={styles.bubbleTool} onClick={() => onAddBubble("fala")} title={bubbleTitle}><span>♡</span><strong>Fala</strong></button>
      <button className={styles.bubbleTool} onClick={() => onAddBubble("pensamento")} title={bubbleTitle}><span>☁</span><strong>Pensamento</strong></button>
      <div className={styles.toolSpacer} />
      <button className={styles.printButton} onClick={onPrint} disabled={isPrinting}><span>✧</span><strong>{isPrinting ? "Salvando…" : "Print"}</strong></button>
      <button className={styles.openPrintsButton} onClick={onOpenPrints} title="Abrir C:\\PRINTS GACHA NYMI"><span>⌂</span><strong>Pasta</strong></button>
      <button className={styles.viewButton} onClick={onView}><span>⛶</span><strong>View</strong></button>
      <input ref={backgroundInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onBackgroundChange} />
      <input ref={objectInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onObjectChange} />
    </aside>
  </>;
}
