/** Detect pigment supported by sclera, independently of the iris hue.
 * Coordinates are relative to the measured head, never to a specific model.
 * An unsupported region remains unselected (including closed eyes).
 */
export function detectAutomaticPupils(data, width, height, bounds) {
  const mask = new Uint8Array(width * height);
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const x0 = Math.max(0, Math.ceil(bounds.minX + w * .12));
  const x1 = Math.min(width - 1, Math.floor(bounds.maxX - w * .025));
  const y0 = Math.max(0, Math.ceil(bounds.minY + h * .32));
  const y1 = Math.min(height - 1, Math.floor(bounds.minY + h * .78));
  const kind = new Uint8Array(width * height);
  const hue = new Float32Array(width * height);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = y * width + x, i = p * 4;
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b), delta = hi - lo;
    const saturation = delta / Math.max(1, hi);
    if (lo >= 160 && delta <= 28 && b >= r - 18) { kind[p] = 3; continue; }
    // Exclude pale warm skin/blush; require distinct pigment for the seeds.
    if (hi < 90 && saturation < .3) { kind[p] = 2; continue; }
    if (saturation < .28 || hi < 35 || (hi >= 165 && r >= g && r >= b && saturation < .42)) continue;
    kind[p] = 1;
    hue[p] = ((hi === r ? (g - b) / delta : hi === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) * 60 + 360) % 360;
  }
  const seen = new Uint8Array(width * height);
  const candidates = [];
  const minWhiteRun = Math.max(2, Math.round(w * .012));
  function scleraBeside(x, y, direction) {
    let run = 0;
    for (let d = 1; d <= Math.ceil(w * .10); d++) {
      const xx = x + d * direction;
      if (xx < x0 || xx > x1) break;
      const p = y * width + xx;
      if (kind[p] === 3) {
        if (++run >= minWhiteRun) return true;
      } else {
        run = 0;
        // Only bridge the anti-aliased rim, not a strip of skin.
        if (d > 3 && kind[p] === 0) break;
      }
    }
    return false;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const start = y * width + x;
    if (seen[start] || (kind[start] !== 1 && kind[start] !== 2)) continue;
    const pixels = [start];
    seen[start] = 1;
    let left = x, right = x, top = y, bottom = y;
    for (let q = 0; q < pixels.length; q++) {
      const p = pixels[q], px = p % width, py = Math.floor(p / width);
      left = Math.min(left, px); right = Math.max(right, px);
      top = Math.min(top, py); bottom = Math.max(bottom, py);
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const n = ny * width + nx;
        if (seen[n] || kind[n] !== kind[start]) continue;
        const dh = Math.abs(hue[n] - hue[start]);
        if (kind[start] === 1 && Math.min(dh, 360 - dh) > 32) continue;
        seen[n] = 1; pixels.push(n);
      }
    }
    const cw = right - left + 1, ch = bottom - top + 1;
    if (pixels.length < Math.max(4, w * h * .00009) || cw > w * .20 || ch > h * .18
      || ch < Math.max(3, h * .013) || cw / ch > 2.8 || cw / ch < .18) continue;
    const rows = new Map();
    for (const p of pixels) {
      const yy = Math.floor(p / width), xx = p % width;
      const row = rows.get(yy) ?? [xx, xx];
      row[0] = Math.min(row[0], xx); row[1] = Math.max(row[1], xx); rows.set(yy, row);
    }
    let supportedRows = 0;
    for (const [yy, [l, r]] of rows) if (scleraBeside(l, yy, -1) || scleraBeside(r, yy, 1)) supportedRows++;
    if (supportedRows < Math.max(2, ch * .25)) continue;
    candidates.push({ pixels, left, right, top, bottom, cx: (left + right) / 2,
      cy: (top + bottom) / 2, score: supportedRows * Math.sqrt(pixels.length), rows });
  }
  candidates.sort((a, b) => b.score - a.score);
  const eyes = [];
  for (const c of candidates) {
    if (eyes.some(e => Math.abs(e.cx - c.cx) < w * .16)) continue;
    if (eyes.length && Math.abs(eyes[0].cy - c.cy) > h * .12) continue;
    eyes.push(c);
    if (eyes.length === 2) break;
  }
  for (const eye of eyes) {
    for (const p of eye.pixels) mask[p] = 1;
    // Include the dark central pupil only when enclosed horizontally by iris
    // pigment. White highlights and the external lash remain original.
    for (const [y, [l, r]] of eye.rows) for (let x = l + 1; x < r; x++) {
      const p = y * width + x;
      if (kind[p] === 2) mask[p] = 1;
    }
  }
  return mask;
}
