import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type CSSProperties } from "react";
import styles from "../studio.module.css";
import type { Character, SceneBubble, SceneCharacter, SceneNarrator, SceneObject, Selection, Studio } from "../types";
import { STUDIO_CHARACTER_HEIGHT, STUDIO_OBJECT_WIDTH, STUDIO_SCENE_HEIGHT, STUDIO_SCENE_WIDTH } from "../scene-layout.mjs";

type VisibleBounds = {
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const imageBoundsCache = new WeakMap<HTMLImageElement, VisibleBounds | null>();

function measureVisibleBounds(image: HTMLImageElement) {
  const cached = imageBoundsCache.get(image);
  if (cached !== undefined) return cached;
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) {
    imageBoundsCache.set(image, null);
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    imageBoundsCache.set(image, null);
    return null;
  }
  context.drawImage(image, 0, 0);
  const alpha = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[(y * width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    imageBoundsCache.set(image, null);
    return null;
  }
  const padding = 8;
  const bounds = {
    sourceWidth: width,
    sourceHeight: height,
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(width, maxX - minX + 1 + padding * 2),
    height: Math.min(height, maxY - minY + 1 + padding * 2),
  };
  imageBoundsCache.set(image, bounds);
  canvas.width = 0;
  canvas.height = 0;
  return bounds;
}

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
  const [safeFrame, setSafeFrame] = useState({ left: 0, right: 0 });
  const [visibleBoundsByInstance, setVisibleBoundsByInstance] = useState<Record<string, { source: string; bounds: VisibleBounds }>>({});
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
    const editor = viewport?.closest<HTMLElement>(`.${styles.editor}`);
    if (!viewport || !editor) return;
    let frameRequest = 0;
    const updateScale = () => {
      if (frameRequest) return;
      frameRequest = window.requestAnimationFrame(() => {
        frameRequest = 0;
        const editorBounds = editor.getBoundingClientRect();
        const panelSelector = `.${styles.leftTools}, .${styles.inspector}, .${styles.roster}`;
        let left = 0;
        let right = 0;
        for (const panel of editor.querySelectorAll<HTMLElement>(panelSelector)) {
          const panelStyle = window.getComputedStyle(panel);
          if (panelStyle.display === "none" || panelStyle.visibility === "hidden" || panelStyle.pointerEvents === "none") continue;
          const panelBounds = panel.getBoundingClientRect();
          if (panelBounds.width <= 0 || panelBounds.height <= 0) continue;
          const editorCenter = editorBounds.left + editorBounds.width / 2;
          if (panelBounds.right <= editorCenter) left = Math.max(left, panelBounds.right - editorBounds.left);
          if (panelBounds.left >= editorCenter) right = Math.max(right, editorBounds.right - panelBounds.left);
        }
        const nextFrame = { left: Math.max(0, Math.ceil(left)), right: Math.max(0, Math.ceil(right)) };
        setSafeFrame((current) => current.left === nextFrame.left && current.right === nextFrame.right ? current : nextFrame);
        const bounds = viewport.getBoundingClientRect();
        setPreviewScale(Math.min(bounds.width / STUDIO_SCENE_WIDTH, bounds.height / STUDIO_SCENE_HEIGHT));
      });
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    observer.observe(editor);
    const panelSelector = `.${styles.leftTools}, .${styles.inspector}, .${styles.roster}`;
    for (const panel of editor.querySelectorAll<HTMLElement>(panelSelector)) observer.observe(panel);
    const mutationObserver = new MutationObserver(updateScale);
    mutationObserver.observe(editor, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "aria-hidden"] });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
    };
  }, []);

  function handleCharacterImageLoad(instanceId: string, source: string, image: HTMLImageElement) {
    const bounds = measureVisibleBounds(image);
    if (!bounds) return;
    setVisibleBoundsByInstance((current) => {
      const previous = current[instanceId];
      if (previous?.source === source && previous.bounds.x === bounds.x && previous.bounds.y === bounds.y && previous.bounds.width === bounds.width && previous.bounds.height === bounds.height) return current;
      return { ...current, [instanceId]: { source, bounds } };
    });
  }

  return <div ref={viewportRef} className={styles.stageViewport} style={{ "--studio-safe-left": `${safeFrame.left}px`, "--studio-safe-right": `${safeFrame.right}px` } as CSSProperties} onPointerDown={onStagePointerDown}>
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
        const measured = source && visibleBoundsByInstance[instance.id]?.source === source ? visibleBoundsByInstance[instance.id].bounds : null;
        const hitStyle = measured ? {
          left: `${measured.x / measured.sourceWidth * 100}%`,
          top: `${measured.y / measured.sourceHeight * 100}%`,
          width: `${measured.width / measured.sourceWidth * 100}%`,
          height: `${measured.height / measured.sourceHeight * 100}%`,
        } : undefined;
        return <div key={instance.id} aria-label={`Selecionar ${character?.name ?? "personagem"}`} className={`${styles.sceneCharacter} ${characterPositionsLocked ? styles.characterLocked : ""}`} style={{ left: `${instance.x * 100}%`, top: `${instance.y * 100}%`, height: STUDIO_CHARACTER_HEIGHT, zIndex: instance.z, "--scene-scale": instance.scale, "--scene-flip": instance.flipX ? -1 : 1 } as CSSProperties}>
          {source ? <img src={source} alt={character?.name ?? "Personagem"} draggable={false} onLoad={(event) => handleCharacterImageLoad(instance.id, source, event.currentTarget)} /> : <span>Carregando…</span>}
          {source && measured && <button type="button" aria-label={`Selecionar ${character?.name ?? "personagem"}`} className={`${styles.characterHitArea} ${characterPositionsLocked ? styles.characterLocked : ""} ${selection?.kind === "character" && selection.id === instance.id ? styles.selected : ""}`} style={hitStyle} onPointerDown={(event) => onBeginDrag(event, "character", instance.id, instance.x, instance.y)} />}
        </div>;
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
