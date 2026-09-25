import type { NarrativeProfile } from "../domain/roteiro-contract";
import type { BaseDadosState, BaseDadosVideo } from "./types";
import { categoryLabel } from "./categories";

export const BASE_DATABASE_EXPORT_FORMAT = "NYMI_BASE_DATABASE_EXPORT_V2";

export type BaseDadosCharacterExport = {
  characterId: string;
  name: string;
  narrativeProfile?: NarrativeProfile;
};

export type BaseDadosVideoDraft = { description: string; sceneEndSeconds: string; firstGroupReactionSeconds?: string; firstGroupReactionSpeechCount?: string; secondGroupReactionSeconds?: string; secondGroupReactionSpeechCount?: string; additionalAiContext?: string; category?: string };

/** Mescla alterações ainda não confirmadas pelo autosave no snapshot exportado. */
export function mergeBaseDadosDrafts(database: BaseDadosState, drafts: Record<string, BaseDadosVideoDraft>) {
  return {
    ...database,
    videos: database.videos.map((video) => {
      const draft = drafts[video.id];
      if (!draft) return video;
      const sceneEndSeconds = Number(draft.sceneEndSeconds);
      if (!Number.isFinite(sceneEndSeconds) || sceneEndSeconds < 0) return video;
      const firstCount = draft.firstGroupReactionSpeechCount === undefined ? undefined : Number(draft.firstGroupReactionSpeechCount);
      const secondCount = draft.secondGroupReactionSpeechCount === undefined ? undefined : Number(draft.secondGroupReactionSpeechCount);
      const validFirstCount = typeof firstCount === "number" && Number.isInteger(firstCount) && firstCount >= 0 ? { firstGroupReactionSpeechCount: firstCount } : {};
      const validSecondCount = typeof secondCount === "number" && Number.isInteger(secondCount) && secondCount >= 0 ? { secondGroupReactionSpeechCount: secondCount } : {};
      if (draft.firstGroupReactionSeconds === undefined) return { ...video, description: draft.description, sceneEndSeconds, ...validFirstCount, ...validSecondCount, ...(draft.additionalAiContext === undefined ? {} : { additionalAiContext: draft.additionalAiContext }), ...(draft.category === undefined ? {} : { category: draft.category }) };
      const firstGroupReactionSeconds = Number(draft.firstGroupReactionSeconds);
      const secondGroupReactionSeconds = Number(draft.secondGroupReactionSeconds);
      return Number.isFinite(firstGroupReactionSeconds) && firstGroupReactionSeconds >= 0 ? { ...video, description: draft.description, sceneEndSeconds, firstGroupReactionSeconds, ...(Number.isFinite(secondGroupReactionSeconds) && secondGroupReactionSeconds >= 0 ? { secondGroupReactionSeconds } : {}), ...validFirstCount, ...validSecondCount, ...(draft.additionalAiContext === undefined ? {} : { additionalAiContext: draft.additionalAiContext }), ...(draft.category === undefined ? {} : { category: draft.category }) } : video;
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
    `TEMPO DA PRIMEIRA REAÇÃO EM GRUPO: ${formatSeconds(video.firstGroupReactionSeconds ?? 0)} segundos`,
    `QUANTIDADE DE FALAS DA PRIMEIRA REAÇÃO: ${video.firstGroupReactionSpeechCount ?? 0}`,
    `TEMPO DA SEGUNDA REAÇÃO EM GRUPO: ${formatSeconds(video.secondGroupReactionSeconds ?? 0)} segundos`,
    `QUANTIDADE DE FALAS DA SEGUNDA REAÇÃO: ${video.secondGroupReactionSpeechCount ?? 0}`,
    `CATEGORIA: ${categoryLabel(video.category)}`,
    "CONTEXTO ADICIONAL PARA IA:",
    video.additionalAiContext?.trim() || "Não informado.",
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
    "O tempo da primeira reação em grupo indica a partir de qual segundo a primeira reação coletiva pode começar; respeite-o quando houver reação em grupo.",
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
    `TEMPO QUE TERMINA A CENA DA DESCRIÇÃO: ${formatSeconds(video.sceneEndSeconds)} segundos`,
    `TEMPO DA PRIMEIRA REAÇÃO EM GRUPO: ${formatSeconds(video.firstGroupReactionSeconds ?? 0)} segundos`,
    `QUANTIDADE DE FALAS DA PRIMEIRA REAÇÃO: ${video.firstGroupReactionSpeechCount ?? 0}`,
    `TEMPO DA SEGUNDA REAÇÃO EM GRUPO: ${formatSeconds(video.secondGroupReactionSeconds ?? 0)} segundos`,
    `QUANTIDADE DE FALAS DA SEGUNDA REAÇÃO: ${video.secondGroupReactionSpeechCount ?? 0}`,
    `CATEGORIA: ${categoryLabel(video.category)}`,
    "CONTEXTO ADICIONAL PARA IA:",
    video.additionalAiContext?.trim() || "Não informado.",
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
  return `# Guia V6 — criar roteiro importável para o Nymi Gacha

> Versão do guia: V6. Este guia permite importar personagens novos, contexto geral, uma abertura antes do TikTok 01 e o texto em inglês de cada bloco. O pacote inclui todos os vídeos atualmente cadastrados na Base de dados no momento da exportação.

## Objetivo

Você receberá dados exportados da **Base de dados** com vídeos e personagens. Sua tarefa é escolher os vídeos úteis, organizar a ordem e criar falas e pensamentos curtos, naturais e coerentes. No final, retorne somente um JSON compatível com o botão **Importar roteiro da IA**, localizado na Base de dados.

## Fluxo recomendado em duas etapas

- **Dados simples:** podem ser enviados primeiro para planejamento criativo. Use as descrições e fichas para sugerir quais vídeos usar, a ordem e a estrutura narrativa. Nesta etapa, não é necessário gerar JSON.
- **Dados completos ou pacote completo:** depois que o planejamento for aprovado, use os IDs técnicos, tempos e referências deste documento para produzir o JSON final.
- Se este documento vier como **pacote completo**, ele já contém este guia e os dados completos. Não peça outro arquivo de instruções.
- Se o planejamento foi feito em outra mensagem ou arquivo, preserve-o e apenas faça a vinculação técnica no segundo passo; não crie uma história diferente sem motivo.

## Fonte de verdade e isolamento

- Use somente os dados presentes no TXT recebido nesta solicitação.
- O pacote completo contém todos os vídeos atuais da Base de dados; não assuma que a numeração termina em um valor fixo e não descarte vídeos válidos por aparecerem depois dos exemplos.
- Use os IDs exatos dos vídeos. Para personagens, reutilize um \`characterId\` listado ou crie um ID novo e único quando quiser que o Nymi crie esse personagem automaticamente.
- Um personagem novo precisa trazer \`characterId\`, \`name\` e \`model\` (\`feminino\` ou \`masculino\`). Inclua \`aliases\` e \`narrativeProfile\` completo para que ele seja utilizável no roteiro.
- Nunca use o ID de um personagem existente para representar outro personagem: IDs existentes reutilizam o personagem já salvo no app.
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

Esta orientação vale somente quando você estiver criando blocos novos a partir de uma descrição que ainda não contém roteiro. Para cada vídeo, calcule mentalmente:

\`janelaDeReacao = max(0, tempoTotalDoVideo - tempoQueTerminaACenaDaDescricao)\`

Use como limite superior aproximado:

- janela de 0 segundos: nenhum bloco;
- até 5 segundos: 1 ou 2 blocos;
- de 6 a 10 segundos: 2 a 4 blocos;
- de 11 a 20 segundos: 4 a 6 blocos;
- acima de 20 segundos: no máximo 8 blocos.

Esses números são referências de economia, não uma autorização para apagar conteúdo. Não crie blocos em excesso quando estiver gerando um roteiro novo somente a partir de descrição, mas não aplique essa orientação a conteúdo já escrito. Se o usuário fornecer falas, pensamentos ou blocos prontos, preserve todos exatamente como foram enviados, mesmo que ultrapassem essa referência. Nunca remova, resuma, combine, reordene ou substitua blocos fornecidos apenas para caber no orçamento. Se houver conteúdo pronto e também blocos vazios, preencha somente os vazios. Para conteúdo novo, não crie blocos artificiais apenas para fazer todos os personagens falarem.

## Integridade do roteiro recebido

- Diferencie sempre entre descrição de vídeo e roteiro já escrito.
- Se a entrada contiver blocos de fala ou pensamento, eles são conteúdo autoral do usuário e devem ser mantidos integralmente.
- O Guia V6 não exige reduzir a quantidade de blocos de um roteiro existente.
- Só faça alterações em blocos existentes se o usuário pedir explicitamente para revisar, melhorar, substituir ou reorganizar.
- Se o JSON estiver sendo montado a partir de um roteiro fornecido, copie cada bloco válido para o JSON e preserve seu personagem, tipo, texto e vínculo com o vídeo.

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

## Contexto geral e abertura

- \`generalContext\` é opcional e será colocado no campo de contexto geral do roteiro importado.
- \`opening\` é opcional e representa a cena antes do TikTok 01.
- A abertura aceita somente \`speech\` e \`thought\`, com \`characterId\` pertencente a \`characters\` e \`text\` preenchido.
- Não coloque \`videoId\` nos blocos da abertura. Ela não possui vídeo próprio.

Exemplo:

\`\`\`json
{
  "generalContext": "Os personagens foram reunidos para descobrir o que aconteceu com FYN.",
  "opening": {
    "blocks": [
      { "type": "speech", "characterId": "personagem-novo-01", "text": "Podemos começar." },
      { "type": "thought", "characterId": "personagem-novo-01", "text": "Espero que a gravação explique alguma coisa." }
    ]
  }
}
\`\`\`

## Campos do JSON

- \`format\`: sempre \`NYMI_IMPORTABLE_SCRIPT_V1\`.
- \`title\`: título do novo roteiro.
- \`videos\`: lista sem repetição, com \`videoId\` existente e \`order\` inteiro positivo.
- \`characters\`: personagens do roteiro. Podem ser existentes ou novos; personagens novos são criados automaticamente pelo app.
- \`name\`: nome do personagem novo.
- \`model\`: modelo visual do personagem novo: \`feminino\` ou \`masculino\`.
- \`aliases\`: nomes alternativos opcionais.
- \`narrativeProfile\`: ficha narrativa recomendada para personagens novos; ela será salva no contexto do roteiro.
- \`blocks\`: somente falas e pensamentos realmente necessários.
- \`characterId\`: personagem que fala ou pensa.
- \`videoId\`: vídeo ao qual a reação pertence.
- \`text\`: texto curto, preenchido e em português brasileiro.
- \`englishText\`: tradução correspondente em inglês, opcional. Quando presente, será importada no campo de inglês do mesmo bloco; não substitua nem traduza o campo \`text\`.
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

Esse exemplo é inválido porque repete o vídeo, não define os dados necessários de um personagem novo, usa um tipo proibido e começa antes do fim da descrição. Também é ruim gerar quinze blocos para um vídeo de 20 segundos cuja descrição termina no segundo 8 quando três ou quatro reações curtas seriam suficientes.

## Regra final

Planeje a seleção e o orçamento internamente, mas retorne somente o JSON final. Não inclua Markdown, títulos, análise, ficha do Criador, caminhos absolutos, duração alterada ou explicações fora do JSON.`;
}
