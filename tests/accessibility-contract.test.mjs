import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém contratos de teclado, foco, redução de movimento e status acessível", async () => {
  const [globalCss, shell, creator, canvas, home, editor] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioCanvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(globalCss, /:where\(button, a, input, select, textarea\):focus-visible/);
  assert.match(globalCss, /prefers-reduced-motion/);
  assert.match(shell, /aria-current/);
  assert.match(shell, /role="status"/);
  assert.match(creator, /aria-label="Pré-visualização do personagem"/);
  assert.match(creator, /aria-label="Zoom da pré-visualização"/);
  assert.match(canvas, /aria-label/);
  assert.match(home, /aria-label="Áreas de Roteiros"/);
  assert.match(editor, /RecoveryBanner/);
});

test("cores principais atendem contraste AA para texto normal", () => {
  const luminance = (hex) => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const contrast = (foreground, background) => { const a = luminance(foreground); const b = luminance(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  assert.ok(contrast("#20212a", "#f4f3f7") >= 4.5);
  assert.ok(contrast("#5f44c8", "#ffffff") >= 4.5);
  assert.ok(contrast("#ffffff", "#7257d9") >= 4.5);
});
