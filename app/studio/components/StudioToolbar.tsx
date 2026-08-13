import type { ChangeEvent, RefObject } from "react";
import styles from "../studio.module.css";
import type { SceneBubble } from "../types";
import { StudioGlyph } from "./StudioGlyph";

type StudioToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  isPrinting: boolean;
  selectedCharacterName?: string;
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
  onObjectChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenBackgroundLibrary: () => void;
};

export function StudioToolbar({ canUndo, canRedo, isPrinting, selectedCharacterName, objectInput, onLeave, onSave, onUndo, onRedo, onAddNarrator, onAddBubble, onPrint, onOpenPrints, onView, onObjectChange, onOpenBackgroundLibrary }: StudioToolbarProps) {
  const bubbleTitle = selectedCharacterName ? `Criar balão para ${selectedCharacterName}` : "Criar balão livre; você poderá posicioná-lo depois";
  return <>
    <header className={styles.topbar}>
      <div className={styles.toolbarGrid}>
        <button className={styles.roundButton} title="Voltar aos Studios" onClick={onLeave}><StudioGlyph name="back" /></button>
        <div className={styles.history}><button title="Salvar agora no PC" aria-label="Salvar agora no PC" onClick={onSave}><StudioGlyph name="save" /></button><button title="Desfazer" aria-label="Desfazer" disabled={!canUndo} onClick={onUndo}><StudioGlyph name="undo" /></button><button title="Refazer" aria-label="Refazer" disabled={!canRedo} onClick={onRedo}><StudioGlyph name="redo" /></button></div>
      </div>
    </header>
    <aside className={styles.leftTools}>
      <button onClick={onOpenBackgroundLibrary}><span><StudioGlyph name="background" /></span><strong>Fundo</strong></button>
      <button onClick={() => objectInput.current?.click()}><span><StudioGlyph name="objects" /></span><strong>Objetos</strong></button>
      <button onClick={onAddNarrator}><span><StudioGlyph name="narrator" /></span><strong>Narrador</strong></button>
      <button className={styles.bubbleTool} onClick={() => onAddBubble("fala")} title={bubbleTitle}><span><StudioGlyph name="speech" /></span><strong>Fala</strong></button>
      <button className={styles.bubbleTool} onClick={() => onAddBubble("pensamento")} title={bubbleTitle}><span><StudioGlyph name="thought" /></span><strong>Pensamento</strong></button>
      <div className={styles.toolSpacer} />
      <button className={styles.printButton} onClick={onPrint} disabled={isPrinting}><span><StudioGlyph name="print" /></span><strong>{isPrinting ? "Salvando…" : "Print"}</strong></button>
      <button className={styles.openPrintsButton} onClick={onOpenPrints} title="Abrir C:\\PRINTS GACHA NYMI"><span><StudioGlyph name="folder" /></span><strong>Pasta</strong></button>
      <button className={styles.viewButton} onClick={onView}><span><StudioGlyph name="view" /></span><strong>View</strong></button>
      <input ref={objectInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onObjectChange} />
    </aside>
  </>;
}
