"use client";

import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import { ToolsTopbar } from "../components/ToolsTopbar";
import { EYE_EXPRESSIONS, EXPRESSION_VARIATIONS } from "./constants/expressions";
import { cleanChromaImage, DEFAULT_CHROMA_SETTINGS, loadImage, processEyeSheet, splitPair, type ChromaSettings } from "./core/eye-processing";
import type { EyeExpressionVariation, EyePair, EyePlacement, EyeState } from "./types/eye-model";
import styles from "./fabricador.module.css";

const CANVAS_SIZE = 1000;
const LINKED_VARIATION: EyeExpressionVariation = { left: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 }, right: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 } };
const DEFAULT_PLACEMENT: EyePlacement = { x: 500, y: 418, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 92 };
const PLACEMENT_LIMITS = {
  scale: { min: .35, max: 12 },
  scaleX: { min: .5, max: 6.8 },
  scaleY: { min: .5, max: 6.8 },
  gap: { min: 0, max: 1040 },
  rotation: { min: -80, max: 80 },
} as const;

type LoadedPair = { left: HTMLImageElement; right: HTMLImageElement };

function imageFromPair(pair: EyePair, state: EyeState): Promise<LoadedPair> {
  const [left, right] = splitPair(pair[state]);
  return Promise.all([loadImage(left), loadImage(right)]).then(([leftImage, rightImage]) => ({ left: leftImage, right: rightImage }));
}

function drawComposition(
  context: CanvasRenderingContext2D,
  template: HTMLImageElement,
  pair: LoadedPair | null,
  placement: EyePlacement,
  state: EyeState,
  variation: EyeExpressionVariation = LINKED_VARIATION,
) {
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.drawImage(template, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (!pair) return;
  const gap = placement.gap * placement.scale;
  const drawEye = (image: HTMLImageElement, side: -1 | 1, transform: EyeExpressionVariation["left"]) => {
    const width = image.naturalWidth * placement.scale * placement.scaleX * transform.scaleX;
    const height = image.naturalHeight * placement.scale * placement.scaleY * transform.scaleY;
    const angle = (placement.rotation + transform.rotation) * Math.PI / 180;
    context.save(); context.translate(placement.x + side * gap / 2 + transform.x, placement.y + transform.y); context.rotate(angle);
    context.drawImage(image, -width / 2, -height / 2, width, height); context.restore();
  };
  drawEye(pair.left, -1, variation.left); drawEye(pair.right, 1, variation.right);
  void state;
}

export default function FabricadorDeModeloPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [template, setTemplate] = useState<HTMLImageElement | null>(null);
  const [pair, setPair] = useState<EyePair | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [chromaSettings, setChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [loaded, setLoaded] = useState<LoadedPair | null>(null);
  const [state, setState] = useState<EyeState>("open");
  const [placement, setPlacement] = useState<EyePlacement>(DEFAULT_PLACEMENT);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("Envie uma folha para começar");
  const [generated, setGenerated] = useState<string[]>([]);

  useEffect(() => {
    fetch("/Ferramentas/fabricador-de-modelo/molde.png").then((response) => response.blob()).then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = URL.createObjectURL(blob);
    })).then((image) => {
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
      const cleaned = cleanChromaImage(context.getImageData(0, 0, canvas.width, canvas.height));
      context.putImageData(cleaned, 0, 0); const output = new Image(); output.src = canvas.toDataURL("image/png"); output.onload = () => setTemplate(output);
    }).catch(() => setStatus("Não foi possível carregar o molde fixo"));
  }, []);

  const redraw = useCallback((nextPlacement = placement, nextState = state) => {
    const canvas = canvasRef.current; if (!canvas || !template) return;
    const context = canvas.getContext("2d"); if (context) drawComposition(context, template, loaded, nextPlacement, nextState);
  }, [loaded, placement, state, template]);

  useEffect(() => { redraw(); }, [redraw]);

  const onUpload = (file?: File) => {
    if (!file) return;
    setStatus("Limpando fundo e separando os quatro olhos…"); setSourceFile(file); setGenerated([]); setPlacement(DEFAULT_PLACEMENT);
  };

  useEffect(() => {
    if (!sourceFile) return;
    let cancelled = false;
    processEyeSheet(sourceFile, chromaSettings).then(async (result) => {
      if (cancelled) return;
      setPair(result); setLoaded(await imageFromPair(result, state)); setStatus("Folha processada. Ajuste o chroma se algum detalhe branco sumir.");
    }).catch(() => { if (!cancelled) setStatus("Não consegui separar essa folha. Use uma imagem com olhos em duas linhas."); });
    return () => { cancelled = true; };
  }, [chromaSettings, sourceFile]);

  useEffect(() => { if (pair) imageFromPair(pair, state).then(setLoaded); }, [pair, state]);

  const updatePlacement = (key: keyof EyePlacement, value: number) => setPlacement((current) => ({ ...current, [key]: value }));
  const updateChroma = (key: keyof ChromaSettings, value: number) => {
    setStatus("Reprocessando o chroma com os novos controles…");
    setChromaSettings((current) => ({ ...current, [key]: value }));
  };
  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE, y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE };
  };
  const startDrag = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!loaded) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); };
  const drag = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!dragging) return; const point = pointerPosition(event); setPlacement((current) => ({ ...current, x: point.x, y: point.y })); };
  const stopDrag = () => setDragging(false);

  const renderOutput = async (expressionIndex: number, expressionState: EyeState = "open") => {
    if (!template || !pair) return null;
    const images = await imageFromPair(pair, expressionState); const canvas = document.createElement("canvas"); canvas.width = CANVAS_SIZE; canvas.height = CANVAS_SIZE;
    const context = canvas.getContext("2d")!; drawComposition(context, template, images, placement, expressionState, EXPRESSION_VARIATIONS[expressionIndex]);
    return canvas.toDataURL("image/png");
  };

  const generateExpressions = async () => {
    if (!pair) { setStatus("Envie uma folha antes de gerar as expressões"); return; }
    setStatus("Gerando 21 expressões derivadas do posicionamento…");
    const outputs: string[] = []; for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) outputs.push((await renderOutput(index))!);
    setGenerated(outputs); setStatus("21 expressões geradas. Revise a grade e baixe o pacote quando quiser.");
  };

  const downloadPackage = async () => {
    if (!generated.length) return;
    const zip = new JSZip(); generated.forEach((dataUrl, index) => zip.file(`${EYE_EXPRESSIONS[index][0]}.png`, dataUrl.split(",")[1], { base64: true }));
    for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
      const blink = await renderOutput(index, "closed");
      if (blink) zip.file(`${EYE_EXPRESSIONS[index][0]}_blink.png`, blink.split(",")[1], { base64: true });
    }
    zip.file("README.txt", "Fabricador de Modelo — beta\n\n21 expressões derivadas da folha de olhos original.\nO sufixo _blink usa o par fechado detectado na folha.\n");
    const blob = await zip.generateAsync({ type: "blob" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "fabricador-modelo-beta.zip"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className={styles.page}><ToolsTopbar title="Fabricador de Modelo" subtitle="Beta · encaixe e geração de olhos" />
    <main className={styles.workspace}><section className={styles.intro}><div><span className={styles.eyebrow}>MODELO HEAD-ONLY · BETA</span><h1>Fabricador de Modelo</h1><p>Importe uma folha com o par aberto em cima e o par fechado embaixo. O recorte é automático e os dois olhos permanecem vinculados.</p></div><span className={styles.beta}>BETA</span></section>
      <section className={styles.layout}><aside className={styles.panel}><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onUpload(event.target.files?.[0])} /><strong>＋ Enviar folha de olhos</strong><span>PNG, JPG ou WebP · 2 linhas</span></label>
        <div className={styles.status}><i />{status}</div><div className={styles.divider} /><h2>Chroma key</h2><p className={styles.hint}>Se o fundo branco estiver apagando partes do olho, reduza a força ou a tolerância.</p>
        <label>Força <output>{chromaSettings.strength}%</output><input type="range" min="0" max="100" step="1" value={chromaSettings.strength} onChange={(event) => updateChroma("strength", Number(event.target.value))} /></label>
        <label>Tolerância <output>{chromaSettings.tolerance}</output><input type="range" min="2" max="100" step="1" value={chromaSettings.tolerance} onChange={(event) => updateChroma("tolerance", Number(event.target.value))} /></label>
        <label>Suavidade <output>{chromaSettings.softness}</output><input type="range" min="0" max="80" step="1" value={chromaSettings.softness} onChange={(event) => updateChroma("softness", Number(event.target.value))} /></label>
        <button className={styles.reset} onClick={() => { setStatus("Reprocessando o chroma padrão…"); setChromaSettings(DEFAULT_CHROMA_SETTINGS); }}>↺ Restaurar chroma</button><div className={styles.divider} /><h2>Posicionamento vinculado</h2><p className={styles.hint}>Arraste o par no molde. Todos os controles abaixo afetam os dois olhos juntos.</p>
        <label>Zoom <output>{placement.scale.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={placement.scale} onChange={(event) => updatePlacement("scale", Number(event.target.value))} /></label>
        <label>Largura <output>{placement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={placement.scaleX} onChange={(event) => updatePlacement("scaleX", Number(event.target.value))} /></label>
        <label>Altura <output>{placement.scaleY.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={placement.scaleY} onChange={(event) => updatePlacement("scaleY", Number(event.target.value))} /></label>
        <label>Distância entre olhos <output>{placement.gap}px</output><input type="range" min={PLACEMENT_LIMITS.gap.min} max={PLACEMENT_LIMITS.gap.max} step="1" value={placement.gap} onChange={(event) => updatePlacement("gap", Number(event.target.value))} /></label>
        <label>Rotação <output>{placement.rotation}°</output><input type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={placement.rotation} onChange={(event) => updatePlacement("rotation", Number(event.target.value))} /></label>
        <div className={styles.row}><button className={state === "open" ? styles.active : ""} onClick={() => setState("open")}>Olhos abertos</button><button className={state === "closed" ? styles.active : ""} onClick={() => setState("closed")}>Olhos fechados</button></div>
        <button className={styles.reset} onClick={() => setPlacement(DEFAULT_PLACEMENT)}>↺ Restaurar posição</button><button className={styles.generate} onClick={generateExpressions} disabled={!pair}>Gerar 21 expressões <b>→</b></button>{generated.length > 0 && <button className={styles.download} onClick={downloadPackage}>↓ Baixar pacote ZIP</button>}
      </aside>
      <section className={styles.previewPanel}><div className={styles.previewHead}><div><span>PREVIEW DO MOLDE</span><h2>{state === "open" ? "Olhos abertos" : "Olhos fechados"}</h2></div><small>{dragging ? "Solte para posicionar" : "Arraste os olhos para ajustar"}</small></div><div className={styles.canvasWrap}><canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} /></div>
        {generated.length > 0 && <div className={styles.results}><div className={styles.previewHead}><div><span>RESULTADO</span><h2>21 expressões prontas</h2></div><small>Baseadas no par original e no seu encaixe</small></div><div className={styles.grid}>{generated.map((dataUrl, index) => <figure key={EYE_EXPRESSIONS[index][0]}><img src={dataUrl} alt={EYE_EXPRESSIONS[index][1]} /><figcaption>{String(index + 1).padStart(2, "0")} · {EYE_EXPRESSIONS[index][1]}</figcaption></figure>)}</div></div>}
      </section></section>
    </main></div>;
}
