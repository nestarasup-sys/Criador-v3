import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a nova Base de dados possui o layout e os controles básicos independentes", async () => {
  const page = await readFile(new URL("../app/base de dados/BaseDadosPage.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8");
  const storage = await readFile(new URL("../app/base de dados/storage.ts", import.meta.url), "utf8");
  assert.match(page, /Exportar guia/);
  assert.match(page, /Exportar dados/);
  assert.match(page, /Descrição do que acontece no vídeo/);
  assert.match(page, /Tempo que acaba a cena de descrição/);
  assert.match(page, /uploadBaseDadosVideo/);
  assert.match(page, /removeBaseDadosVideo/);
  assert.match(page, /baseDadosVideoUrl/);
  assert.match(storage, /\/base-dados\/videos/);
  assert.match(shell, /Base de dados/);
});
