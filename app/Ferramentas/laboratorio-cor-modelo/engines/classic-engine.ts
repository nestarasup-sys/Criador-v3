import type { AutomaticAnalysis, ColorAnalysisEngine } from "./engine-contract";

type WorkerResult = {
  id: number;
  pupils?: ArrayBuffer;
  brows?: ArrayBuffer;
  confidence?: AutomaticAnalysis["confidence"];
  warnings?: string[];
  error?: string;
};

export class ClassicColorAnalysisEngine implements ColorAnalysisEngine {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (result: AutomaticAnalysis) => void; reject: (error: Error) => void }>();

  private getWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("../workers/color-analysis.worker.mjs", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error || !event.data.pupils || !event.data.brows || !event.data.confidence) {
        pending.reject(new Error(event.data.error ?? "Resposta incompleta do analisador."));
        return;
      }
      pending.resolve({
        masks: {
          pupils: new Uint8ClampedArray(event.data.pupils),
          brows: new Uint8ClampedArray(event.data.brows),
        },
        confidence: event.data.confidence,
        warnings: event.data.warnings ?? [],
      });
    };
    this.worker.onerror = () => {
      for (const pending of this.pending.values()) pending.reject(new Error("O analisador automático foi interrompido."));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  analyze(imageData: ImageData) {
    const id = ++this.sequence;
    const pixels = new Uint8ClampedArray(imageData.data);
    return new Promise<AutomaticAnalysis>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.getWorker().postMessage({ id, width: imageData.width, height: imageData.height, pixels: pixels.buffer }, [pixels.buffer]);
    });
  }

  cancel() {
    for (const pending of this.pending.values()) pending.reject(new Error("Análise cancelada."));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  dispose() {
    this.cancel();
  }
}

