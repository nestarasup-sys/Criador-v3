const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
  const hex = match?.[1] || "ffffff";
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function rgbToHsl(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === red
    ? (green - blue) / delta + (green < blue ? 6 : 0)
    : max === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness];
}

function hueChannel(p, q, value) {
  let hue = value;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hue, saturation, lightness) {
  if (saturation <= .0001) return [lightness, lightness, lightness];
  const q = lightness < .5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [hueChannel(p, q, hue + 1 / 3), hueChannel(p, q, hue), hueChannel(p, q, hue - 1 / 3)];
}

function luminance(red, green, blue) {
  return red * .2126 + green * .7152 + blue * .0722;
}

function histogramPercentile(histogram, count, ratio) {
  const target = Math.max(1, Math.round(count * ratio));
  let running = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    running += histogram[index];
    if (running >= target) return index / 255;
  }
  return 1;
}

/**
 * Recolors RGBA pixels around a target color while mapping the original
 * luminance range into a target tonal band. This preserves highlights,
 * shadows and texture even when moving between black, white and vivid colors.
 */
export function recolorPixels(data, options = {}) {
  const output = new Uint8ClampedArray(data);
  const strength = clamp01((Number(options.tintStrength) || 0) / 100);
  if (strength <= 0) return output;

  const histogram = new Uint32Array(256);
  let visibleCount = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] <= 8) continue;
    const value = luminance(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255);
    histogram[Math.round(clamp01(value) * 255)] += 1;
    visibleCount += 1;
  }
  if (!visibleCount) return output;
  const low = histogramPercentile(histogram, visibleCount, .03);
  const high = histogramPercentile(histogram, visibleCount, .97);
  const spread = Math.max(.035, high - low);
  const cumulative = new Uint32Array(256);
  let running = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    running += histogram[index];
    cumulative[index] = running;
  }

  const [targetRed, targetGreen, targetBlue] = parseHex(options.tint);
  let [targetHue, targetSaturation, targetLightness] = rgbToHsl(targetRed, targetGreen, targetBlue);
  targetHue = ((targetHue + finite(options.hue, 0) / 360) % 1 + 1) % 1;
  targetSaturation = clamp01(targetSaturation * Math.max(0, finite(options.saturation, 100)) / 100);
  targetLightness = clamp01(targetLightness + (finite(options.brightness, 100) - 100) / 200);

  const detail = clamp01(finite(options.detailPreservation, 78) / 100);
  const contrast = Math.max(0, Math.min(2.5, finite(options.contrast, 100) / 100));
  const extremeTarget = targetLightness < .16 || targetLightness > .84;
  const tonalRange = (.05 + detail * .43) * (extremeTarget ? .72 : 1);
  let bandLow;
  let bandHigh;
  if (targetLightness >= .7) {
    bandLow = Math.max(0, targetLightness - tonalRange);
    bandHigh = targetLightness;
  } else if (targetLightness <= .3) {
    bandLow = targetLightness;
    bandHigh = Math.min(1, targetLightness + tonalRange);
  } else {
    bandLow = Math.max(0, targetLightness - tonalRange / 2);
    bandHigh = Math.min(1, targetLightness + tonalRange / 2);
  }

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] <= 8) continue;
    const sourceRed = data[index] / 255;
    const sourceGreen = data[index + 1] / 255;
    const sourceBlue = data[index + 2] / 255;
    const sourceLuminance = luminance(sourceRed, sourceGreen, sourceBlue);
    const bin = Math.round(clamp01(sourceLuminance) * 255);
    const rankTone = (cumulative[bin] - histogram[bin] / 2) / visibleCount;
    const linearTone = clamp01((sourceLuminance - low) / spread);
    // Rank-based tone resists bright protected details skewing a mostly dark
    // asset; the linear component keeps real luminance relationships intact.
    let tone = clamp01(linearTone * .42 + rankTone * .58);
    tone = clamp01(.5 + (tone - .5) * contrast);
    // A soft S-curve keeps midtone texture without crushing either extreme.
    tone = tone * tone * (3 - 2 * tone);
    const targetTone = bandLow + (bandHigh - bandLow) * tone;
    const desired = hslToRgb(targetHue, targetSaturation, targetTone);

    output[index] = Math.round((sourceRed + (desired[0] - sourceRed) * strength) * 255);
    output[index + 1] = Math.round((sourceGreen + (desired[1] - sourceGreen) * strength) * 255);
    output[index + 2] = Math.round((sourceBlue + (desired[2] - sourceBlue) * strength) * 255);
  }
  return output;
}
