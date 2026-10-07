import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { render } from "./rendered-app-helper.mjs";

test("renders the Nymi Gacha application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Nymi Gacha<\/title>/i);
  assert.match(html, /Nymi Gacha/);
  assert.match(html, /Estúdio de personagens/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("provides the shared Nymi navigation shell on all primary areas", async () => {
  const [shell, globalCss, characters, creatorTopbar, studio, roteirosHome, roteirosEditor] = await Promise.all([
    readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorTopbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /NymiNavigation/);
  assert.match(shell, /href: "\/"/);
  assert.match(shell, /href: "\/studio"/);
  assert.match(shell, /href: "\/roteiros"/);
  assert.match(shell, /aria-current/);
  assert.match(shell, /role="status"/);
  assert.match(shell, /Conectado ao PC/);
  assert.match(globalCss, /:focus-visible/);
  assert.match(globalCss, /prefers-reduced-motion/);
  assert.match(globalCss, /@media\s*\(max-width:\s*1366px\)/);
  assert.match(characters, /CreatorTopbar/);
  assert.match(creatorTopbar, /NymiNavigation active="characters"/);
  assert.match(studio, /NymiNavigation active="studio"/);
  assert.match(roteirosHome, /NymiNavigation active="roteiros"/);
  assert.match(roteirosEditor, /NymiNavigation active="roteiros"/);
});
