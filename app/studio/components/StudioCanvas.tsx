import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type CSSProperties } from "react";
import styles from "../studio.module.css";
import type { Character, SceneBubble, SceneCharacter, SceneNarrator, SceneObject, Selection, Studio } from "../types";
import { STUDIO_CHARACTER_HEIGHT, STUDIO_OBJECT_WIDTH, STUDIO_SCENE_HEIGHT, STUDIO_SCENE_WIDTH } from "../scene-layout.mjs";

type StudioCanvasProps = {
  stageRef: RefObject<HTMLDivElement | null>;
  studio: Studio;
  charactersById: Map<string, Character>;
  rendered: Record<string, string>;
  renderedFallback: Record<string, string>;
  selection: Selection;
  renderCacheKey: (character: Character, emotion: string, state: string, instance?: SceneCharacter) => string;
  onStagePointerDown: () => void;
  onBeginDrag: (event: ReactPointerEvent, kind: NonNullable<Selection>["kind"], id: string, x: number, y: number) => void;
  characterPositionsLocked: boolean;
  backgroundEditing: boolean;
  onBeginBackgroundDrag: (event: ReactPointerEvent) => void;
};

export function StudioCanvas({ stageRef, studio, charactersById, rendered, renderedFallback, selection, renderCacheKey, onStagePointerDown, onBeginDrag, characterPositionsLocked, backgroundEditing, onBeginBackgroundDrag }: StudioCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0);
  const sceneElements: SceneCanvasElement[] = [
    ...studio.objects.map((item) => ({ kind: "object" as const, item })),
    ...studio.characters.map((item) => ({ kind: "character" as const, item })),
    ...studio.bubbles.map((item) => ({ kind: "bubble" as const, item })),
    ...studio.narrators.map((item) => ({ kind: "narrator" as const, item })),
  ].sort((a, b) => a.item.z - b.item.z);
  const objects = studio.objects;
  const characters = studio.characters;
  const bubbles = studio.bubbles;
  const narrators = studio.narrators;
  const isEmpty = !studio.background && !characters.length && !objects.length && !bubbles.length && !narrators.length;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      const bounds = viewport.getBoundingClientRect();
      setPreviewScale(Math.min(bounds.width / STUDIO_SCENE_WIDTH, bounds.height / STUDIO_SCENE_HEIGHT));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return <div ref={viewportRef} className={styles.stageViewport} onPointerDown={onStagePointerDown}>
    <div ref={stageRef} className={styles.stage} data-logical-size={`${STUDIO_SCENE_WIDTH}x${STUDIO_SCENE_HEIGHT}`} style={{ "--studio-preview-scale": previewScale } as CSSProperties}>
    {studio.background && <img className={`${styles.background} ${studio.background.fit === "contain" ? styles.contain : ""} ${backgroundEditing ? styles.backgroundEditing : ""}`} style={{ "--background-offset-x": `${studio.background.offsetX ?? 0}px`, "--background-offset-y": `${studio.background.offsetY ?? 0}px`, "--background-scale": studio.background.scale ?? 1 } as CSSProperties} src={studio.background.src} alt="" aria-hidden="true" onPointerDown={backgroundEditing ? onBeginBackgroundDrag : undefined} />}
    {isEmpty && <div className={styles.emptyStageMessage}>Sua cena começa aqui</div>}
    {sceneElements.map((element) => {
      if (element.kind === "object") {
        const object = element.item;
        return <img key={object.id} src={object.src} alt={object.name} className={`${styles.sceneObject} ${selection?.kind === "object" && selection.id === object.id ? styles.selected : ""}`} style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%`, width: STUDIO_OBJECT_WIDTH, zIndex: object.z, "--scene-scale": object.scale, "--scene-flip": object.flipX ? -1 : 1 } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "object", object.id, object.x, object.y)} />;
      }
      if (element.kind === "character") {
        const instance = element.item;
      const character = charactersById.get(instance.characterId);
      // A pose belongs to this scene instance, not to the character's global
      // selection. Include the instance so the Canvas uses the same cache key
      // that the preload effect and roster use for the selected outfit pose.
      const source = character
        ? rendered[renderCacheKey(character, instance.expressionEmotion, instance.expressionState, instance)]
          ?? renderedFallback[instance.id]
          ?? renderedFallback[character.id]
        : undefined;
        return <button key={instance.id} aria-label={`Selecionar ${character?.name ?? "personagem"}`} className={`${styles.sceneCharacter} ${characterPositionsLocked ? styles.characterLocked : ""} ${selection?.kind === "character" && selection.id === instance.id ? styles.selected : ""}`} style={{ left: `${instance.x * 100}%`, top: `${instance.y * 100}%`, height: STUDIO_CHARACTER_HEIGHT, zIndex: instance.z, "--scene-scale": instance.scale, "--scene-flip": instance.flipX ? -1 : 1 } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "character", instance.id, instance.x, instance.y)}>{source ? <img src={source} alt={character?.name ?? "Personagem"} draggable={false} /> : <span>Carregando…</span>}</button>;
      }
      if (element.kind === "bubble") {
        const bubble = element.item;
        return <button key={bubble.id} className={`${styles.bubble} ${bubble.bubbleType === "pensamento" ? styles.thought : ""} ${bubble.tailSide === "right" ? styles.tailRight : ""} ${selection?.kind === "bubble" && selection.id === bubble.id ? styles.selected : ""}`} style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%`, width: bubble.width, fontSize: bubble.fontSize, zIndex: bubble.z, "--scene-scale": bubble.scale } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "bubble", bubble.id, bubble.x, bubble.y)}>{bubble.text}</button>;
      }
      const narrator = element.item;
      return <button key={narrator.id} className={`${styles.narrator} ${narrator.boxed ? styles.boxed : ""} ${selection?.kind === "narrator" && selection.id === narrator.id ? styles.selected : ""}`} style={{ left: `${narrator.x * 100}%`, top: `${narrator.y * 100}%`, width: narrator.width, fontSize: narrator.fontSize, textAlign: narrator.align, zIndex: narrator.z, "--scene-scale": narrator.scale } as CSSProperties} onPointerDown={(event) => onBeginDrag(event, "narrator", narrator.id, narrator.x, narrator.y)}>{narrator.text}</button>;
    })}
    </div>
  </div>;
}

type SceneCanvasElement =
  | { kind: "object"; item: SceneObject }
  | { kind: "character"; item: SceneCharacter }
  | { kind: "bubble"; item: SceneBubble }
  | { kind: "narrator"; item: SceneNarrator };
