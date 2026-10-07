import type { ReactionBlock } from "./types";

export function blockIsEmpty(block: ReactionBlock) {
  return !block.text.trim();
}

export function readableExpression(key: string) {
  return key.replace(/_(?:blink|talk)$/i, "").replace(/_/g, " ");
}

export function formatTikTokDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds) || seconds === undefined || seconds <= 0) return "duração não disponível";
  return `${seconds.toFixed(2).replace(".", ",")} segundos`;
}

export function formatSceneEnd(seconds: number | undefined) {
  if (!Number.isFinite(seconds) || seconds === undefined) return "fim não definido";
  return `segundo ${seconds.toFixed(2).replace(".", ",")}`;
}

export function exportPathSegment(value: string, fallback: string) {
  const normalized = String(value || fallback).replace(/[<>:"/\\|?*]+/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 120);
  return normalized || fallback;
}

export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => consume()));
  return results;
}
