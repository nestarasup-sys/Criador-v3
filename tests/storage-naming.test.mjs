import assert from "node:assert/strict";
import test from "node:test";
import { printTimestamp, safeExportFolderName, safePrintName } from "../services/storage/naming.mjs";

test("safePrintName produces filesystem-safe short names", () => {
  assert.equal(safePrintName("  Olá, Mundo!  "), "Ola-Mundo");
  assert.equal(safePrintName("***"), "studio");
  assert.equal(safePrintName("a".repeat(200)).length, 80);
});

test("safeExportFolderName removes Windows-reserved path characters and trailing dots", () => {
  assert.equal(safeExportFolderName(' Episódio: 01 / teste? '), "Episódio- 01 - teste-");
  assert.equal(safeExportFolderName("...   "), "Roteiro");
  assert.equal(safeExportFolderName("", "Projeto"), "Projeto");
});

test("printTimestamp is deterministic for an explicit date", () => {
  const date = new Date(2026, 9, 6, 20, 30, 4, 7);
  assert.equal(printTimestamp(date), "2026-10-06_20-30-04-007");
});
