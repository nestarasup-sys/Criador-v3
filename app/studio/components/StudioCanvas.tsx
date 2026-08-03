import type { PointerEvent as ReactPointerEvent, RefObject, CSSProperties } from "react";
import styles from "../studio.module.css";
import type { Character, Selection, Studio } from "../types";

type StudioCanvasProps = {
  stageRef: RefObject<HTMLDivElement | null>;
  studio: Studio;
  charactersById: Map<string, Character>;
  rendered: Record<string, string>;
  selection: Selection;
  renderCacheKey: (character: Character, emotion: string, state: string) => string;
  onStagePointerDown: () => void;
  onBeginDrag: (event: ReactPointerEvent, kind: NonNullable<Selection>["kind"], id: string, x: number, y: number) => void;
};

export function StudioCanvas({ stageRef, studio, charactersById, rendered, selection, renderCacheKey, onStagePointerDown, onBeginDrag }: StudioCanvasProps) {
  const objects = [...studio.objects].sort((a, b) => a.z - b.z);
  const characters = [...studio.characters].sort((a, b) => a.z - b.z);
  const bubbles = [...studio.bubbles].sort((a, b) => a.z - b.z);
  const narrators = [...studio.narrators].sort((a, b) => a.z - b.z);
  const isEmpty = !studio.background && !characters.length && !objects.length && !bubbles.length && !narrators.length;
  return <div ref={stageRef} className={styles.stage} onPointerDown={onStagePointerDown}>
    {studio.background && <img className={`${styles.background} ${studio.background.fit === "contain" ? styles.contain : ""}`} src={studio.background.src} alt="" aria-hidden="true" />}
    {isEmpty && <div className={styles.emptyStageMessage}>Sua cena começa aqui</div>}
    {objects.map((object) => <img key={object.id} src={object.src} alt={object.name} className={`${styles.sceneObject} ${selection?.kind === "object" && selection.id === object.id ? styles.selected : ""}`} style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%`, zIndex: object.z, "--scene-scale": object.scale, "--scene-flip": object.flipX ? -1 : 1 } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "object", object.id, object.x, object.y)} />)}
    {characters.map((instance) => {
      const character = charactersById.get(instance.characterId);
      const source = character ? rendered[renderCacheKey(character, instance.expressionEmotion, instance.expressionState)] : undefined;
      return <button key={instance.id} aria-label={`Selecionar ${character?.name ?? "personagem"}`} className={`${styles.sceneCharacter} ${selection?.kind === "character" && selection.id === instance.id ? styles.selected : ""}`} style={{ left: `${instance.x * 100}%`, top: `${instance.y * 100}%`, zIndex: instance.z, "--scene-scale": instance.scale, "--scene-flip": instance.flipX ? -1 : 1 } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "character", instance.id, instance.x, instance.y)}>{source ? <img src={source} alt={character?.name ?? "Personagem"} /> : <span>Carregando…</span>}</button>;
    })}
    {bubbles.map((bubble) => <button key={bubble.id} className={`${styles.bubble} ${bubble.bubbleType === "pensamento" ? styles.thought : ""} ${bubble.tailSide === "right" ? styles.tailRight : ""} ${selection?.kind === "bubble" && selection.id === bubble.id ? styles.selected : ""}`} style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%`, width: bubble.width, fontSize: bubble.fontSize, zIndex: bubble.z, "--scene-scale": bubble.scale } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "bubble", bubble.id, bubble.x, bubble.y)}>{bubble.text}</button>)}
    {narrators.map((narrator) => <button key={narrator.id} className={`${styles.narrator} ${narrator.boxed ? styles.boxed : ""} ${selection?.kind === "narrator" && selection.id === narrator.id ? styles.selected : ""}`} style={{ left: `${narrator.x * 100}%`, top: `${narrator.y * 100}%`, width: narrator.width, fontSize: narrator.fontSize, textAlign: narrator.align, zIndex: narrator.z, "--scene-scale": narrator.scale } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "narrator", narrator.id, narrator.x, narrator.y)}>{narrator.text}</button>)}
  </div>;
}
