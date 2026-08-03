"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import styles from "./studio.module.css";
import { localDataFetch } from "../lib/local-data-client";
import { expressionKey, renderStudioCharacter } from "./character-renderer";
import { loadAppData, migrateBrowserStudiosToPc, mirrorStudios, openStudioPrintsFolder, recordStudioDeletion, saveStudioPrint, saveStudios, uploadStudioAsset } from "./storage";
import {
  EMOTIONS,
  EXPRESSION_STATES,
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
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

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

function nextZ(studio: Studio) {
  return Math.max(0, ...studio.characters.map((item) => item.z), ...studio.objects.map((item) => item.z), ...studio.bubbles.map((item) => item.z), ...studio.narrators.map((item) => item.z)) + 1;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG")), "image/png");
  });
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
  const [saveStatus, setSaveStatus] = useState("Carregando…");
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
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setViewMode(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
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
    setUndoStack((current) => [...current.slice(-29), clone(studiosRef.current)]);
    setRedoStack([]);
  }, []);

  const updateStudio = useCallback((change: (studio: Studio) => Studio, history = true) => {
    if (!currentId) return;
    if (history) pushHistory();
    setStudios((current) => current.map((item) => item.id === currentId
      ? { ...change(item), updatedAt: new Date().toISOString() }
      : item));
  }, [currentId, pushHistory]);

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current, clone(studiosRef.current)]);
    setStudios(previous);
    setUndoStack((current) => current.slice(0, -1));
    setSelection(null);
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((current) => [...current, clone(studiosRef.current)]);
    setStudios(next);
    setRedoStack((current) => current.slice(0, -1));
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
      background: null, characters: [], objects: [], bubbles: [], narrators: [], createdAt: now, updatedAt: now,
    };
    setStudios((current) => [created, ...current]);
    setCurrentId(created.id);
    setCreateOpen(false);
    setCreateName("");
    setCreateRoster([]);
  }

  function closeCreateModal() {
    if (editingStudioId) setCurrentId(editingStudioId);
    setEditingStudioId(null);
    setCreateOpen(false);
    setCreateName("");
    setCreateRoster([]);
  }

  function duplicateStudio(item: Studio) {
    const copy: Studio = { ...clone(item), id: crypto.randomUUID(), name: `${item.name} — cópia`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
          element.style.setProperty("--drag-x", `${(nextX - x) * bounds.width}px`);
          element.style.setProperty("--drag-y", `${(nextY - y) * bounds.height}px`);
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
    updateStudio((item) => {
      if (kind === "character") return { ...item, characters: item.characters.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneCharacter : entry) };
      if (kind === "object") return { ...item, objects: item.objects.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneObject : entry) };
      if (kind === "bubble") return { ...item, bubbles: item.bubbles.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneBubble : entry) };
      return { ...item, narrators: item.narrators.map((entry) => entry.id === id ? { ...entry, ...patch } as SceneNarrator : entry) };
    }, history);
  }

  function removeSelected() {
    if (!selection) return;
    updateStudio((item) => {
      if (selection.kind === "character") return { ...item, characters: item.characters.filter((entry) => entry.id !== selection.id), bubbles: item.bubbles.filter((entry) => entry.characterInstanceId !== selection.id) };
      if (selection.kind === "object") return { ...item, objects: item.objects.filter((entry) => entry.id !== selection.id) };
      if (selection.kind === "bubble") return { ...item, bubbles: item.bubbles.filter((entry) => entry.id !== selection.id) };
      return { ...item, narrators: item.narrators.filter((entry) => entry.id !== selection.id) };
    });
    setSelection(null);
  }

  function duplicateSelected() {
    if (!studio || !selection || selection.kind === "character") return;
    const id = crypto.randomUUID();
    const z = nextZ(studio);
    if (selection.kind === "object") {
      const source = studio.objects.find((item) => item.id === selection.id);
      if (!source) return;
      const copy = { ...source, id, name: `${source.name} — cópia`, x: Math.min(.95, source.x + .035), y: Math.min(.95, source.y + .035), z };
      updateStudio((item) => ({ ...item, objects: [...item.objects, copy] }));
    } else if (selection.kind === "bubble") {
      const source = studio.bubbles.find((item) => item.id === selection.id);
      if (!source) return;
      const copy = { ...source, id, x: Math.min(.95, source.x + .035), y: Math.min(.95, source.y + .035), z };
      updateStudio((item) => ({ ...item, bubbles: [...item.bubbles, copy] }));
    } else {
      const source = studio.narrators.find((item) => item.id === selection.id);
      if (!source) return;
      const copy = { ...source, id, x: Math.min(.95, source.x + .035), y: Math.min(.95, source.y + .035), z };
      updateStudio((item) => ({ ...item, narrators: [...item.narrators, copy] }));
    }
    setSelection({ kind: selection.kind, id } as Selection);
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
    if (!studio || selection?.kind !== "character") return;
    const character = studio.characters.find((item) => item.id === selection.id);
    if (!character) return;
    const bubble: SceneBubble = { id: crypto.randomUUID(), characterInstanceId: character.id, bubbleType: type, text: "Escreva aqui…", language: "pt", x: Math.min(.85, character.x + .12), y: Math.max(.1, character.y - .27), scale: 1, width: 300, fontSize: 24, tailSide: "left", z: nextZ(studio) };
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

  function estimatedBubbleOffset(bubble: SceneBubble) {
    const charactersPerLine = Math.max(8, Math.floor(bubble.width / Math.max(8, bubble.fontSize * .55)));
    const lines = Math.max(1, Math.ceil(bubble.text.length / charactersPerLine));
    const estimatedHeight = (lines * bubble.fontSize * 1.22 + 30) * bubble.scale;
    return Math.min(.3, Math.max(.09, estimatedHeight / 1080 + .035));
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
          y: Math.min(.96, source.y + estimatedBubbleOffset(source)),
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
    const current = selection.kind === "character" ? studio.characters.find((item) => item.id === selection.id)?.z
      : selection.kind === "object" ? studio.objects.find((item) => item.id === selection.id)?.z
      : selection.kind === "bubble" ? studio.bubbles.find((item) => item.id === selection.id)?.z
      : studio.narrators.find((item) => item.id === selection.id)?.z;
    if (current === undefined) return;
    updateElement(selection.kind, selection.id, { z: direction > 0 ? Math.max(...allZ) + 1 : Math.min(...allZ) - 1 });
  }

  async function leaveStudio() {
    mirrorStudios(studiosRef.current);
    await saveNow("Studio salvo");
    await localDataFetch("/studio/ai/unload", { method: "POST" }).catch(() => undefined);
    setCurrentId(null);
    setSelection(null);
    setDockSide("right");
  }

  async function printScene() {
    if (!studio || isPrinting) return;
    setIsPrinting(true);
    setNotice("Renderizando Print em 1920 × 1080…");
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d");
    if (!context) { setIsPrinting(false); return; }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const width = canvas.width;
    const height = canvas.height;

    try {
      context.fillStyle = "#f3f0f8";
      context.fillRect(0, 0, width, height);

      if (studio.background) {
        const image = await loadCanvasImage(studio.background.src);
        const imageRatio = image.naturalWidth / image.naturalHeight;
        const stageRatio = width / height;
        const contain = studio.background.fit === "contain";
        const drawWidth = (contain ? imageRatio > stageRatio : imageRatio < stageRatio) ? width : height * imageRatio;
        const drawHeight = drawWidth / imageRatio;
        context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      }

    const elements = [
      ...studio.characters.map((item) => ({ kind: "character" as const, item })),
      ...studio.objects.map((item) => ({ kind: "object" as const, item })),
      ...studio.bubbles.map((item) => ({ kind: "bubble" as const, item })),
      ...studio.narrators.map((item) => ({ kind: "narrator" as const, item })),
    ].sort((a, b) => a.item.z - b.item.z);

      for (const element of elements) {
      if (element.kind === "character") {
        const character = charactersById.get(element.item.characterId);
        const cacheKey = character ? renderCacheKey(character, element.item.expressionEmotion, element.item.expressionState) : "";
        const src = character
          ? renderedRef.current[cacheKey] ?? await renderStudioCharacter(character, expressionKey(element.item.expressionEmotion, element.item.expressionState), data.catalog, data.expressionPacks)
          : undefined;
        if (!src) continue;
        const image = await loadCanvasImage(src);
        const drawHeight = height * .72 * element.item.scale;
        const drawWidth = drawHeight * image.naturalWidth / image.naturalHeight;
        context.save();
        context.translate(element.item.x * width, element.item.y * height);
        context.scale(element.item.flipX ? -1 : 1, 1);
        context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        context.restore();
      } else if (element.kind === "object") {
        const image = await loadCanvasImage(element.item.src);
        const drawWidth = width * .18 * element.item.scale;
        const drawHeight = drawWidth * image.naturalHeight / image.naturalWidth;
        context.save();
        context.translate(element.item.x * width, element.item.y * height);
        context.scale(element.item.flipX ? -1 : 1, 1);
        context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        context.restore();
      } else if (element.kind === "bubble") {
        const item = element.item;
        const boxWidth = item.width * item.scale;
        const fontSize = item.fontSize * item.scale;
        context.font = `700 ${fontSize}px Arial, sans-serif`;
        const lines = wrapCanvasText(context, item.text, boxWidth - 36 * item.scale);
        const lineHeight = fontSize * 1.22;
        const boxHeight = Math.max(72 * item.scale, lines.length * lineHeight + 30 * item.scale);
        const left = item.x * width - boxWidth / 2;
        const top = item.y * height - boxHeight / 2;
        context.fillStyle = "white";
        context.strokeStyle = "#322746";
        context.lineWidth = 4 * item.scale;
        context.beginPath();
        context.roundRect(left, top, boxWidth, boxHeight, item.bubbleType === "pensamento" ? 34 * item.scale : 22 * item.scale);
        context.fill(); context.stroke();
        context.beginPath();
        if (item.bubbleType === "fala") {
          const tailX = item.tailSide === "left" ? left + boxWidth * .28 : left + boxWidth * .72;
          context.moveTo(tailX - 15, top + boxHeight - 2);
          context.lineTo(tailX, top + boxHeight + 28 * item.scale);
          context.lineTo(tailX + 18, top + boxHeight - 2);
          context.fill(); context.stroke();
        } else {
          const tailX = item.tailSide === "left" ? left + boxWidth * .26 : left + boxWidth * .74;
          context.arc(tailX, top + boxHeight + 14 * item.scale, 9 * item.scale, 0, Math.PI * 2);
          context.fill(); context.stroke();
          context.beginPath(); context.arc(tailX - (item.tailSide === "left" ? 10 : -10), top + boxHeight + 34 * item.scale, 5 * item.scale, 0, Math.PI * 2); context.fill(); context.stroke();
        }
        context.fillStyle = "#272032";
        context.textAlign = "center";
        context.textBaseline = "middle";
        lines.forEach((line, index) => context.fillText(line, item.x * width, top + 18 * item.scale + lineHeight * (index + .5)));
      } else {
        const item = element.item;
        const boxWidth = item.width * item.scale;
        const fontSize = item.fontSize * item.scale;
        context.font = `700 ${fontSize}px Arial, sans-serif`;
        const lines = wrapCanvasText(context, item.text, boxWidth - 30 * item.scale);
        const lineHeight = fontSize * 1.25;
        const boxHeight = lines.length * lineHeight + 24 * item.scale;
        const left = item.x * width - boxWidth / 2;
        const top = item.y * height - boxHeight / 2;
        if (item.boxed) { context.fillStyle = "rgba(31,24,43,.88)"; context.beginPath(); context.roundRect(left, top, boxWidth, boxHeight, 12 * item.scale); context.fill(); }
        context.fillStyle = item.boxed ? "white" : "#241d2d";
        context.textAlign = item.align;
        context.textBaseline = "middle";
        const textX = item.align === "left" ? left + 15 * item.scale : item.align === "right" ? left + boxWidth - 15 * item.scale : item.x * width;
        lines.forEach((line, index) => context.fillText(line, textX, top + 12 * item.scale + lineHeight * (index + .5)));
        }
      }

      const result = await saveStudioPrint(await canvasToPng(canvas), studio.name);
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
          <div className={styles.libraryActions}><Link href="/" className={styles.ghostButton}>← Personagens</Link><button className={styles.primaryButton} onClick={() => { setEditingStudioId(null); setCreateName(""); setCreateRoster([]); setCreateOpen(true); }}>＋ Criar novo Studio</button></div>
        </header>
        <section className={`${styles.storageCard} ${pcStorageAvailable ? styles.storageReady : styles.storageOffline}`}>
          <div><span>{pcStorageAvailable ? "●" : "○"}</span><div><strong>{pcStorageAvailable ? "Salvamento no PC" : "Somente neste navegador"}</strong><small>{migrationAvailable ? "Existem Studios antigos aguardando migração" : pcStorageAvailable ? "Studios, fundos e objetos ficam disponíveis entre navegadores" : "Abra pelo INICIAR-NYMI-GACHA.bat para sincronizar"}</small></div></div>
          {migrationAvailable
            ? <button onClick={migrateBrowserStudios} disabled={isMigrating}>{isMigrating ? "Migrando…" : "Migrar Studios para o PC"}</button>
            : !pcStorageAvailable && <button onClick={() => saveNow("Sincronização concluída")}>Tentar novamente</button>}
        </section>
        <section className={styles.studioGrid}>
          {studios.length === 0 ? (
            <button className={styles.emptyStudio} onClick={() => { setEditingStudioId(null); setCreateOpen(true); }}><span>＋</span><strong>Crie seu primeiro Studio</strong><small>Escolha um nome e os personagens da cena.</small></button>
          ) : studios.map((item) => (
            <article className={styles.studioCard} key={item.id}>
              <button className={styles.studioPreview} onClick={() => setCurrentId(item.id)}>
                {item.background ? <img src={item.background.src} alt="" /> : <span>STUDIO</span>}
                <i>{item.rosterIds.length} personagens</i>
              </button>
              <div className={styles.studioCardBody}><div><strong>{item.name}</strong><small>Editado {formatDate(item.updatedAt)}</small></div><button title="Abrir" onClick={() => setCurrentId(item.id)}>Abrir</button></div>
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
                  return <button className={active ? styles.pickedCharacter : ""} key={character.id} onClick={() => setCreateRoster((current) => active ? current.filter((id) => id !== character.id) : [...current, character.id])}><span>{character.model === "feminino" ? "F" : "M"}</span><strong>{character.name}</strong><i>{active ? "✓" : "+"}</i></button>;
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

  const selectedCharacter = selection?.kind === "character" ? studio.characters.find((item) => item.id === selection.id) : null;
  const selectedObject = selection?.kind === "object" ? studio.objects.find((item) => item.id === selection.id) : null;
  const selectedBubble = selection?.kind === "bubble" ? studio.bubbles.find((item) => item.id === selection.id) : null;
  const selectedNarrator = selection?.kind === "narrator" ? studio.narrators.find((item) => item.id === selection.id) : null;
  const selectedCharacterSource = selectedCharacter ? charactersById.get(selectedCharacter.characterId) : null;

  return (
    <main className={`${styles.editor} ${viewMode ? styles.viewMode : ""}`}>
      <div ref={stageRef} className={styles.stage} onPointerDown={() => { setSelection(null); setDockSide("right"); }}>
        {studio.background && <img className={`${styles.background} ${studio.background.fit === "contain" ? styles.contain : ""}`} src={studio.background.src} alt="Fundo da cena" />}
        {!studio.background && studio.characters.length === 0 && studio.objects.length === 0 && studio.bubbles.length === 0 && studio.narrators.length === 0 && <div className={styles.emptyStageMessage}>Sua cena começa aqui</div>}
        {[...studio.objects].sort((a, b) => a.z - b.z).map((object) => <img key={object.id} src={object.src} alt={object.name} className={`${styles.sceneObject} ${selection?.kind === "object" && selection.id === object.id ? styles.selected : ""}`} style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%`, zIndex: object.z, "--scene-scale": object.scale, "--scene-flip": object.flipX ? -1 : 1 } as CSSProperties} onPointerDown={(event) => beginDrag(event, "object", object.id, object.x, object.y)} />)}
        {[...studio.characters].sort((a, b) => a.z - b.z).map((instance) => {
          const character = charactersById.get(instance.characterId);
          const source = character ? rendered[renderCacheKey(character, instance.expressionEmotion, instance.expressionState)] : undefined;
          return <button key={instance.id} aria-label={`Selecionar ${character?.name ?? "personagem"}`} className={`${styles.sceneCharacter} ${selection?.kind === "character" && selection.id === instance.id ? styles.selected : ""}`} style={{ left: `${instance.x * 100}%`, top: `${instance.y * 100}%`, zIndex: instance.z, "--scene-scale": instance.scale, "--scene-flip": instance.flipX ? -1 : 1 } as CSSProperties} onPointerDown={(event) => beginDrag(event, "character", instance.id, instance.x, instance.y)}>{source ? <img src={source} alt={character?.name ?? "Personagem"} /> : <span>Carregando…</span>}</button>;
        })}
        {[...studio.bubbles].sort((a, b) => a.z - b.z).map((bubble) => <button key={bubble.id} className={`${styles.bubble} ${bubble.bubbleType === "pensamento" ? styles.thought : ""} ${bubble.tailSide === "right" ? styles.tailRight : ""} ${selection?.kind === "bubble" && selection.id === bubble.id ? styles.selected : ""}`} style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%`, width: bubble.width, fontSize: bubble.fontSize, zIndex: bubble.z, "--scene-scale": bubble.scale } as CSSProperties} onPointerDown={(event) => beginDrag(event, "bubble", bubble.id, bubble.x, bubble.y)}>{bubble.text}</button>)}
        {[...studio.narrators].sort((a, b) => a.z - b.z).map((narrator) => <button key={narrator.id} className={`${styles.narrator} ${narrator.boxed ? styles.boxed : ""} ${selection?.kind === "narrator" && selection.id === narrator.id ? styles.selected : ""}`} style={{ left: `${narrator.x * 100}%`, top: `${narrator.y * 100}%`, width: narrator.width, fontSize: narrator.fontSize, textAlign: narrator.align, zIndex: narrator.z, "--scene-scale": narrator.scale } as CSSProperties} onPointerDown={(event) => beginDrag(event, "narrator", narrator.id, narrator.x, narrator.y)}>{narrator.text}</button>)}
      </div>

      {!viewMode && <>
        <header className={styles.topbar}>
          <button className={styles.roundButton} title="Voltar aos Studios" onClick={leaveStudio}>←</button>
          <div className={styles.studioName}><span>STUDIO</span><input value={studio.name} onChange={(event) => updateStudio((item) => ({ ...item, name: event.target.value }), false)} /><small>{saveStatus}</small></div>
          <div className={styles.history}><button title="Salvar agora no PC" onClick={() => saveNow()}>✓</button><button title="Desfazer" disabled={!undoStack.length} onClick={undo}>↶</button><button title="Refazer" disabled={!redoStack.length} onClick={redo}>↷</button></div>
        </header>

        <aside className={styles.leftTools}>
          <button onClick={() => backgroundInput.current?.click()}><span>▧</span><strong>Fundo</strong></button>
          <button onClick={() => objectInput.current?.click()}><span>◇</span><strong>Objetos</strong></button>
          <button onClick={addNarrator}><span>≡</span><strong>Narrador</strong></button>
          <button className={styles.bubbleTool} disabled={!selectedCharacter} onClick={() => addBubble("fala")} title={selectedCharacter && selectedCharacterSource ? `Criar fala para ${selectedCharacterSource.name}` : "Selecione um personagem primeiro"}><span>▢</span><strong>Fala</strong></button>
          <button className={styles.bubbleTool} disabled={!selectedCharacter} onClick={() => addBubble("pensamento")} title={selectedCharacter && selectedCharacterSource ? `Criar pensamento para ${selectedCharacterSource.name}` : "Selecione um personagem primeiro"}><span>◌</span><strong>Pensamento</strong></button>
          <div className={styles.toolSpacer} />
          <button className={styles.printButton} onClick={printScene} disabled={isPrinting}><span>▣</span><strong>{isPrinting ? "Salvando…" : "Print"}</strong></button>
          <button className={styles.openPrintsButton} onClick={openPrintsFolder} title={"Abrir C:\\PRINTS GACHA MAKER PREMIUM"}><span>▤</span><strong>Pasta</strong></button>
          <button className={styles.viewButton} onClick={() => { setSelection(null); setViewMode(true); }}><span>◉</span><strong>View</strong></button>
          <input ref={backgroundInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseBackground} />
          <input ref={objectInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={addObject} />
        </aside>

        <aside className={`${styles.rightArea} ${dockSide === "left" ? styles.dockLeft : ""}`}>
          <section className={styles.inspector}>
            {studio.background && !selection && <><h3>Fundo</h3><button onClick={() => updateStudio((item) => ({ ...item, background: item.background ? { ...item.background, fit: item.background.fit === "cover" ? "contain" : "cover" } : null }))}>{studio.background.fit === "cover" ? "Mostrar inteiro" : "Preencher tela"}</button><button className={styles.dangerButton} onClick={() => updateStudio((item) => ({ ...item, background: null }))}>Remover fundo</button></>}
            {selectedCharacter && selectedCharacterSource && <CharacterInspector item={selectedCharacter} source={selectedCharacterSource} emotions={emotionOptionsForCharacter(selectedCharacterSource, data.expressionPacks)} onUpdate={(patch) => updateElement("character", selectedCharacter.id, patch)} onLayer={changeLayer} onRemove={removeSelected} />}
            {selectedObject && <ObjectInspector item={selectedObject} onUpdate={(patch) => updateElement("object", selectedObject.id, patch)} onLayer={changeLayer} onRemove={removeSelected} onDuplicate={duplicateSelected} />}
            {selectedBubble && <BubbleInspector item={selectedBubble} onUpdate={(patch) => updateElement("bubble", selectedBubble.id, patch)} onCopy={() => copyBubbleText(selectedBubble.text)} onPaste={() => pasteBubbleText((patch) => updateElement("bubble", selectedBubble.id, patch))} onGenerateEnglish={() => void generateEnglishBubble(selectedBubble)} isTranslating={translatingBubbleId === selectedBubble.id} onLayer={changeLayer} onRemove={removeSelected} onDuplicate={duplicateSelected} />}
            {selectedNarrator && <NarratorInspector item={selectedNarrator} onUpdate={(patch) => updateElement("narrator", selectedNarrator.id, patch)} onLayer={changeLayer} onRemove={removeSelected} onDuplicate={duplicateSelected} />}
            {!selection && !studio.background && <div className={styles.inspectorEmpty}><span>✦</span><strong>Selecione algo</strong><p>Clique em um personagem ou adicione um elemento à cena.</p></div>}
          </section>
          <section className={styles.roster}>
            <div className={styles.rosterHeading}><span>ELENCO</span><button title="Editar participantes" onClick={() => { setEditingStudioId(studio.id); setCreateName(studio.name); setCreateRoster(studio.rosterIds); setCurrentId(null); setCreateOpen(true); }}>＋</button></div>
            <div className={styles.rosterList}>{studio.rosterIds.map((id) => {
              const character = charactersById.get(id);
              if (!character) return null;
              const instance = studio.characters.find((item) => item.characterId === id);
              const active = selection?.kind === "character" && selection.id === instance?.id;
              const rosterSource = rendered[renderCacheKey(character, character.expressionEmotion ?? "normal", character.expressionState ?? "default")];
              return <button key={id} className={`${styles.rosterCard} ${active ? styles.activeRoster : ""}`} onClick={() => addOrSelectCharacter(id)}>{rosterSource ? <img src={rosterSource} alt="" /> : <span>{character.model === "feminino" ? "F" : "M"}</span>}<strong>{character.name}</strong><i className={instance ? styles.onStage : ""}>{instance ? "●" : "+"}</i></button>;
            })}</div>
          </section>
        </aside>
      </>}

      {viewMode && <button className={styles.exitView} onClick={() => setViewMode(false)}>Sair do View · Esc</button>}
      {notice && <div className={styles.toast}>{notice}</div>}
    </main>
  );
}

type InspectorProps<T> = { item: T; onUpdate: (patch: Partial<T>) => void; onLayer: (direction: -1 | 1) => void; onRemove: () => void; onDuplicate?: () => void };

function LayerButtons({ onLayer }: { onLayer: (direction: -1 | 1) => void }) {
  return <div className={styles.inlineButtons}><button onClick={() => onLayer(-1)}>Para trás</button><button onClick={() => onLayer(1)}>Para frente</button></div>;
}

function ScaleControl({ value, onChange, min = .25, max = 2.5 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <label className={styles.rangeField}><span>Scale <b>{Math.round(value * 100)}%</b></span><input type="range" min={min} max={max} step=".05" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function CharacterInspector({ item, source, emotions, onUpdate, onLayer, onRemove }: InspectorProps<SceneCharacter> & { source: Character; emotions: ReadonlyArray<readonly [Emotion, string]> }) {
  return <><div className={styles.inspectorTitle}><div><span>PERSONAGEM</span><h3>{source.name}</h3></div><button onClick={onRemove}>×</button></div><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} /><div className={styles.inspectorSection}><span>Expressão</span><div className={styles.expressionGrid}>{emotions.map(([value, label]) => <button key={value} className={item.expressionEmotion === value ? styles.activeOption : ""} onClick={() => onUpdate({ expressionEmotion: value })}>{label}</button>)}</div><div className={styles.stateSwitch}>{EXPRESSION_STATES.map(([value, label]) => <button key={value} className={item.expressionState === value ? styles.activeOption : ""} onClick={() => onUpdate({ expressionState: value })}>{label}</button>)}</div></div><button className={styles.wideButton} onClick={() => onUpdate({ flipX: !item.flipX })}>↔ Espelhar personagem</button><LayerButtons onLayer={onLayer} /><button className={styles.dangerButton} onClick={onRemove}>Remover da cena</button></>;
}

function ObjectInspector({ item, onUpdate, onLayer, onRemove, onDuplicate }: InspectorProps<SceneObject>) {
  return <><div className={styles.inspectorTitle}><div><span>OBJETO</span><h3>{item.name}</h3></div><button onClick={onRemove}>×</button></div><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.1} max={4} /><button className={styles.wideButton} onClick={() => onUpdate({ flipX: !item.flipX })}>↔ Espelhar objeto</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar objeto</button><button className={styles.dangerButton} onClick={onRemove}>Remover objeto</button></>;
}

function BubbleInspector({ item, onUpdate, onCopy, onPaste, onGenerateEnglish, isTranslating, onLayer, onRemove, onDuplicate }: InspectorProps<SceneBubble> & { onCopy: () => void; onPaste: () => void; onGenerateEnglish: () => void; isTranslating: boolean }) {
  return <><div className={styles.inspectorTitle}><div><span>CHAT</span><h3>{item.bubbleType === "fala" ? "Balão de fala" : "Pensamento"}</h3></div><button onClick={onRemove}>×</button></div><label className={styles.textField}><span className={styles.textFieldHeading}><span>Texto</span><span className={styles.textFieldActions}><button type="button" disabled={!item.text.trim()} onClick={onCopy}>Copiar</button><button type="button" onClick={onPaste}>Colar</button><button type="button" className={styles.aiTextButton} disabled={!item.text.trim() || item.language === "en" || isTranslating} onClick={onGenerateEnglish}>{isTranslating ? "Gerando…" : "Gerar Inglês"}</button></span></span><textarea value={item.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.5} max={2.5} /><label className={styles.rangeField}><span>Largura <b>{item.width}px</b></span><input type="range" min="180" max="560" value={item.width} onChange={(event) => onUpdate({ width: Number(event.target.value) })} /></label><label className={styles.rangeField}><span>Texto <b>{item.fontSize}px</b></span><input type="range" min="14" max="48" value={item.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label><button className={styles.wideButton} onClick={() => onUpdate({ tailSide: item.tailSide === "left" ? "right" : "left" })}>↔ Mudar direção da ponta</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar balão</button><button className={styles.dangerButton} onClick={onRemove}>Excluir balão</button></>;
}

function NarratorInspector({ item, onUpdate, onLayer, onRemove, onDuplicate }: InspectorProps<SceneNarrator>) {
  return <><div className={styles.inspectorTitle}><div><span>NARRADOR</span><h3>Caixa de texto</h3></div><button onClick={onRemove}>×</button></div><label className={styles.textField}>Texto<textarea value={item.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.5} max={2.5} /><label className={styles.rangeField}><span>Largura <b>{item.width}px</b></span><input type="range" min="220" max="800" value={item.width} onChange={(event) => onUpdate({ width: Number(event.target.value) })} /></label><label className={styles.rangeField}><span>Fonte <b>{item.fontSize}px</b></span><input type="range" min="14" max="54" value={item.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label><div className={styles.stateSwitch}>{(["left", "center", "right"] as const).map((align) => <button key={align} className={item.align === align ? styles.activeOption : ""} onClick={() => onUpdate({ align })}>{align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}</button>)}</div><button className={styles.wideButton} onClick={() => onUpdate({ boxed: !item.boxed })}>{item.boxed ? "Usar somente texto" : "Adicionar caixa de fundo"}</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar narração</button><button className={styles.dangerButton} onClick={onRemove}>Excluir narração</button></>;
}
