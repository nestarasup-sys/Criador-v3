export const DEFAULT_TEMPLATE_SKIN_COLOR = "#fff0e7";

export const TEMPLATE_SKIN_PALETTE = [
  { name: "Porcelana", color: "#fff0e7" },
  { name: "Pêssego", color: "#f3c8ad" },
  { name: "Mel", color: "#d99a65" },
  { name: "Caramelo", color: "#ad7049" },
  { name: "Canela", color: "#794b38" },
  { name: "Ébano", color: "#4b302b" },
];

const SOURCE_SKIN = [255, 240, 231];
// Inclui pixels antialias e os traços cinza bem suaves do nariz no molde atualizado.
// O contorno marrom e o chroma verde ficam muito além deste limite.
const SKIN_COLOR_DISTANCE = 132;

export function normalizeTemplateSkinColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_TEMPLATE_SKIN_COLOR;
}

export function recolorTemplateSkinPixels(source, width, height, color) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || source.length !== width * height * 4) {
    throw new RangeError("Dimensões inválidas para recolorir o molde.");
  }
  const normalizedColor = normalizeTemplateSkinColor(color);
  const target = [1, 3, 5].map((offset) => Number.parseInt(normalizedColor.slice(offset, offset + 2), 16));
  const output = new Uint8ClampedArray(source);
  for (let index = 0; index < output.length; index += 4) {
    if (output[index + 3] === 0) continue;
    const delta = SOURCE_SKIN.map((channel, channelIndex) => output[index + channelIndex] - channel);
    if (Math.hypot(...delta) > SKIN_COLOR_DISTANCE) continue;
    for (let channelIndex = 0; channelIndex < 3; channelIndex += 1) {
      const shading = SOURCE_SKIN[channelIndex] === 0 ? 0 : output[index + channelIndex] / SOURCE_SKIN[channelIndex];
      output[index + channelIndex] = Math.round(target[channelIndex] * shading);
    }
  }
  return output;
}
