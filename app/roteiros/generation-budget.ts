export const AI_CONTEXT_MIN_BLOCK_SECONDS = 3.2;

export type ReactionBudget = {
  durationSeconds: number | null;
  reactionStartSeconds: number | null;
  reactionWindowSeconds: number | null;
  recommendedBlockCount: number | null;
  recommendedBlockRange: { min: number; max: number } | null;
  allowPostVideoContinuation: true;
  warnings: string[];
};

function finiteNonNegative(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? value : null;
}

/** Calcula uma orientação de volume para a IA sem alterar o roteiro salvo. */
export function calculateReactionBudget(durationInput: number | undefined, sceneEndInput: number | undefined): ReactionBudget {
  const durationSeconds = finiteNonNegative(durationInput);
  const reactionStartSeconds = finiteNonNegative(sceneEndInput);
  const warnings: string[] = [];

  if (durationSeconds === null) warnings.push("Duração do vídeo não informada; use a descrição para estimar poucos blocos.");
  if (reactionStartSeconds === null) warnings.push("Início das falas/pensamentos não informado; não calcule uma quantidade exata.");
  if (durationSeconds !== null && reactionStartSeconds !== null && reactionStartSeconds > durationSeconds) {
    warnings.push("O início das reações está depois do fim do vídeo; verifique o tempo informado.");
  }

  if (durationSeconds === null || reactionStartSeconds === null) {
    return { durationSeconds, reactionStartSeconds, reactionWindowSeconds: null, recommendedBlockCount: null, recommendedBlockRange: null, allowPostVideoContinuation: true, warnings };
  }

  const reactionWindowSeconds = Math.max(0, durationSeconds - reactionStartSeconds);
  const recommendedBlockCount = Math.max(1, Math.ceil(reactionWindowSeconds / AI_CONTEXT_MIN_BLOCK_SECONDS));
  return {
    durationSeconds,
    reactionStartSeconds,
    reactionWindowSeconds,
    recommendedBlockCount,
    recommendedBlockRange: { min: Math.max(1, recommendedBlockCount - 1), max: recommendedBlockCount + 1 },
    allowPostVideoContinuation: true,
    warnings,
  };
}
