type RenderDebugEvent = {
  at: number;
  operation: string;
  canvasId?: string;
  renderId?: string;
  target?: string;
  layer?: string;
  source?: string;
  args?: unknown[];
  state?: Record<string, unknown>;
  callStack?: string;
  snapshot?: string;
};

type RenderDebugWindow = Window & {
  __NYMI_CHARACTER_RENDER_DEBUG__?: {
    enabled: boolean;
    events: RenderDebugEvent[];
    clear: () => void;
    mark: (operation: string, details?: Partial<RenderDebugEvent>) => void;
    capture: (operation: string, canvas: HTMLCanvasElement, details?: Partial<RenderDebugEvent>) => void;
  };
};

const MAX_EVENTS = 20_000;

function isEnabled() {
  return typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("characterRenderDebug") === "1";
}

const DEBUG_LAYER_COLORS: Record<string, [number, number, number]> = {
  cabelosTras: [255, 0, 255],
  corpo: [255, 220, 0],
  roupas: [0, 255, 255],
  rosto: [40, 100, 255],
  cabelos: [255, 40, 40],
};

/**
 * Recolore apenas em modo diagnóstico para provar a identidade de cada layer.
 * A flag é deliberadamente separada do debug de eventos: o fluxo normal nunca
 * lê pixels nem cria este canvas adicional.
 */
export function colorizeRenderDebugLayer(
  source: CanvasImageSource,
  width: number,
  height: number,
  layer: string,
) {
  if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("characterRenderLayers") !== "1") return source;
  const color = DEBUG_LAYER_COLORS[layer];
  if (!color) return source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3] === 0) continue;
    pixels.data[index] = color[0];
    pixels.data[index + 1] = color[1];
    pixels.data[index + 2] = color[2];
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function sourceLabel(source: CanvasImageSource | undefined) {
  if (!source) return undefined;
  if (source instanceof HTMLImageElement) return source.currentSrc || source.src;
  if (source instanceof HTMLCanvasElement) return `canvas:${source.width}x${source.height}`;
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return `bitmap:${source.width}x${source.height}`;
  }
  return undefined;
}

function safeArgs(args: unknown[]) {
  return args.map((value) => typeof value === "number" || typeof value === "string"
    ? value
    : value && typeof value === "object" && "width" in value && "height" in value
      ? { width: value.width, height: value.height }
      : undefined);
}

function installRenderDebug() {
  if (!isEnabled() || typeof CanvasRenderingContext2D === "undefined") return;
  const debugWindow = window as RenderDebugWindow;
  if (debugWindow.__NYMI_CHARACTER_RENDER_DEBUG__) return;

  const events: RenderDebugEvent[] = [];
  const canvasIds = new WeakMap<HTMLCanvasElement, string>();
  let nextCanvasId = 1;

  const getCanvasId = (canvas: HTMLCanvasElement) => {
    const existing = canvasIds.get(canvas);
    if (existing) return existing;
    const id = `canvas-${nextCanvasId++}`;
    canvasIds.set(canvas, id);
    return id;
  };

  const record = (operation: string, details: Partial<RenderDebugEvent> = {}) => {
    events.push({
      at: performance.now(),
      operation,
      callStack: new Error().stack?.split("\\n").slice(2, 7).join("\\n"),
      ...details,
    });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  };

  debugWindow.__NYMI_CHARACTER_RENDER_DEBUG__ = {
    enabled: true,
    events,
    clear: () => events.splice(0, events.length),
    mark: record,
    capture: (operation, canvas, details = {}) => {
      let snapshot: string | undefined;
      try {
        snapshot = canvas.toDataURL("image/png");
      } catch {
        snapshot = undefined;
      }
      record(operation, {
        ...details,
        canvasId: getCanvasId(canvas),
        args: [canvas.width, canvas.height],
        snapshot,
      });
    },
  };

  const contextPrototype = CanvasRenderingContext2D.prototype;
  const wrapContext = (name: string, readArgs?: (args: unknown[]) => Partial<RenderDebugEvent>) => {
    const original = contextPrototype[name as keyof CanvasRenderingContext2D];
    if (typeof original !== "function") return;
    (contextPrototype as unknown as Record<string, unknown>)[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const canvas = this.canvas;
      const state: Record<string, unknown> = {
        globalCompositeOperation: this.globalCompositeOperation,
        globalAlpha: this.globalAlpha,
        filter: this.filter,
        imageSmoothingEnabled: this.imageSmoothingEnabled,
        imageSmoothingQuality: this.imageSmoothingQuality,
        transform: (() => {
          const transform = this.getTransform();
          return [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
        })(),
      };
      record(name, {
        canvasId: getCanvasId(canvas),
        args: safeArgs(args),
        state,
        ...(readArgs ? readArgs(args) : {}),
      });
      return (original as (...values: unknown[]) => unknown).apply(this, args);
    };
  };

  wrapContext("drawImage", (args) => ({ source: sourceLabel(args[0] as CanvasImageSource) }));
  wrapContext("putImageData");
  wrapContext("clearRect");
  wrapContext("save");
  wrapContext("restore");
  wrapContext("clip");
  wrapContext("setTransform");
  wrapContext("resetTransform");

  const canvasPrototype = HTMLCanvasElement.prototype;
  const originalToBlob = canvasPrototype.toBlob;
  canvasPrototype.toBlob = function (this: HTMLCanvasElement, ...args: Parameters<typeof originalToBlob>) {
    record("toBlob:start", { canvasId: getCanvasId(this), args: [this.width, this.height] });
    const callback = args[0];
    args[0] = ((blob) => {
      record("toBlob:complete", { canvasId: getCanvasId(this), args: [blob?.size ?? 0] });
      callback(blob);
    }) as typeof callback;
    return originalToBlob.apply(this, args);
  };

  const originalToDataUrl = canvasPrototype.toDataURL;
  canvasPrototype.toDataURL = function (this: HTMLCanvasElement, ...args: Parameters<typeof originalToDataUrl>) {
    record("toDataURL", { canvasId: getCanvasId(this), args: [this.width, this.height] });
    return originalToDataUrl.apply(this, args);
  };
}

installRenderDebug();

export function markRenderDebug(operation: string, details: Partial<RenderDebugEvent> = {}) {
  const debugWindow = typeof window === "undefined" ? undefined : window as RenderDebugWindow;
  debugWindow?.__NYMI_CHARACTER_RENDER_DEBUG__?.mark(operation, details);
}

export function captureRenderDebug(
  operation: string,
  canvas: HTMLCanvasElement,
  details: Partial<RenderDebugEvent> = {},
) {
  const debugWindow = typeof window === "undefined" ? undefined : window as RenderDebugWindow;
  debugWindow?.__NYMI_CHARACTER_RENDER_DEBUG__?.capture(operation, canvas, details);
}
