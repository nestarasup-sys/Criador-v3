/**
 * Returns whether a Base de dados video is still referenced by any roteiro.
 * Roteiros are persisted by a separate service, so callers must pass the
 * roteiro snapshot explicitly instead of reading the app state document.
 */
export function isBaseVideoReferencedByScripts(scripts, videoId) {
  const targetId = String(videoId ?? "");
  if (!targetId || !Array.isArray(scripts)) return false;
  return scripts.some((script) => Array.isArray(script?.tiktoks)
    && script.tiktoks.some((section) => String(section?.video?.libraryVideoId ?? "") === targetId));
}
