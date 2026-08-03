"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./studio.module.css";
import { localDataFetch } from "../lib/local-data-client";
import { NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import { expressionKey, renderStudioCharacter } from "./character-renderer";
import { loadAppData, migrateBrowserStudiosToPc, mirrorStudios, openStudioPrintsFolder, recordStudioDeletion, saveStudioPrint, saveStudios, uploadStudioAsset } from "./storage";
import { StudioCanvas } from "./components/StudioCanvas";
import { StudioInspector } from "./components/StudioInspector";
import { StudioRoster } from "./components/StudioRoster";
import { StudioToolbar } from "./components/StudioToolbar";
import { redoStudioHistory, pushStudioHistory, undoStudioHistory } from "./history";
import { cloneStudioValue, duplicateSceneElement, estimatedBubbleOffset, formatStudioDate, nextZ, removeSceneElement, sceneElementZ, updateSceneElement } from "./scene-ops";
import { renderStudioSceneToCanvas, studioCanvasToPng } from "./scene-print-renderer";
import { STUDIO_SCENE_HEIGHT, STUDIO_SCENE_WIDTH } from "./scene-layout.mjs";
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
} from "./types";

const EMPTY_DATA: AppData = { characters: [], catalog: [], expressionPacks: [], studios: [], studioAssets: [] };
function emotionOptionsForCharacter(character: Character, expressionPacks: PcExpressionPack[]): ReadonlyArray<readonly [Emotion, string]> {
  if (character.faceMode === "pack" && character.expressionPackId) {
    const pack = expressionPacks.find((item) => item.id === character.expressionPackId);
    if (pack) {
      const available = new Set(pack.frames.filter((frame) => !frame.key.endsWith("_blink") && !frame.key.endsWith("_talk")).map((frame) => frame.key));
      return EMOTIONS.filter(([value]) => available.has(value));
    }
  }
  const normalizedPack = character.basePackId === "padrao" ? "modelo-1" : character.basePackId ?? "modelo-1";
  return normalizedPack !== "modelo-1" ? NEW_BASE_EMOTIONS : STANDARD_EMOTIONS;
}

export default function StudioPage() {
  const [data, setData] = useState<AppData>(EMPTY_DATA);
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
  const backgroundInput = useRef<HTMLInputElement>(null);
  const objectInput = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);
  const skipNextAutoSaveRef = useRef(true);
  const studiosRef = useRef<Studio[]>([]);
  const browserStudiosRef = useRef<Studio[]>([]);
  const pcStudiosRef = useRef<Studio[]>([]);
  const renderedRef = useRef<Record<string, string>>({});
  const studioWarmupRef = useRef<string | null>(null);

  useEffect(() => {
    loadAppData().then((loaded) => {
      setData(loaded);
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
    ? `${studio.rosterIds.join(",")}|${studio.characters.map((item) => `${item.characterId}:${item.expressionEmotion}:${item.expressionState}`).join(",")}`
    : "";

  const renderCacheKey = useCallback((character: Character, emotion: string, state: string) =>
    `${character.id}:${character.updatedAt}:${emotion}:${state}`, []);

  useEffect(() => {
    const activeStudio = studiosRef.current.find((item) => item.id === currentId);
    if (!activeStudio) return;
    let cancelled = false;
    const tasks: Array<Promise<void>> = [];
    const requested = new Map<string, { character: Character; emotion: string; state: string }>();
    for (const id of activeStudio.rosterIds) {
      const character = charactersById.get(id);
      if (character) requested.set(renderCacheKey(character, character.expressionEmotion ?? "normal", character.expressionState ?? "default"), { character, emotion: character.expressionEmotion ?? "normal", state: character.expressionState ?? "default" });
    }
    for (const instance of activeStudio.characters) {
      const character = charactersById.get(instance.characterId);
      if (character) requested.set(renderCacheKey(character, instance.expressionEmotion, instance.expressionState), { character, emotion: instance.expressionEmotion, state: instance.expressionState });
    }
    const activeKeys = new Set(requested.keys());
    if (Object.keys(renderedRef.current).some((key) => !activeKeys.has(key))) {
      const pruned = Object.fromEntries(Object.entries(renderedRef.current).filter(([key]) => activeKeys.has(key)));
      renderedRef.current = pruned;
      setRendered(pruned);
    }
    requested.forEach((request, key) => {
      if (renderedRef.current[key]) return;
      tasks.push(renderStudioCharacter(request.character, expressionKey(request.emotion, request.state), data.catalog, data.expressionPacks)
        .then((src) => {
          if (cancelled) return;
          renderedRef.current[key] = src;
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
    const instance: SceneCharacter = {
      id: crypto.randomUUID(), characterId, x: .5, y: .58, scale: .82, flipX: false,
      expressionEmotion: character.expressionEmotion ?? "normal",
      expressionState: character.expressionState ?? "default", z: nextZ(studio),
    };
    updateStudio((item) => ({ ...item, characters: [...item.characters, instance] }));
    setSelection({ kind: "character", id: instance.id });
    setDockSide("right");
  }

  function beginDrag(event: ReactPointerEvent, kind: NonNullable<Selection>["kind"], id: string, x: number, y: number) {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind, id } as Selection);
    if (kind === "character" && characterPositionsLocked) return;
    setDockSide((current) => x > .7 ? "left" : x < .45 ? "right" : current);
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
          if (nextX > .7) setDockSide("left");
          else if (nextX < .45) setDockSide("right");
        });
      }
    };
    const stop = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      updateElement(kind, id, { x: nextX, y: nextY }, false);
      window.requestAnimationFrame(() => {
        element.style.removeProperty("--drag-x");
        element.style.removeProperty("--drag-y");
        element.classList.remove(styles.dragging);
      });
    };
    element.classList.add(styles.dragging);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
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

  async function chooseBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setNotice("Enviando fundo…");
    const asset = await uploadStudioAsset(file);
    setData((current) => ({ ...current, studioAssets: [...current.studioAssets, asset] }));
    updateStudio((item) => ({ ...item, background: { assetId: asset.id, src: asset.fileUrl, fit: "cover" } }));
    setNotice("Fundo adicionado");
  }

  async function addObject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !studio) return;
    setNotice("Enviando objeto…");
    const asset = await uploadStudioAsset(file);
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
          <div className={styles.libraryActions}><NymiNavigation active="studio" compact /><Link href="/" className={styles.ghostButton}>← Personagens</Link><button className={styles.primaryButton} onClick={() => { setEditingStudioId(null); setCreateName(""); setCreateRoster([]); setCreateOpen(true); }}>＋ Criar novo Studio</button></div>
        </header>
        <section className={`${styles.storageCard} ${pcStorageAvailable ? styles.storageReady : styles.storageOffline}`}>
          <div><NymiConnectionStatus connected={pcStorageAvailable} detail={migrationAvailable ? "Existem Studios antigos aguardando migração" : undefined} /><div><strong>{pcStorageAvailable ? "Salvamento no PC" : "Somente neste navegador"}</strong><small>{migrationAvailable ? "Existem Studios antigos aguardando migração" : pcStorageAvailable ? "Studios, fundos e objetos ficam disponíveis entre navegadores" : "Abra pelo INICIAR-NYMI-GACHA.bat para sincronizar"}</small></div></div>
          {migrationAvailable
            ? <button onClick={migrateBrowserStudios} disabled={isMigrating}>{isMigrating ? "Migrando…" : "Migrar Studios para o PC"}</button>
            : !pcStorageAvailable && <button onClick={() => saveNow("Sincronização concluída")}>Tentar novamente</button>}
        </section>
        <section className={styles.studioGrid}>
          {studios.length === 0 ? (
            <button className={styles.emptyStudio} onClick={() => { setEditingStudioId(null); setCreateOpen(true); }}><span>＋</span><strong>Crie seu primeiro Studio</strong><small>Escolha um nome e os personagens da cena.</small></button>
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
              <div className={styles.modalHeading}><div><span className={styles.eyebrow}>{editingStudioId ? "EDITAR ESPAÇO" : "NOVO ESPAÇO"}</span><h2>{editingStudioId ? "Editar Studio" : "Criar Studio"}</h2></div><button onClick={closeCreateModal}>×</button></div>
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
  return (
    <main className={`${styles.editor} ${viewMode ? styles.viewMode : ""}`}>
      <StudioCanvas
        stageRef={stageRef}
        studio={studio}
        charactersById={charactersById}
        rendered={rendered}
        selection={selection}
        renderCacheKey={renderCacheKey}
        onStagePointerDown={() => { setSelection(null); setDockSide("right"); }}
        onBeginDrag={beginDrag}
        characterPositionsLocked={characterPositionsLocked}
      />

      {!viewMode && <>
        <StudioToolbar
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          isPrinting={isPrinting}
          selectedCharacterName={selectedCharacterSource?.name}
          backgroundInput={backgroundInput}
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
          onBackgroundChange={chooseBackground}
          onObjectChange={addObject}
        />

      <aside className={`${styles.rightArea} ${dockSide === "left" ? styles.dockLeft : ""} ${rosterCompact ? styles.rosterAreaCompact : ""}`}>
          <div className={styles.inspectorDock}><StudioInspector
            studio={studio}
            selection={selection}
            selectedCharacter={selectedCharacter}
            selectedCharacterSource={selectedCharacterSource ?? null}
            selectedObject={selectedObject}
            selectedBubble={selectedBubble}
            selectedNarrator={selectedNarrator}
            emotions={selectedCharacterSource ? emotionOptionsForCharacter(selectedCharacterSource, data.expressionPacks) : []}
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
          /></div>
          <StudioRoster
            rosterIds={studio.rosterIds}
            charactersById={charactersById}
            rendered={rendered}
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
