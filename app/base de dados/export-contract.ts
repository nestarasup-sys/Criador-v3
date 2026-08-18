import type { Character } from "../domain/character-contract";
import type { NarrativeProfile } from "../domain/roteiro-contract";
import type { BaseDadosState, BaseDadosVideo } from "./types";

export const BASE_DATABASE_EXPORT_FORMAT = "NYMI_BASE_DATABASE_EXPORT_V2";

export type BaseDadosCharacterExport = {
  character: Omit<Character, "photoDataUrl" | "photoUrl">;
  narrativeProfile?: NarrativeProfile;
};

function formatSeconds(value: number) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "não calculado";
}

function absoluteVideoPath(video: BaseDadosVideo) {
  return video.absolutePath || video.storedPath;
}

function characterBlock(item: BaseDadosCharacterExport) {
  const profile = item.narrativeProfile;
  return [
    "PERSONAGEM",
    `ID: ${item.character.id}`,
    `NOME: ${item.character.name}`,
    "FICHA COMPLETA DO CRIADOR (JSON):",
    JSON.stringify(item.character, null, 2),
    "FICHA NARRATIVA DO ROTEIROS (JSON):",
    JSON.stringify(profile || null, null, 2),
  ].join("\n");
}

export function buildBaseDadosExportText(
  database: BaseDadosState,
  characters: BaseDadosCharacterExport[],
  exportedAt = new Date().toISOString(),
) {
  const videos = database.videos.map((video) => [
    `VÍDEO ${String(video.sequence).padStart(2, "0")}`,
    `ID: ${video.id}`,
    `SEQUÊNCIA: ${String(video.sequence).padStart(2, "0")}`,
    `CAMINHO ABSOLUTO: ${absoluteVideoPath(video)}`,
    `NOME ORIGINAL: ${video.originalName}`,
    "DESCRIÇÃO:",
    video.description.trim() || "Não preenchida.",
    `TEMPO QUE TERMINA A CENA DA DESCRIÇÃO: ${formatSeconds(video.sceneEndSeconds)} segundos`,
    `TEMPO TOTAL DO VÍDEO: ${formatSeconds(video.durationSeconds)} segundos`,
  ].join("\n"));

  return [
    "NYMI — BASE DE DADOS PARA ROTEIRO",
    `FORMATO: ${BASE_DATABASE_EXPORT_FORMAT}`,
    `EXPORTADO EM: ${exportedAt}`,
    "",
    "INSTRUÇÕES DE FONTE",
    "Use somente os IDs existentes neste documento. A IA pode escolher e reorganizar vídeos, mas não pode repetir o mesmo ID.",
    "O tempo final da cena da descrição deve ser usado como início mínimo das falas e pensamentos no roteiro.",
    "",
    "VÍDEOS",
    "======",
    videos.length ? videos.join("\n\n==================================================\n\n") : "Nenhum vídeo cadastrado.",
    "",
    "PERSONAGENS SELECIONADOS",
    "=======================",
    characters.length ? characters.map(characterBlock).join("\n\n==================================================\n\n") : "Nenhum personagem selecionado.",
    "",
  ].join("\n");
}

export function buildBaseDadosGuide() {
  return `# Guia — gerar roteiro importável para o Nymi Gacha

## Tarefa

Você receberá um TXT com vídeos e personagens. Gere imediatamente um JSON válido para ser importado pelo botão **Importar roteiro da IA** do Nymi Gacha.

## Regras obrigatórias

1. Retorne somente JSON válido, sem Markdown, comentários ou explicações fora do JSON.
2. Use somente IDs de vídeos e personagens presentes na base recebida.
3. Você pode escolher qualquer quantidade de vídeos e alterar livremente a ordem.
4. Nunca repita o mesmo vídeo no campo \`videos\`.
5. Use somente os tipos de bloco \`speech\` e \`thought\`.
6. Não invente caminhos, durações, descrições, personagens ou IDs.
7. O app local é a fonte de verdade para caminho, duração, descrição e fim da cena.
8. Falas e pensamentos de um vídeo devem começar no tempo do fim da cena descrita ou depois dele.
9. Um pensamento é privado; uma fala é audível. Não use reações silenciosas.

## Como escolher vídeos

Cada vídeo possui um ID, uma descrição, o tempo total e o segundo em que a descrição termina. Escolha os vídeos mais úteis para a narrativa e devolva a ordem em \`videos\`. O app copiará automaticamente os dados locais completos pelo ID.

## Formato obrigatório

\`\`\`json
{
  "format": "NYMI_IMPORTABLE_SCRIPT_V1",
  "title": "Título do roteiro",
  "videos": [
    { "videoId": "video-01", "order": 1 }
  ],
  "characters": [
    { "characterId": "personagem-01", "role": "principal" }
  ],
  "blocks": [
    {
      "type": "speech",
      "characterId": "personagem-01",
      "videoId": "video-01",
      "text": "Texto da fala",
      "startAt": 10
    },
    {
      "type": "thought",
      "characterId": "personagem-01",
      "videoId": "video-01",
      "text": "Texto do pensamento"
    }
  ]
}
\`\`\`

## Campos

- \`format\`: sempre \`NYMI_IMPORTABLE_SCRIPT_V1\`.
- \`title\`: título do novo roteiro.
- \`videos\`: vídeos selecionados uma única vez, com \`videoId\` e \`order\`.
- \`characters\`: personagens participantes, com \`characterId\` e função opcional.
- \`blocks\`: falas e pensamentos associados a um personagem e vídeo.
- \`startAt\`: opcional, em segundos. Se omitido, o app usará o fim da cena descrita.

O app ignora qualquer caminho ou duração que você tente enviar e resolve esses dados na Base de Dados local.\n`;
}
