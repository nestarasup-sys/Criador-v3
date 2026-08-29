"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./studio.module.css";
import { localDataFetch } from "../lib/local-data-client";
import { NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import { expressionKey, renderStudioCharacter } from "./character-renderer";
import { deleteStudioAsset, loadAppData, migrateBrowserStudiosToPc, mirrorStudios, openStudioPrintsFolder, recordStudioDeletion, saveStudioPrint, saveStudios, uploadStudioAsset } from "./storage";
import { StudioCanvas } from "./components/StudioCanvas";
import { StudioInspector } from "./components/StudioInspector";
import { StudioRoster } from "./components/StudioRoster";
import { StudioToolbar } from "./components/StudioToolbar";
import { StudioBackgroundLibrary } from "./components/StudioBackgroundLibrary";
import { StudioGlyph } from "./components/StudioGlyph";
import { characterForSceneOutfit, cycleSceneOutfitPose, outfitOffsetForVariant, sceneOutfitCacheKey, sceneOutfitPose } from "./outfit-variants";
import { redoStudioHistory, pushStudioHistory, undoStudioHistory } from "./history";
import { cloneStudioValue, duplicateSceneElement, estimatedBubbleOffset, formatStudioDate, nextZ, removeSceneElement, sceneElementZ, updateSceneElement } from "./scene-ops";
import { renderStudioSceneToCanvas, studioCanvasToPng } from "./scene-print-renderer";
import { STUDIO_SCENE_HEIGHT, STUDIO_SCENE_WIDTH } from "./scene-layout.mjs";
import { normalizeBasePackId } from "../domain/base-model.mjs";
import {
  EMOTIONS,
  NEW_BASE_EMOTIONS,
  STANDARD_EMOTIONS,
  type AppData,
  type Character,
  type Emotion,
  type PcExpressionPack,
  type SceneBubble,
  type SceneCharacter,
  type SceneNarrator,
  type SceneObject,
  type Selection,
  type Studio,
  type StudioAsset,
  type StudioBackground,
} from "./types";

const EMPTY_DATA: AppData = { characters: [], catalog: [], expressionPacks: [], studios: [], studioAssets: [] };
type StudioModelPacks = Record<string, Array<{
  id: string;
  name: string;
  expressionKeys: string[];
  source: string;
  version?: string;
}>>;
function emotionOptionsForCharacter(character: Character, expressionPacks: PcExpressionPack[], modelPacks: StudioModelPacks): ReadonlyArray<readonly [Emotion, string]> {
  if (character.faceMode === "pack" && character.expressionPackId) {
    const pack = expressionPacks.find((item) => item.id === character.expressionPackId);
    if (pack) {
      const available = new Set(pack.frames.filter((frame) => !frame.key.endsWith("_blink") && !frame.key.endsWith("_talk")).map((frame) => frame.key));
      return EMOTIONS.filter(([value]) => available.has(value));
    }
  }
  const modelPack = modelPacks[character.model]?.find((pack) => pack.id === normalizeBasePackId(character.basePackId));
  if (modelPack?.expressionKeys?.length) {
    const available = new Set(modelPack.expressionKeys
      .filter((key) => !key.endsWith("_blink") && !key.endsWith("_talk")));
    return EMOTIONS.filter(([value]) => available.has(value));
  }
  const normalizedPack = character.basePackId === "padrao" ? "modelo-1" : character.basePackId ?? "modelo-1";
  return normalizedPack !== "modelo-1" ? NEW_BASE_EMOTIONS : STANDARD_EMOTIONS;
}

export default function StudioPage() {
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [modelPacks, setModelPacks] = useState<StudioModelPacks>({});
  const [studios, setStudios] = useState<Studio[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingStudioId, setEditingStudioId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createRoster, setCreateRoster] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState(false);
  const [dockSide, setDockSide] = useState<"left" | "right">("right");
  const [characterPositionsLocked, setCharacterPositionsLocked] = useState(false);
  const [backgroundCollapsed, setBackgroundCollapsed] = useState(false);
  const [backgroundLibraryOpen, setBackgroundLibraryOpen] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [rosterCompact, setRosterCompact] = useState(false);
  const [, setSaveStatus] = useState("Carregando…");
  const [pcStorageAvailable, setPcStorageAvailable] = useState(false);
  const [migrationAvailable, setMigrationAvailable] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [translatingBubbleId, setTranslatingBubbleId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [rendered, setRendered] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<Studio[][]>([]);
  const [redoStack, setRedoStack] = useState<Studio[][]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const objectInput = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);
  const skipNextAutoSaveRef = useRef(true);
  const studiosRef = useRef<Studio[]>([]);
  const browserStudiosRef = useRef<Studio[]>([]);
  const pcStudiosRef = useRef<Studio[]>([]);
  const renderedRef = useRef<Record<string, string>>({});
  // Keep the previous frame visible while a newly selected expression is
  // rendered, avoiding a transient "Carregando" flash in the canvas.
  const renderedFallbackRef = useRef<Record<string, string>>({});
  const studioWarmupRef = useRef<string | null>(null);

  const refreshCharacterData = useCallback(async (announce = false) => {
    try {
      const loaded = await loadAppData();
      setData((current) => ({
        ...current,
        characters: loaded.characters,
        catalog: loaded.catalog,
        expressionPacks: loaded.expressionPacks,
        studioAssets: loaded.studioAssets,
      }));
      if (announce) setNotice("Personagens atualizados no Studio");
    } catch {
      if (announce) setNotice("Não foi possível atualizar os personagens agora");
    }
  }, []);

  /* The persisted Studio preferences are the source of truth when switching
     documents; these controlled UI states intentionally hydrate from it. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAppData().then((loaded) => {
      setData(loaded);
      setModelPacks(loaded.modelPacks);
      setStudios(loaded.studios);
      studiosRef.current = loaded.studios;
      browserStudiosRef.current = loaded.browserStudios;
      pcStudiosRef.current = loaded.pcStudios;
      setPcStorageAvailable(loaded.pcStorageAvailable);
      setMigrationAvailable(loaded.migrationAvailable);
      loadedRef.current = true;
      setSaveStatus(loaded.pcStorageAvailable
        ? loaded.migrationAvailable ? "Migração pendente" : "Salvo no PC"
        : "Somente neste navegador");
    });
  }, []);

  useEffect(() => {
    const onCharactersUpdated = () => { void refreshCharacterData(true); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "gacha-maker-characters") onCharactersUpdated();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshCharacterData(false);
    };
    window.addEventListener("nymi:characters-updated", onCharactersUpdated);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("nymi:characters-updated", onCharactersUpdated);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshCharacterData]);

  useEffect(() => () => {
    // Unload the local translation model when the Studio page is left entirely.
    void localDataFetch("/studio/ai/unload", { method: "POST", keepalive: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!currentId) {
      studioWarmupRef.current = null;
      return;
    }
    if (studioWarmupRef.current === currentId) return;
    studioWarmupRef.current = currentId;
    // Warm only the Studio translation session so the first click does not pay
    // the model-load cost. Failures stay silent; the button will retry normally.
    void localDataFetch("/studio/ai/warmup", { method: "POST", keepalive: true }).catch(() => undefined);
  }, [currentId]);

  useEffect(() => {
    studiosRef.current = studios;
    if (loadedRef.current) mirrorStudios(studios);
  }, [studios]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    if (migrationAvailable) {
      mirrorStudios(studios);
      return;
    }
    const timer = window.setTimeout(() => {
      setSaveStatus("Salvando no PC…");
      saveStudios(studios)
        .then((synchronized) => {
          pcStudiosRef.current = synchronized;
          setPcStorageAvailable(true);
          setSaveStatus(migrationAvailable ? "Salvo no PC · migração pendente" : "Salvo no PC");
          const savedSnapshot = JSON.stringify(studios);
          if (JSON.stringify(studiosRef.current) === savedSnapshot && JSON.stringify(synchronized) !== savedSnapshot) {
            setStudios(synchronized);
          }
        })
        .catch(() => {
          setPcStorageAvailable(false);
          setSaveStatus("Alterações aguardando sincronização");
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [migrationAvailable, studios]);

  useEffect(() => {
    if (!viewMode) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") void exitViewMode(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [viewMode]);

  useEffect(() => {
    const syncFullscreenState = () => {
      if (!document.fullscreenElement && viewMode) setViewMode(false);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [viewMode]);

  useEffect(() => {
    const preserve = () => {
      mirrorStudios(studiosRef.current);
      if (document.visibilityState === "hidden") void saveStudios(studiosRef.current).catch(() => undefined);
    };
    window.addEventListener("pagehide", preserve);
    document.addEventListener("visibilitychange", preserve);
    return () => {
      window.removeEventListener("pagehide", preserve);
      document.removeEventListener("visibilitychange", preserve);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function saveNow(message = "Studio salvo no PC") {
    if (migrationAvailable) {
      await migrateBrowserStudios();
      return;
    }
    setSaveStatus("Salvando no PC…");
    try {
      const synchronized = await saveStudios(studiosRef.current);
      pcStudiosRef.current = synchronized;
      studiosRef.current = synchronized;
      setStudios(synchronized);
      setPcStorageAvailable(true);
      setSaveStatus(migrationAvailable ? "Salvo no PC · migração pendente" : "Salvo no PC");
      setNotice(message);
    } catch {
      setPcStorageAvailable(false);
      setSaveStatus("Alterações aguardando sincronização");
      setNotice("O PC está indisponível; a cópia ficou protegida neste navegador");
    }
  }

  async function migrateBrowserStudios() {
    setIsMigrating(true);
    setSaveStatus("Migrando para o PC…");
    setNotice("Migrando Studios, fundos e objetos para o PC…");
    try {
      const synchronized = await migrateBrowserStudiosToPc(pcStudiosRef.current, studiosRef.current);
      pcStudiosRef.current = synchronized;
      browserStudiosRef.current = synchronized;
      studiosRef.current = synchronized;
      setStudios(synchronized);
      setPcStorageAvailable(true);
      setMigrationAvailable(false);
      setSaveStatus("Salvo no PC");
      setNotice("Migração concluída; Studios salvos no PC");
    } catch {
      setPcStorageAvailable(false);
      setSaveStatus("Migração aguardando o PC");
      setNotice("Não foi possível migrar agora; os Studios continuam protegidos no navegador");
    } finally {
      setIsMigrating(false);
    }
  }

  const studio = studios.find((item) => item.id === currentId) ?? null;
  const charactersById = useMemo(() => new Map(data.characters.map((character) => [character.id, character])), [data.characters]);
  const backgroundAssets = useMemo(() => {
    const backgroundIds = new Set(studios.map((item) => item.background?.assetId).filter(Boolean));
    const objectIds = new Set(studios.flatMap((item) => item.objects.map((object) => object.assetId)));
    return data.studioAssets.filter((asset) => asset.contentType.startsWith("image/") && (asset.kind === "background" || backgroundIds.has(asset.id) || (!asset.kind && !objectIds.has(asset.id))));
  }, [data.studioAssets, studios]);

  const pushHistory = useCallback(() => {
    setUndoStack((current) => pushStudioHistory(current, studiosRef.current));
    setRedoStack([]);
  }, []);

  const updateStudio = useCallback((change: (studio: Studio) => Studio, history = true) => {
    if (!currentId) return;
    if (history) pushHistory();
    setStudios((current) => current.map((item) => item.id === currentId
      ? { ...change(item), updatedAt: new Date().toISOString() }
      : item));
  }, [currentId, pushHistory]);

  useEffect(() => {
    if (!studio) return;
    const preferences = studio.uiPreferences;
    setCharacterPositionsLocked(preferences?.characterPositionsLocked === true);
    setBackgroundCollapsed(preferences?.backgroundCollapsed === true);
    setRosterCompact(preferences?.rosterCompact === true);
    setDockSide(preferences?.inspectorDockSide === "left" ? "left" : "right");
  }, [studio?.id, studio?.uiPreferences?.characterPositionsLocked, studio?.uiPreferences?.backgroundCollapsed, studio?.uiPreferences?.rosterCompact, studio?.uiPreferences?.inspectorDockSide]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function updateStudioUi(patch: Partial<Studio["uiPreferences"]>) {
    updateStudio((item) => ({ ...item, uiPreferences: {
      characterPositionsLocked: item.uiPreferences?.characterPositionsLocked === true,
      backgroundCollapsed: item.uiPreferences?.backgroundCollapsed === true,
      rosterCompact: item.uiPreferences?.rosterCompact === true,
      inspectorDockSide: item.uiPreferences?.inspectorDockSide === "left" ? "left" : "right",
      ...patch,
    } }), false);
  }

  function undo() {
    const result = undoStudioHistory(undoStack, redoStack, studiosRef.current);
    if (!result) return;
    setRedoStack(result.redo);
    setStudios(result.studios);
    setUndoStack(result.undo);
    setSelection(null);
  }

  function redo() {
    const result = redoStudioHistory(undoStack, redoStack, studiosRef.current);
    if (!result) return;
    setUndoStack(result.undo);
    setStudios(result.studios);
    setRedoStack(result.redo);
    setSelection(null);
  }

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  const characterRenderSignature = studio
    ? `${studio.rosterIds.join(",")}|${studio.characters.map((item) => `${item.characterId}:${item.expressionEmotion}:${item.expressionState}:${item.outfitGroupId ?? ""}:${item.outfitVariantIndex ?? ""}:${JSON.stringify(item.outfitVariantOffsets ?? {})}`).join(",")}|${[...charactersById.values()].map((item) => `${item.id}:${item.updatedAt}:${JSON.stringify(item.colorAdjustments ?? {})}:${JSON.stringify(item.outfitColorAdjustmentsByGroup ?? {})}:${JSON.stringify(item.protectionMasks ?? {})}:${JSON.stringify(item.outfitProtectionMasksByBasePack ?? {})}`).join(",")}`
    : "";

  const renderCacheKey = useCallback((character: Character, emotion: string, state: string, instance?: SceneCharacter) =>
    `${character.id}:${character.updatedAt}:${emotion}:${state}:${JSON.stringify(character.colorAdjustments ?? {})}:${JSON.stringify(character.outfitColorAdjustmentsByGroup ?? {})}:${JSON.stringify(character.protectionMasks ?? {})}:${JSON.stringify(character.outfitProtectionMasksByBasePack ?? {})}:${sceneOutfitCacheKey(character, instance, data.catalog)}`, [data.catalog]);

  useEffect(() => {
    const activeStudio = studiosRef.current.find((item) => item.id === currentId);
    if (!activeStudio) return;
    let cancelled = false;
    const tasks: Array<Promise<void>> = [];
    const requested = new Map<string, { character: Character; emotion: string; state: string }>();
    for (const id of activeStudio.rosterIds) {
      const character = charactersById.get(id);
      const instance = activeStudio.characters.find((item) => item.characterId === id);
      const emotion = instance?.expressionEmotion ?? character?.expressionEmotion ?? "normal";
      const state = instance?.expressionState ?? character?.expressionState ?? "default";
      if (character) requested.set(renderCacheKey(character, emotion, state, instance), { character: characterForSceneOutfit(character, instance, data.catalog), emotion, state });
    }
    for (const instance of activeStudio.characters) {
      const character = charactersById.get(instance.characterId);
      if (character) requested.set(renderCacheKey(character, instance.expressionEmotion, instance.expressionState, instance), { character: characterForSceneOutfit(character, instance, data.catalog), emotion: instance.expressionEmotion, state: instance.expressionState });
    }
    const activeKeys = new Set(requested.keys());
    if (Object.keys(renderedRef.current).some((key) => !activeKeys.has(key))) {
      const pruned = Object.fromEntries(Object.entries(renderedRef.current).filter(([key]) => activeKeys.has(key)));
      renderedRef.current = pruned;
      setRendered(pruned);
    }
    requested.forEach((request, key) => {
      if (renderedRef.current[key]) return;
      tasks.push(renderStudioCharacter(request.character, expressionKey(request.emotion, request.state), data.catalog, data.expressionPacks, modelPacks)
        .then((src) => {
          if (cancelled) return;
          renderedRef.current[key] = src;
          renderedFallbackRef.current[request.character.id] = src;
          const instance = activeStudio.characters.find((item) => item.characterId === request.character.id);
          if (instance) renderedFallbackRef.current[instance.id] = src;
          setRendered((current) => ({ ...current, [key]: src }));
        })
        .catch(() => { if (!cancelled) setNotice(`Não foi possível renderizar ${request.character.name}`); }));
    });
    Promise.allSettled(tasks).catch(() => undefined);
    return () => { cancelled = true; };
  }, [characterRenderSignature, currentId, charactersById, data.catalog, data.expressionPacks, renderCacheKey]);

  function resetRosterUi() {
    setCharacterPositionsLocked(false);
    setBackgroundCollapsed(false);
    setRosterCompact(false);
  }

  function createStudio() {
    if (!createName.trim()) { setNotice("Digite um nome para o Studio"); return; }
    if (!createRoster.length) { setNotice("Escolha pelo menos um personagem"); return; }
    if (editingStudioId) {
      setStudios((current) => current.map((item) => {
        if (item.id !== editingStudioId) return item;
        const allowedInstances = item.characters.filter((entry) => createRoster.includes(entry.characterId));
        const allowedInstanceIds = new Set(allowedInstances.map((entry) => entry.id));
        return {
          ...item,
          name: createName.trim(),
          rosterIds: createRoster,
          characters: allowedInstances,
          bubbles: item.bubbles.filter((entry) => allowedInstanceIds.has(entry.characterInstanceId)),
          updatedAt: new Date().toISOString(),
        };
      }));
      resetRosterUi();
      setCurrentId(editingStudioId);
      setEditingStudioId(null);
      setCreateOpen(false);
      setCreateName("");
      setCreateRoster([]);
      return;
    }
    const now = new Date().toISOString();
    const created: Studio = {
      id: crypto.randomUUID(), name: createName.trim(), rosterIds: createRoster,
      background: null, characters: [], objects: [], bubbles: [], narrators: [],
      uiPreferences: { characterPositionsLocked: false, backgroundCollapsed: false, rosterCompact: false, inspectorDockSide: "right" },
      createdAt: now, updatedAt: now,
    };
    setStudios((current) => [created, ...current]);
    resetRosterUi();
    setCurrentId(created.id);
    setCreateOpen(false);
    setCreateName("");
    setCreateRoster([]);
  }

  function closeCreateModal() {
    if (editingStudioId) { resetRosterUi(); setCurrentId(editingStudioId); }
    setEditingStudioId(null);
    setCreateOpen(false);
    setCreateName("");
    setCreateRoster([]);
  }

  function duplicateStudio(item: Studio) {
    const copy: Studio = { ...cloneStudioValue(item), id: crypto.randomUUID(), name: `${item.name} — cópia`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setStudios((current) => [copy, ...current]);
  }

  function deleteStudio(id: string) {
    recordStudioDeletion(id);
    setStudios((current) => current.filter((entry) => entry.id !== id));
  }

  function addOrSelectCharacter(characterId: string) {
    if (!studio) return;
    const existing = studio.characters.find((item) => item.characterId === characterId);
    if (existing) {
      setSelection({ kind: "character", id: existing.id });
      setDockSide(existing.x > .7 ? "left" : "right");
      return;
    }
    const character = charactersById.get(characterId);
    if (!character) return;
    const selectedOutfit = data.catalog.find((item) => item.id === character.selections.roupas && item.category === "roupas");
    const instance: SceneCharacter = {
      id: crypto.randomUUID(), characterId, x: .5, y: .58, scale: .82, flipX: false,
      expressionEmotion: character.expressionEmotion ?? "normal",
      expressionState: character.expressionState ?? "default",
      ...(selectedOutfit?.outfitGroupId ? { outfitGroupId: selectedOutfit.outfitGroupId, outfitVariantIndex: selectedOutfit.outfitVariantIndex ?? 0 } : {}),
      z: nextZ(studio),
    };
    updateStudio((item) => ({ ...item, characters: [...item.characters, instance] }));
    setSelection({ kind: "character", id: instance.id });
    setDockSide("right");
  }

  function cycleSelectedPose() {
    if (!studio || selection?.kind !== "character") return;
    const instance = studio.characters.find((item) => item.id === selection.id);
    const character = instance ? charactersById.get(instance.characterId) : undefined;
    if (!instance || !character) return;
    const result = cycleSceneOutfitPose(character, instance, data.catalog);
    if (!result) {
      setNotice("A roupa atual não possui variantes de pose");
      return;
    }
    updateStudio((item) => updateSceneElement(item, "character", instance.id, {
      outfitGroupId: result.instance.outfitGroupId,
      outfitVariantIndex: result.instance.outfitVariantIndex,
    }));
    setNotice(`${result.variant.outfitGroupName ?? result.variant.name}: Pose ${result.index + 1}/${result.variants.length}`);
  }

  function nudgeSelectedOutfit(dx: number, dy: number) {
    if (!studio || selection?.kind !== "character") return;
    const instance = studio.characters.find((item) => item.id === selection.id);
    const character = instance ? charactersById.get(instance.characterId) : undefined;
    if (!instance || !character) return;
    const pose = sceneOutfitPose(character, instance, data.catalog);
    const variantId = pose.variant?.id;
    if (!variantId) {
      setNotice("Este personagem não possui uma roupa selecionada");
      return;
    }
    const current = outfitOffsetForVariant(instance, variantId);
    const nextOffsets = {
      ...(instance.outfitVariantOffsets ?? {}),
      [variantId]: {
        x: Math.max(-1000, Math.min(1000, current.x + dx)),
        y: Math.max(-1000, Math.min(1000, current.y + dy)),
      },
    };
    updateStudio((item) => updateSceneElement(item, "character", instance.id, { outfitVariantOffsets: nextOffsets }));
  }

  function beginDrag(event: ReactPointerEvent, kind: NonNullable<Selection>["kind"], id: string, x: number, y: number) {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind, id } as Selection);
    // O lado do inspetor deve reagir ao clique mesmo quando o personagem
    // está bloqueado; o bloqueio impede apenas o arraste.
    setDockSide((current) => x > .7 ? "left" : x < .45 ? "right" : current);
    if (kind === "character" && characterPositionsLocked) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    pushHistory();
    const startX = event.clientX;
    const startY = event.clientY;
    const element = event.currentTarget as HTMLElement;
    let nextX = x;
    let nextY = y;
    let animationFrame = 0;
    const move = (pointer: PointerEvent) => {
      const deltaX = pointer.clientX - startX;
      const deltaY = pointer.clientY - startY;
      nextX = Math.max(0, Math.min(1, x + deltaX / bounds.width));
      nextY = Math.max(0, Math.min(1, y + deltaY / bounds.height));
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          element.style.setProperty("--drag-x", `${(nextX - x) * STUDIO_SCENE_WIDTH}px`);
          element.style.setProperty("--drag-y", `${(nextY - y) * STUDIO_SCENE_HEIGHT}px`);
        });
      }
    };
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      updateElement(kind, id, { x: nextX, y: nextY }, false);
      window.requestAnimationFrame(() => {
        element.style.removeProperty("--drag-x");
        element.style.removeProperty("--drag-y");
        element.classList.remove(styles.dragging);
      });
    };
    element.classList.add(styles.dragging);
    if (typeof element.setPointerCapture === "function") element.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function updateElement(kind: NonNullable<Selection>["kind"], id: string, patch: Record<string, unknown>, history = true) {
    updateStudio((item) => updateSceneElement(item, kind, id, patch), history);
  }

  function removeSelected() {
    if (!selection) return;
    updateStudio((item) => removeSceneElement(item, selection));
    setSelection(null);
  }

  function duplicateSelected() {
    if (!studio || !selection || selection.kind === "character") return;
    const result = duplicateSceneElement(studio, selection);
    if (!result) return;
    updateStudio(() => result.studio);
    setSelection({ kind: result.kind, id: result.id } as Selection);
  }

  async function chooseBackground(file: File) {
    if (!studio) return;
    try {
      setBackgroundBusy(true);
      setNotice("Enviando fundo…");
      const asset = await uploadStudioAsset(file, "background");
      setData((current) => ({ ...current, studioAssets: [...current.studioAssets, asset] }));
      updateStudio((item) => ({ ...item, background: { assetId: asset.id, src: asset.fileUrl, fit: "cover", offsetX: 0, offsetY: 0, scale: 1 } }));
      setNotice("Fundo adicionado à biblioteca");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível adicionar o fundo");
    } finally {
      setBackgroundBusy(false);
    }
  }

  function selectBackground(asset: StudioAsset) {
    if (!studio) return;
    updateStudio((item) => ({ ...item, background: { assetId: asset.id, src: asset.fileUrl, fit: "cover", offsetX: 0, offsetY: 0, scale: 1 } }));
    setNotice(`Fundo aplicado: ${asset.name}`);
  }

  function updateBackground(patch: Partial<StudioBackground>, history = true) {
    updateStudio((item) => item.background ? { ...item, background: { ...item.background, ...patch } } : item, history);
  }

  function centerBackground() {
    updateBackground({ offsetX: 0, offsetY: 0 });
    setNotice("Fundo centralizado");
  }

  function resetBackground() {
    updateBackground({ fit: "cover", offsetX: 0, offsetY: 0, scale: 1 });
    setNotice("Tamanho e posição originais restaurados");
  }

  function beginBackgroundDrag(event: ReactPointerEvent) {
    if (!studio?.background || !backgroundLibraryOpen) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stageRef.current?.getBoundingClientRect();
    const element = event.currentTarget as HTMLImageElement;
    if (!bounds || !element) return;
    pushHistory();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = studio.background.offsetX ?? 0;
    const initialY = studio.background.offsetY ?? 0;
    const previewScale = bounds.width / STUDIO_SCENE_WIDTH;
    let nextX = initialX;
    let nextY = initialY;
    let animationFrame = 0;
    const move = (pointer: PointerEvent) => {
      nextX = Math.max(-STUDIO_SCENE_WIDTH, Math.min(STUDIO_SCENE_WIDTH, initialX + (pointer.clientX - startX) / Math.max(.01, previewScale)));
      nextY = Math.max(-STUDIO_SCENE_HEIGHT, Math.min(STUDIO_SCENE_HEIGHT, initialY + (pointer.clientY - startY) / Math.max(.01, previewScale)));
      if (!animationFrame) animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        element.style.setProperty("--background-drag-x", `${nextX - initialX}px`);
        element.style.setProperty("--background-drag-y", `${nextY - initialY}px`);
      });
    };
    const stop = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      updateBackground({ offsetX: nextX, offsetY: nextY }, false);
      element.style.removeProperty("--background-drag-x");
      element.style.removeProperty("--background-drag-y");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  async function removeBackgroundAsset(asset: StudioAsset) {
    const references = studios.filter((item) => item.background?.assetId === asset.id);
    if (references.length && !window.confirm(`Este fundo está usado em ${references.length} Studio(s). Remover também desses Studios?`)) return;
    // A remoção da biblioteca é deliberadamente destrutiva: o histórico de cena
    // não deve restaurar referências para um arquivo que já foi apagado.
    setStudios((current) => current.map((item) => item.background?.assetId === asset.id ? { ...item, background: null, updatedAt: new Date().toISOString() } : item));
    setData((current) => ({ ...current, studioAssets: current.studioAssets.filter((item) => item.id !== asset.id) }));
    try { await deleteStudioAsset(asset.id); } catch { /* A cópia local continua removida; o servidor fará a limpeza no próximo salvamento. */ }
    setNotice(`Fundo removido: ${asset.name}`);
  }

  async function addObject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !studio) return;
    setNotice("Enviando objeto…");
    const asset = await uploadStudioAsset(file, "object");
    const object: SceneObject = { id: crypto.randomUUID(), name: file.name, assetId: asset.id, src: asset.fileUrl, x: .5, y: .55, scale: 1, flipX: false, z: nextZ(studio) };
    setData((current) => ({ ...current, studioAssets: [...current.studioAssets, asset] }));
    updateStudio((item) => ({ ...item, objects: [...item.objects, object] }));
    setSelection({ kind: "object", id: object.id });
    setDockSide("right");
    setNotice("Objeto adicionado");
  }

  function addNarrator() {
    if (!studio) return;
    const narrator: SceneNarrator = { id: crypto.randomUUID(), text: "Escreva a narração…", x: .5, y: .12, scale: 1, width: 420, fontSize: 26, align: "center", boxed: true, z: nextZ(studio) };
    updateStudio((item) => ({ ...item, narrators: [...item.narrators, narrator] }));
    setSelection({ kind: "narrator", id: narrator.id });
    setDockSide("right");
  }

  function addBubble(type: SceneBubble["bubbleType"]) {
    if (!studio) return;
    const character = selection?.kind === "character" ? studio.characters.find((item) => item.id === selection.id) : undefined;
    const x = character ? Math.min(.85, character.x + .12) : .5;
    const y = character ? Math.max(.1, character.y - .27) : .25;
    const bubble: SceneBubble = { id: crypto.randomUUID(), characterInstanceId: character?.id ?? "", bubbleType: type, text: "Escreva aqui…", language: "pt", x, y, scale: 1, width: 300, fontSize: 24, tailSide: "left", z: nextZ(studio) };
    updateStudio((item) => ({ ...item, bubbles: [...item.bubbles, bubble] }));
    setSelection({ kind: "bubble", id: bubble.id });
    setDockSide(bubble.x > .7 ? "left" : "right");
  }

  async function copyBubbleText(text: string) {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setNotice("Texto copiado");
  }

  async function pasteBubbleText(onUpdate: (patch: Partial<SceneBubble>) => void) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { setNotice("A área de transferência está vazia"); return; }
      onUpdate({ text });
      setNotice("Texto colado");
    } catch {
      setNotice("O navegador não permitiu ler a área de transferência");
    }
  }


  async function generateEnglishBubble(bubble: SceneBubble) {
    if (!bubble.text.trim()) { setNotice("Digite um texto antes de gerar o inglês"); return; }
    if (bubble.language === "en") { setNotice("Este balão já está em inglês"); return; }
    setTranslatingBubbleId(bubble.id);
    setNotice("Gemma está traduzindo para inglês…");
    try {
      const response = await localDataFetch("/studio/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bubble.text, bubbleType: bubble.bubbleType }),
      });
      const result = await response.json().catch(() => ({})) as { translatedText?: string; model?: string; error?: string };
      const translatedText = result.translatedText;
      if (!response.ok || typeof translatedText !== "string" || !translatedText) throw new Error(result.error || "Não foi possível gerar a tradução.");
      updateStudio((item) => {
        const source = item.bubbles.find((entry) => entry.id === bubble.id);
        if (!source) return item;
        const existing = item.bubbles.find((entry) => entry.translationOf === source.id && entry.language === "en");
        if (existing) {
          return { ...item, bubbles: item.bubbles.map((entry) => entry.id === existing.id ? { ...entry, text: translatedText } : entry) };
        }
        const translation: SceneBubble = {
          ...source,
          id: crypto.randomUUID(),
          language: "en",
          translationOf: source.id,
          text: translatedText,
          y: Math.min(.96, source.y + estimatedBubbleOffset(source) + .025),
          z: nextZ(item),
        };
        return { ...item, bubbles: [...item.bubbles, translation] };
      });
      setNotice(`Inglês gerado${result.model ? ` com ${result.model}` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível gerar o inglês");
    } finally {
      setTranslatingBubbleId(null);
    }
  }

  function changeLayer(direction: -1 | 1) {
    if (!studio || !selection) return;
    const allZ = [0, ...studio.characters.map((item) => item.z), ...studio.objects.map((item) => item.z), ...studio.bubbles.map((item) => item.z), ...studio.narrators.map((item) => item.z)];
    const current = sceneElementZ(studio, selection);
    if (current === undefined) return;
    updateElement(selection.kind, selection.id, { z: direction > 0 ? Math.max(...allZ) + 1 : Math.min(...allZ) - 1 });
  }

  async function leaveStudio() {
    await exitViewMode();
    mirrorStudios(studiosRef.current);
    await saveNow("Studio salvo");
    await localDataFetch("/studio/ai/unload", { method: "POST" }).catch(() => undefined);
    resetRosterUi();
    setBackgroundLibraryOpen(false);
    setCurrentId(null);
    setSelection(null);
    setDockSide("right");
  }

  async function enterViewMode() {
    setSelection(null);
    setViewMode(true);
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch {
      // Alguns navegadores bloqueiam fullscreen fora de uma ação direta; o modo View continua disponível.
    }
  }

  async function exitViewMode() {
    setViewMode(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      // O estado visual já foi encerrado mesmo se a API de fullscreen falhar.
    }
  }

  async function printScene() {
    if (!studio || isPrinting) return;
    setIsPrinting(true);
    setNotice("Renderizando Print em 1920 × 1080…");
    try {
      const canvas = await renderStudioSceneToCanvas({
        studio,
        charactersById,
        rendered: renderedRef.current,
        renderCacheKey,
        catalog: data.catalog,
        expressionPacks: data.expressionPacks,
      });
      const result = await saveStudioPrint(await studioCanvasToPng(canvas), studio.name);
      setPcStorageAvailable(true);
      setNotice(`Print salvo em ${result.filePath}`);
    } catch {
      setPcStorageAvailable(false);
      setNotice("Não foi possível salvar o Print. Abra o Premium pelo arquivo BAT e tente novamente.");
    } finally {
      setIsPrinting(false);
    }
  }

  async function openPrintsFolder() {
    try {
      const result = await openStudioPrintsFolder();
      setPcStorageAvailable(true);
      setNotice(`Pasta aberta: ${result.folder}`);
    } catch {
      setPcStorageAvailable(false);
      setNotice("Não foi possível abrir a pasta. Abra o Premium pelo arquivo BAT.");
    }
  }

  if (!currentId || !studio) {
    return (
      <main className={styles.library}>
        <header className={styles.libraryHeader}>
          <div><span className={styles.eyebrow}>NYMI GACHA</span><h1>Seus Studios</h1><p>Monte cenas com os personagens que você já criou.</p></div>
          <div className={styles.libraryActions}><NymiNavigation active="studio" compact /><Link href="/" className={styles.ghostButton}><StudioGlyph name="back" /> Personagens</Link><button className={styles.primaryButton} onClick={() => { setEditingStudioId(null); setCreateName(""); setCreateRoster([]); setCreateOpen(true); }}><StudioGlyph name="add" /> Criar novo Studio</button></div>
        </header>
        <section className={`${styles.storageCard} ${pcStorageAvailable ? styles.storageReady : styles.storageOffline}`}>
          <div><NymiConnectionStatus connected={pcStorageAvailable} detail={migrationAvailable ? "Existem Studios antigos aguardando migração" : undefined} /><div><strong>{pcStorageAvailable ? "Salvamento no PC" : "Somente neste navegador"}</strong><small>{migrationAvailable ? "Existem Studios antigos aguardando migração" : pcStorageAvailable ? "Studios, fundos e objetos ficam disponíveis entre navegadores" : "Abra pelo INICIAR-NYMI-GACHA.bat para sincronizar"}</small></div></div>
          {migrationAvailable
            ? <button onClick={migrateBrowserStudios} disabled={isMigrating}>{isMigrating ? "Migrando…" : "Migrar Studios para o PC"}</button>
            : !pcStorageAvailable && <button onClick={() => saveNow("Sincronização concluída")}>Tentar novamente</button>}
        </section>
        <section className={styles.studioGrid}>
          {studios.length === 0 ? (
            <button className={styles.emptyStudio} onClick={() => { setEditingStudioId(null); setCreateOpen(true); }}><StudioGlyph name="add" /><strong>Crie seu primeiro Studio</strong><small>Escolha um nome e os personagens da cena.</small></button>
          ) : studios.map((item) => (
            <article className={styles.studioCard} key={item.id}>
              <button className={styles.studioPreview} onClick={() => { setCurrentId(item.id); }}>
                {item.background ? <img src={item.background.src} alt="" /> : <span>STUDIO</span>}
                <i>{item.rosterIds.length} personagens</i>
              </button>
              <div className={styles.studioCardBody}><div><strong>{item.name}</strong><small>Editado {formatStudioDate(item.updatedAt)}</small></div><button title="Abrir" onClick={() => { setCurrentId(item.id); }}>Abrir</button></div>
              <div className={styles.cardActions}>
                <button onClick={() => duplicateStudio(item)}>Duplicar</button>
                <button onClick={() => { const name = window.prompt("Novo nome", item.name); if (name?.trim()) setStudios((current) => current.map((entry) => entry.id === item.id ? { ...entry, name: name.trim(), updatedAt: new Date().toISOString() } : entry)); }}>Renomear</button>
                <button className={styles.dangerText} onClick={() => { if (window.confirm(`Excluir o Studio “${item.name}”?`)) deleteStudio(item.id); }}>Excluir</button>
              </div>
            </article>
          ))}
        </section>
        {createOpen && (
          <div className={styles.modalBackdrop} onMouseDown={closeCreateModal}>
            <section className={styles.modal} onMouseDown={(event) => event.stopPropagation()}>
              <div className={styles.modalHeading}><div><span className={styles.eyebrow}>{editingStudioId ? "EDITAR ESPAÇO" : "NOVO ESPAÇO"}</span><h2>{editingStudioId ? "Editar Studio" : "Criar Studio"}</h2></div><button onClick={closeCreateModal}><StudioGlyph name="close" /></button></div>
              <label className={styles.field}>Nome do Studio<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Ex.: Cena no parque" /></label>
              <div className={styles.characterPickerHeading}><strong>Escolha os personagens</strong><span>{createRoster.length} selecionados</span></div>
              <div className={styles.characterPicker}>
                {data.characters.length === 0 ? <p>Crie e salve personagens na página principal primeiro.</p> : data.characters.map((character) => {
                  const active = createRoster.includes(character.id);
                  const photo = character.photoUrl ?? character.photoDataUrl;
                  return <button className={active ? styles.pickedCharacter : ""} key={character.id} onClick={() => setCreateRoster((current) => active ? current.filter((id) => id !== character.id) : [...current, character.id])}><span className={styles.characterPickerAvatar}>{photo ? <img src={photo} alt="" /> : character.model === "feminino" ? "F" : "M"}</span><strong>{character.name}</strong><i>{active ? "✓" : "+"}</i></button>;
                })}
              </div>
              <div className={styles.modalActions}><button className={styles.ghostButton} onClick={closeCreateModal}>Cancelar</button><button className={styles.primaryButton} onClick={createStudio}>{editingStudioId ? "Salvar elenco" : "Criar e abrir"}</button></div>
            </section>
          </div>
        )}
        {notice && <div className={styles.toast}>{notice}</div>}
      </main>
    );
  }

  const selectedCharacter = (selection?.kind === "character" ? studio.characters.find((item) => item.id === selection.id) : null) ?? null;
  const selectedObject = (selection?.kind === "object" ? studio.objects.find((item) => item.id === selection.id) : null) ?? null;
  const selectedBubble = (selection?.kind === "bubble" ? studio.bubbles.find((item) => item.id === selection.id) : null) ?? null;
  const selectedNarrator = (selection?.kind === "narrator" ? studio.narrators.find((item) => item.id === selection.id) : null) ?? null;
  const selectedCharacterSource = selectedCharacter ? charactersById.get(selectedCharacter.characterId) : null;
  const selectedPose = selectedCharacter && selectedCharacterSource
    ? sceneOutfitPose(selectedCharacterSource, selectedCharacter, data.catalog)
    : { groupId: null, variants: [], variant: null, index: 0 };
  const poseLabel = selectedPose.variants.length > 1 ? `Pose ${selectedPose.index + 1}/${selectedPose.variants.length}` : "Pose";
  const poseDisabled = selectedPose.variants.length < 2;
  const outfitAdjustDisabled = !selectedPose.variant;
  return (
    <main className={`${styles.editor} ${viewMode ? styles.viewMode : ""}`}>
      <StudioCanvas
        stageRef={stageRef}
        studio={studio}
        charactersById={charactersById}
        rendered={rendered}
        renderedFallback={renderedFallbackRef.current}
        selection={selection}
        renderCacheKey={renderCacheKey}
        onStagePointerDown={() => { setSelection(null); setDockSide("right"); }}
        onBeginDrag={beginDrag}
        characterPositionsLocked={characterPositionsLocked}
        backgroundEditing={backgroundLibraryOpen}
        onBeginBackgroundDrag={beginBackgroundDrag}
      />

      {!viewMode && <>
        <StudioToolbar
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          isPrinting={isPrinting}
          selectedCharacterName={selectedCharacterSource?.name}
          objectInput={objectInput}
          onLeave={() => { void leaveStudio(); }}
          onSave={() => { void saveNow(); }}
          onUndo={undo}
          onRedo={redo}
          onAddNarrator={addNarrator}
          onAddBubble={addBubble}
          onPrint={() => { void printScene(); }}
          onOpenPrints={() => { void openPrintsFolder(); }}
          onView={() => { void enterViewMode(); }}
          onObjectChange={addObject}
          onOpenBackgroundLibrary={() => setBackgroundLibraryOpen((current) => !current)}
        />

      <aside className={`${styles.rightArea} ${dockSide === "left" ? styles.dockLeft : ""} ${rosterCompact ? styles.rosterAreaCompact : ""}`}>
          {backgroundLibraryOpen && <StudioBackgroundLibrary assets={backgroundAssets} background={studio.background} busy={backgroundBusy} onClose={() => setBackgroundLibraryOpen(false)} onSelect={selectBackground} onAdd={(file) => { void chooseBackground(file); }} onRemove={(asset) => { void removeBackgroundAsset(asset); }} onUpdate={updateBackground} onBeginAdjust={pushHistory} onCenter={centerBackground} onReset={resetBackground} />}
          <div className={styles.inspectorDock}><StudioInspector
            studio={studio}
            selection={selection}
            selectedCharacter={selectedCharacter}
            selectedCharacterSource={selectedCharacterSource ?? null}
            selectedObject={selectedObject}
            selectedBubble={selectedBubble}
            selectedNarrator={selectedNarrator}
            emotions={selectedCharacterSource ? emotionOptionsForCharacter(selectedCharacterSource, data.expressionPacks, modelPacks) : []}
            translatingBubbleId={translatingBubbleId}
            onToggleBackgroundFit={() => updateStudio((item) => ({ ...item, background: item.background ? { ...item.background, fit: item.background.fit === "cover" ? "contain" : "cover" } : null }))}
            backgroundCollapsed={backgroundCollapsed}
            onToggleBackgroundCollapsed={() => { const next = !backgroundCollapsed; setBackgroundCollapsed(next); updateStudioUi({ backgroundCollapsed: next }); }}
            onRemoveBackground={() => updateStudio((item) => ({ ...item, background: null }))}
            onUpdate={updateElement}
            onCopyBubble={() => selectedBubble && void copyBubbleText(selectedBubble.text)}
            onPasteBubble={(onUpdate) => { void pasteBubbleText(onUpdate); }}
            onGenerateEnglish={() => { if (selectedBubble) void generateEnglishBubble(selectedBubble); }}
            onLayer={changeLayer}
            onRemove={removeSelected}
            onDuplicate={duplicateSelected}
            onPrint={() => { void printScene(); }}
            isPrinting={isPrinting}
            onPose={cycleSelectedPose}
            poseLabel={poseLabel}
            poseDisabled={poseDisabled}
            onNudgeOutfit={nudgeSelectedOutfit}
            outfitAdjustDisabled={outfitAdjustDisabled}
          /></div>
          <StudioRoster
            rosterIds={studio.rosterIds}
            charactersById={charactersById}
            rendered={rendered}
            renderedFallback={renderedFallbackRef.current}
            renderCacheKey={renderCacheKey}
            selection={selection}
            onSelectCharacter={addOrSelectCharacter}
            findInstance={(characterId) => studio.characters.find((item) => item.characterId === characterId)}
            onEditRoster={() => { setEditingStudioId(studio.id); setCreateName(studio.name); setCreateRoster(studio.rosterIds); resetRosterUi(); setCurrentId(null); setCreateOpen(true); }}
            positionsLocked={characterPositionsLocked}
            onTogglePositionsLock={() => { const next = !characterPositionsLocked; setCharacterPositionsLocked(next); updateStudioUi({ characterPositionsLocked: next }); }}
            backgroundCollapsed={backgroundCollapsed}
            onToggleBackgroundCollapsed={() => { const next = !backgroundCollapsed; setBackgroundCollapsed(next); updateStudioUi({ backgroundCollapsed: next }); }}
            compact={rosterCompact}
            onToggleCompact={() => { const next = !rosterCompact; setRosterCompact(next); updateStudioUi({ rosterCompact: next }); }}
          />
        </aside>
      </>}

      {viewMode && <button className={styles.exitView} onClick={() => { void exitViewMode(); }}>Sair do View · Esc</button>}
      {notice && <div className={styles.toast}>{notice}</div>}
    </main>
  );
}
