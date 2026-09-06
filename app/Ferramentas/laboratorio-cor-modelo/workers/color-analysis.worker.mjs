import { detectColorAnatomy } from "../core/automatic-anatomy.mjs";

self.onmessage = (event) => {
  const { id, width, height, pixels } = event.data;
  try {
    const result = detectColorAnatomy({ data: new Uint8ClampedArray(pixels), width, height });
    const pupilBuffer = result.pupils.buffer;
    const browBuffer = result.brows.buffer;
    self.postMessage({
      id,
      pupils: pupilBuffer,
      brows: browBuffer,
      confidence: result.confidence,
      warnings: result.warnings,
    }, [pupilBuffer, browBuffer]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Falha desconhecida na análise." });
  }
};

