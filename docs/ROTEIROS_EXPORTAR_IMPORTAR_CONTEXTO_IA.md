# Plano — Exportar e importar contexto completo para IA externa

## 1. Objetivo

Criar um fluxo opcional para acelerar a produção de roteiros longos:

1. O usuário preenche a abertura, os vídeos e os contextos de vários TikToks.
2. O app exporta um único arquivo com todas as informações necessárias.
3. Uma IA externa lê o arquivo e cria falas, pensamentos e reações.
4. O usuário importa o arquivo preenchido.
5. O app coloca cada bloco no TikTok e no personagem corretos.

O módulo atual de Roteiros continua organizando os blocos. A animação, o tempo real dos balões e a montagem do vídeo pertencem ao futuro Video Nymi.

## 2. Diferença para “Preencher vazios”

### Geração interna atual

- Trabalha no TikTok selecionado.
- Usa descrição, objetivo, linha temporal e regras do TikTok atual.
- Usa o contexto geral e as regras locais do roteiro.
- Usa as fichas locais dos personagens ativos.
- Usa o histórico recente dos TikToks anteriores.
- Preenche os blocos vazios daquele TikTok.

### Novo fluxo externo

- Trabalha com abertura e vários TikToks de uma vez.
- Exporta o arco completo da história em um arquivo.
- Permite que a IA externa escolha a quantidade de blocos de cada TikTok.
- Permite continuidade entre TikTok 1, TikTok 2, TikTok 3 e os seguintes.
- Importa somente falas, pensamentos e reações.
- Não altera vídeos, descrições, tempos, regras, fichas ou ordem das cenas.

## 3. Arquivo único de contexto exportado

O botão **Exportar contexto** deve gerar um único documento de texto em Markdown, por exemplo:

~~~text
EXECUTE_E_GERE_JSON_<NOME_DO_ROTEIRO>.md
~~~

Esse documento de texto terá:

1. Dados estruturados do roteiro em seções legíveis.
2. Instruções explícitas para a IA externa.
3. Regra de duração e ritmo.
4. Contrato obrigatório da resposta.
5. Identificadores para o importador localizar cada TikTok e bloco.

O nome do arquivo e o início do conteúdo são comandos deliberados: a IA externa deve começar a executar imediatamente, sem perguntar o que fazer. Ela deve gerar e disponibilizar um arquivo baixável chamado `RESPOSTA_<scriptId>.json`. Se não puder anexar arquivos, deve retornar somente o JSON puro.

Ao final, o documento também deve conter uma seção com os dados estruturados completos em JSON para facilitar a conferência pela IA. Isso não muda o fato de que o arquivo enviado é um documento de texto.

Estrutura lógica principal do conteúdo:

~~~json
{
  "app": "GACHA_PREMIUM_ROTEIROS_AI_CONTEXT_V1",
  "schemaVersion": 1,
  "scriptId": "id-do-roteiro",
  "scriptTitle": "Nome do roteiro",
  "exportedAt": "2026-08-15T00:00:00.000Z",
  "instructions": {},
  "project": {},
  "characters": [],
  "rules": [],
  "opening": null,
  "tiktoks": [],
  "responseContract": {}
}
~~~

## 4. Informações incluídas

### Projeto

- ID e título do roteiro.
- Contexto geral.
- Duração total conhecida do projeto, quando disponível.
- Ordem oficial das cenas.
- Configurações relevantes para a geração.

### Personagens

Para cada personagem participante:

- characterId exato.
- Nome e gênero.
- Personalidade.
- História.
- Relação com FYN.
- Estilo de fala.
- Regras particulares.
- Relações com os demais personagens.

Devem ser usadas as fichas isoladas do roteiro atual, sem misturar fichas de outros roteiros.

### Regras

- Regras locais do roteiro.
- Regras estruturais protegidas.
- Preservação de ambiguidades e da linha temporal.
- Fala é audível e pensamento é privado.
- Os personagens reatores estão assistindo ao vídeo, e não dentro dele.
- Não inventar fatos, falas, motivos ou conhecimentos.
- Não inverter agressor e vítima.

### Abertura

Se existir, incluir:

- ID da abertura.
- Descrição.
- Objetivo.
- Regras específicas.
- Blocos existentes.

A abertura acontece antes dos TikToks. Este módulo apenas organiza blocos; ele não cria o tempo de animação.

### TikToks

Para cada TikTok, em ordem:

- sectionId exato.
- Índice e título.
- Caminho e metadados do vídeo.
- Duração do vídeo.
- Descrição literal.
- Segundo em que a descrição termina.
- Objetivo da cena.
- Linha temporal.
- Regras específicas.
- Instruções adicionais.
- Preferência por falas curtas.
- Blocos atuais e espaços vazios.

Exemplo:

~~~json
{
  "sectionId": "tiktok-001",
  "order": 1,
  "title": "O passado da FYN",
  "video": {
    "name": "tiktok-01.mp4",
    "storedPath": "...",
    "durationSeconds": 15
  },
  "description": "Descrição completa da cena.",
  "sceneEndSeconds": 7,
  "sceneGoal": "Mostrar a primeira reação dos personagens.",
  "timeline": "past",
  "specificRules": "Não revelar toda a verdade ainda.",
  "userInstruction": "Dar foco à desconfiança do Duque.",
  "existingBlocks": [],
  "emptySlots": []
}
~~~

## 5. Regra de duração e ritmo

O arquivo deve explicar que a duração é uma referência narrativa, não um limite de importação.

Instrução para a IA externa:

~~~text
As reações dos personagens começam depois da abertura e, em cada TikTok,
começam aproximadamente no segundo em que a descrição da cena termina.

Use no mínimo 3,2 segundos como referência para cada fala ou pensamento.
Escolha livremente a quantidade de blocos necessária para a cena.

O vídeo terminar não significa que as falas e pensamentos precisam terminar.
As reações podem ultrapassar a duração do vídeo e também ultrapassar a
duração total inicialmente prevista. Nunca corte ou reduza uma reação apenas
para caber no vídeo.

O app de Roteiros não controla a animação nem salva o tempo real de cada bloco.
Use os segundos apenas para estimar o ritmo, a quantidade e a continuidade
das reações. Retorne os blocos na ordem em que devem acontecer.
~~~

Exemplo:

- Vídeo com 15 segundos.
- Descrição termina no segundo 7.
- As reações começam aproximadamente no segundo 7.
- A IA escolhe 6 blocos.
- Cada fala ou pensamento tem referência mínima de 3,2 segundos.
- As reações podem continuar até aproximadamente o segundo 26.
- O resultado ainda deve ser importado mesmo ultrapassando os 15 segundos.

Não haverá bloqueio por duração nem descarte de blocos que ultrapassem o vídeo.

## 6. Quantidade de blocos

A IA externa escolhe a quantidade de blocos por cena.

Os espaços vazios são apenas referência. A IA poderá:

- devolver menos blocos;
- devolver a mesma quantidade;
- devolver mais blocos;
- criar uma sequência inteira quando o TikTok estiver sem blocos.

Na importação:

- blocos vazios existentes podem ser reutilizados;
- blocos excedentes são criados automaticamente;
- a ordem da IA é preservada;
- blocos preenchidos manualmente não são apagados sem confirmação explícita.

## 7. Formato do arquivo de resposta externa

A IA deve devolver somente um arquivo JSON válido com o resultado, mantendo os IDs necessários. O arquivo enviado para a IA é texto; somente o arquivo que volta para o app é JSON.

~~~json
{
  "app": "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1",
  "schemaVersion": 1,
  "sourceScriptId": "id-do-roteiro",
  "tiktoks": [
    {
      "sectionId": "tiktok-001",
      "blocks": [
        {
          "blockId": null,
          "characterId": "duque",
          "type": "speech",
          "emotion": "surpreso",
          "text": "Eu não esperava descobrir isso agora.",
          "englishText": ""
        },
        {
          "blockId": null,
          "characterId": "fyn",
          "type": "thought",
          "emotion": "desconfiada",
          "text": "Ele ainda está escondendo alguma coisa.",
          "englishText": ""
        }
      ]
    }
  ],
  "opening": {
    "sectionId": "opening-001",
    "blocks": []
  }
}
~~~

Campos:

- blockId: ID existente ou null para bloco novo.
- characterId: personagem participante.
- type: speech, thought ou silent.
- emotion: emoção, gesto ou tensão.
- text: texto em português.
- englishText: vazio por padrão; pode ser traduzido depois.

Para silent, text deve ser vazio e a reação deve ficar em emotion.

## 8. Importação segura

O botão **Importar contexto** funciona dentro de um roteiro aberto.

Validar obrigatoriamente:

- app reconhecido.
- schemaVersion compatível.
- sourceScriptId igual ao roteiro aberto.
- sectionId existente.
- characterId pertencente ao elenco.
- type válido.
- bloco silent sem texto.
- JSON válido.

Se o arquivo for de outro roteiro, bloquear a importação para evitar mistura de projetos.

O importador deve mostrar:

- TikToks processados.
- Blocos importados.
- Blocos novos criados.
- Blocos ignorados.
- Erros encontrados.
- IDs ou personagens inválidos.

A importação deve criar um backup antes de aplicar. Erro estrutural grave deve impedir aplicação parcial.

## 9. Interface

Adicionar próximos às funções de IA:

- **Preencher vazios** — geração interna do TikTok atual.
- **Exportar contexto** — exporta o JSON completo.
- **Importar contexto** — importa o resultado da IA externa.

Mostrar no painel:

- roteiro de origem;
- data da exportação;
- quantidade de TikToks;
- quantidade de personagens;
- status da última importação;
- quantidade de blocos aplicados.

## 10. Isolamento entre roteiros

O exportador deve usar somente:

- roteiro selecionado;
- aiContext local desse roteiro;
- personagens participantes;
- regras locais;
- abertura e TikToks do próprio roteiro.

Nunca incluir fichas, regras, blocos ou histórico de outro projeto.

## 11. Etapas de implementação

### Fase 1 — Contrato e exportação

- Criar o schema do contexto.
- Criar tipos de contexto exportado e resultado importado.
- Montar o exportador de um único documento Markdown/texto.
- Incluir instruções e contrato da resposta dentro do próprio arquivo.
- Incluir abertura, vídeos, duração, sceneEndSeconds, fichas e regras locais.

### Fase 2 — Importação

- Criar parser e validador.
- Validar roteiro, TikToks, personagens, tipos e IDs.
- Mapear por sectionId e blockId.
- Criar blocos excedentes.
- Preservar blocos manuais.
- Implementar relatório de importação.

### Fase 3 — Interface

- Adicionar os dois botões ao editor.
- Confirmar antes de substituir conteúdo manual.
- Mostrar progresso e resultado.
- Criar backup antes da aplicação.
- Permitir visualizar o arquivo antes da importação.

### Fase 4 — Testes

- Exportar com abertura e múltiplos TikToks.
- Exportar sem abertura.
- Exportar sem vídeo ou sem duração.
- Importar menos blocos que os espaços existentes.
- Importar mais blocos que os espaços existentes.
- Importar blocos para vários TikToks.
- Rejeitar arquivo de outro roteiro.
- Rejeitar personagem inexistente.
- Rejeitar sectionId inexistente.
- Confirmar que reações além da duração do vídeo não são descartadas.
- Confirmar que roteiros nunca compartilham contexto.

## 12. Fora do escopo inicial

Esta primeira versão não fará:

- animação dos personagens;
- keyframes;
- posição de balões;
- sincronização real por segundo;
- renderização de vídeo;
- corte ou extensão automática do vídeo;
- alteração automática da abertura;
- geração obrigatória do inglês.

O inglês pode permanecer vazio e ser produzido depois pelo recurso de tradução existente.

## 13. Critério de conclusão

O recurso estará concluído quando o usuário conseguir:

1. Preparar três ou mais TikToks sem blocos.
2. Exportar tudo em um único arquivo.
3. Enviar o arquivo para uma IA externa.
4. Receber quantidades diferentes de blocos por TikTok.
5. Importar o resultado no roteiro correto.
6. Ver cada reação no TikTok correspondente.
7. Aceitar reações que ultrapassem a duração do vídeo.
8. Preservar vídeos, descrições, regras, fichas e demais roteiros.
