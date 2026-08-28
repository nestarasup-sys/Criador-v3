import type { NarrativeProfile } from "../domain/roteiro-contract";
import type { BaseDadosState, BaseDadosVideo } from "./types";

export const BASE_DATABASE_EXPORT_FORMAT = "NYMI_BASE_DATABASE_EXPORT_V2";

export type BaseDadosCharacterExport = {
  characterId: string;
  name: string;
  narrativeProfile?: NarrativeProfile;
};

export type BaseDadosVideoDraft = { description: string; sceneEndSeconds: string };

/** Mescla alterações ainda não confirmadas pelo autosave no snapshot exportado. */
export function mergeBaseDadosDrafts(database: BaseDadosState, drafts: Record<string, BaseDadosVideoDraft>) {
  return {
    ...database,
    videos: database.videos.map((video) => {
      const draft = drafts[video.id];
      if (!draft) return video;
      const sceneEndSeconds = Number(draft.sceneEndSeconds);
      return Number.isFinite(sceneEndSeconds) && sceneEndSeconds >= 0 ? { ...video, description: draft.description, sceneEndSeconds } : video;
    }),
  };
}

function formatSeconds(value: number) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "não calculado";
}

function absoluteVideoPath(video: BaseDadosVideo) {
  return video.absolutePath || "CAMINHO ABSOLUTO NÃO DISPONÍVEL";
}

function characterBlock(item: BaseDadosCharacterExport) {
  const profile = item.narrativeProfile;
  return [
    "PERSONAGEM",
    `ID: ${item.characterId}`,
    `NOME: ${item.name}`,
    "FICHA DO ROTEIROS (JSON):",
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
    `REFERÊNCIA CANÔNICA: ${video.id}`,
    `HASH SHA-256: ${video.contentHash || "não calculado"}`,
    `ARQUIVO LOCAL: ${video.fileAvailable === false ? "AUSENTE — não pode ser importado até ser restaurado" : "disponível"}`,
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

/** Exportação compacta para leitura rápida por uma IA ou revisão manual. */
export function buildBaseDadosSimpleExportText(
  database: BaseDadosState,
  characters: BaseDadosCharacterExport[],
  characterNames: Record<string, string> = {},
) {
  const videos = database.videos.map((video) => [
    `TIKTOK ${String(video.sequence).padStart(2, "0")}`,
    "DESCRIÇÃO:",
    video.description.trim() || "Não preenchida.",
  ].join("\n"));
  const narrativeProfile = (profile: NarrativeProfile | undefined) => profile ? {
    personality: profile.personality,
    backstory: profile.backstory,
    fynRelationship: profile.fynRelationship,
    speakingStyle: profile.speakingStyle,
    relationships: profile.relationships.map((relationship) => ({
      character: characterNames[relationship.targetCharacterId] || "Personagem relacionado",
      description: relationship.description,
    })),
    additionalRules: profile.additionalRules,
  } : null;
  const characterBlocks = characters.map((character, index) => [
    `PERSONAGEM ${index + 1}`,
    `NOME: ${character.name}`,
    "FICHA:",
    JSON.stringify(narrativeProfile(character.narrativeProfile), null, 2),
  ].join("\n"));
  return [...videos, ...characterBlocks].join("\n\n");
}

export function buildBaseDadosGuide() {
  return `# Guia operacional — criar roteiro importável para o Nymi Gacha

## Objetivo

Você receberá dados exportados da **Base de dados** com vídeos e personagens. Sua tarefa é escolher os vídeos úteis, organizar a ordem e criar falas e pensamentos curtos, naturais e coerentes. No final, retorne somente um JSON compatível com o botão **Importar roteiro da IA**, localizado na Base de dados.

## Fluxo recomendado em duas etapas

- **Dados simples:** podem ser enviados primeiro para planejamento criativo. Use as descrições e fichas para sugerir quais vídeos usar, a ordem e a estrutura narrativa. Nesta etapa, não é necessário gerar JSON.
- **Dados completos ou pacote completo:** depois que o planejamento for aprovado, use os IDs técnicos, tempos e referências deste documento para produzir o JSON final.
- Se este documento vier como **pacote completo**, ele já contém este guia e os dados completos. Não peça outro arquivo de instruções.
- Se o planejamento foi feito em outra mensagem ou arquivo, preserve-o e apenas faça a vinculação técnica no segundo passo; não crie uma história diferente sem motivo.

## Fonte de verdade e isolamento

- Use somente os dados presentes no TXT recebido nesta solicitação.
- Use os IDs exatos dos vídeos e personagens. Nunca invente IDs.
- A descrição do vídeo atual é a fonte principal do que pode acontecer naquela cena.
- A ficha narrativa serve para personalidade, história, relações, estilo de fala e regras do personagem. Ela não autoriza inventar acontecimentos, falas, motivos ou reações que não tenham relação com a descrição do vídeo atual.
- Cada vídeo é uma cena separada. Não misture a descrição, ações ou reações de um vídeo com outro.
- Caminho absoluto, duração total, descrição e fim da cena pertencem à Base de dados local. Não os reescreva nem tente substituí-los no JSON.

## Escolha e ordem dos vídeos

- Você pode escolher qualquer quantidade de vídeos, inclusive não usar vídeos que não ajudem a narrativa.
- Você pode reorganizar livremente a ordem usando \`order\`.
- Um mesmo vídeo pode aparecer no máximo uma vez.
- Não envie caminhos de arquivo, nomes de arquivo como referência ou duração inventada: use apenas \`videoId\`.

## Orçamento de falas e pensamentos

Não crie blocos em excesso. Para cada vídeo, calcule mentalmente:

\`janelaDeReacao = max(0, tempoTotalDoVideo - tempoQueTerminaACenaDaDescricao)\`

Use como limite superior aproximado:

- janela de 0 segundos: nenhum bloco;
- até 5 segundos: 1 ou 2 blocos;
- de 6 a 10 segundos: 2 a 4 blocos;
- de 11 a 20 segundos: 4 a 6 blocos;
- acima de 20 segundos: no máximo 8 blocos.

Esses números são limites, não metas. Prefira menos blocos quando a cena tiver pouca informação. Não preencha espaço vazio apenas para fazer todos os personagens falarem. Uma reação curta e boa é melhor que uma conversa longa e inventada.

## Tempo das reações

- Não gere fala nem pensamento antes do fim da cena descrita.
- Se a descrição termina no segundo 8, o primeiro bloco deve começar no segundo 8 ou depois.
- Se \`startAt\` for omitido, o app usará automaticamente o fim da cena.
- O tempo será contado em segundos desde o início do vídeo.
- O app preencherá localmente o campo \`sceneEndSeconds\`; não envie esse campo.
- O roteiro pode continuar com falas depois do fim da descrição, desde que ainda faça sentido dentro da cena.

## Qualidade do diálogo

- Cada bloco deve reagir a uma ação, detalhe ou consequência descrita no vídeo atual.
- Uma fala deve ter, de preferência, 4 a 16 palavras e no máximo duas frases curtas.
- Um pensamento deve ter, de preferência, 4 a 20 palavras e no máximo duas frases curtas.
- Nem todos os personagens precisam participar de cada vídeo.
- Não faça todos comentarem a mesma coisa com palavras diferentes.
- Não crie ciúme, culpa, medo, briga, revelação, romance ou tensão se isso não estiver sustentado pela descrição e pelas fichas.
- Não repita a descrição como narração; mostre uma reação àquilo que aconteceu.
- Não faça exposição longa da história do personagem.
- Fala é audível e pode ser respondida por outro personagem. Pensamento é privado e não pode ser respondido diretamente como se tivesse sido ouvido.
- Use somente \`speech\` e \`thought\`. Não use \`silent\`, narração, ação ou outros tipos.

## Abertura e conteúdo fora dos vídeos

O formato \`NYMI_IMPORTABLE_SCRIPT_V1\` cria os TikToks e seus blocos. Não inclua uma seção de abertura em Markdown, texto teatral, comentários ou explicações fora do JSON. Se uma abertura for necessária, ela será editada separadamente no app.

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
      "text": "Ela está bem?",
      "startAt": 8
    },
    {
      "type": "thought",
      "characterId": "personagem-01",
      "videoId": "video-01",
      "text": "Ela ainda faz isso.",
      "startAt": 11
    }
  ]
}
\`\`\`

## Campos do JSON

- \`format\`: sempre \`NYMI_IMPORTABLE_SCRIPT_V1\`.
- \`title\`: título do novo roteiro.
- \`videos\`: lista sem repetição, com \`videoId\` existente e \`order\` inteiro positivo.
- \`characters\`: somente personagens existentes no TXT, com \`characterId\` e função opcional.
- \`blocks\`: somente falas e pensamentos realmente necessários.
- \`characterId\`: personagem que fala ou pensa.
- \`videoId\`: vídeo ao qual a reação pertence.
- \`text\`: texto curto, preenchido e em português brasileiro.
- \`startAt\`: opcional; quando informado, deve ser um número não negativo e não pode ser anterior ao fim da descrição.

## Exemplos de respostas ruins

Não faça isto:

\`\`\`json
{
  "videos": [
    { "videoId": "video-01", "order": 1 },
    { "videoId": "video-01", "order": 2 }
  ],
  "blocks": [
    { "type": "silent", "characterId": "inventado", "videoId": "video-01", "text": "", "startAt": 2 }
  ]
}
\`\`\`

Esse exemplo é inválido porque repete o vídeo, inventa personagem, usa um tipo proibido e começa antes do fim da descrição. Também é ruim gerar quinze blocos para um vídeo de 20 segundos cuja descrição termina no segundo 8 quando três ou quatro reações curtas seriam suficientes.

## Regra final

Planeje a seleção e o orçamento internamente, mas retorne somente o JSON final. Não inclua Markdown, títulos, análise, ficha do Criador, caminhos absolutos, duração alterada ou explicações fora do JSON.`;
}
