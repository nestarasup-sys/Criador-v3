import type { ChangeEvent, RefObject } from "react";
import { NymiNavigation } from "../../shared/NymiShell";
import styles from "../studio.module.css";
import type { SceneBubble } from "../types";

type StudioToolbarProps = {
  name: string;
  saveStatus: string;
  canUndo: boolean;
  canRedo: boolean;
  isPrinting: boolean;
  selectedCharacter: boolean;
  selectedCharacterName?: string;
  backgroundInput: RefObject<HTMLInputElement | null>;
  objectInput: RefObject<HTMLInputElement | null>;
  onNameChange: (name: string) => void;
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

export function StudioToolbar({ name, saveStatus, canUndo, canRedo, isPrinting, selectedCharacter, selectedCharacterName, backgroundInput, objectInput, onNameChange, onLeave, onSave, onUndo, onRedo, onAddNarrator, onAddBubble, onPrint, onOpenPrints, onView, onBackgroundChange, onObjectChange }: StudioToolbarProps) {
  const bubbleTitle = selectedCharacterName ? `Criar balão para ${selectedCharacterName}` : "Selecione um personagem primeiro";
  return <>
    <header className={styles.topbar}>
      <button className={styles.roundButton} title="Voltar aos Studios" onClick={onLeave}>←</button>
      <div className={styles.studioName}><span>STUDIO</span><input value={name} onChange={(event) => onNameChange(event.target.value)} /><small>{saveStatus}</small></div>
      <div className={styles.history}><NymiNavigation active="studio" compact /><button title="Salvar agora no PC" onClick={onSave}>✓</button><button title="Desfazer" disabled={!canUndo} onClick={onUndo}>↶</button><button title="Refazer" disabled={!canRedo} onClick={onRedo}>↷</button></div>
    </header>
    <aside className={styles.leftTools}>
      <button onClick={() => backgroundInput.current?.click()}><span>▧</span><strong>Fundo</strong></button>
      <button onClick={() => objectInput.current?.click()}><span>◇</span><strong>Objetos</strong></button>
      <button onClick={onAddNarrator}><span>≡</span><strong>Narrador</strong></button>
      <button className={styles.bubbleTool} disabled={!selectedCharacter} onClick={() => onAddBubble("fala")} title={bubbleTitle}><span>▢</span><strong>Fala</strong></button>
      <button className={styles.bubbleTool} disabled={!selectedCharacter} onClick={() => onAddBubble("pensamento")} title={bubbleTitle}><span>◌</span><strong>Pensamento</strong></button>
      <div className={styles.toolSpacer} />
      <button className={styles.printButton} onClick={onPrint} disabled={isPrinting}><span>▣</span><strong>{isPrinting ? "Salvando…" : "Print"}</strong></button>
      <button className={styles.openPrintsButton} onClick={onOpenPrints} title="Abrir C:\\PRINTS GACHA NYMI"><span>▤</span><strong>Pasta</strong></button>
      <button className={styles.viewButton} onClick={onView}><span>◉</span><strong>View</strong></button>
      <input ref={backgroundInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onBackgroundChange} />
      <input ref={objectInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onObjectChange} />
    </aside>
  </>;
}
