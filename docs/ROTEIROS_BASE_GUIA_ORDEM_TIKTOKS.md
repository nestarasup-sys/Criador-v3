# Plano executável — Base, guia e direção editorial dos TikToks

## Objetivo

Evoluir os botões `Exportar base`, `Importar base pronta` e adicionar `Exportar guia` para que uma IA externa consiga:

- gerar falas e pensamentos usando as descrições dos vídeos;
- calcular uma quantidade coerente de blocos com base na duração de cada vídeo;
- manter as fichas e regras isoladas no roteiro selecionado;
- sugerir ou reorganizar a ordem dos TikToks quando isso melhorar a narrativa;
- devolver alterações estruturais com prévia, validação, backup e desfazer.

O arquivo de base deve continuar sendo específico de um roteiro. O guia deve ser separado e reutilizável em outros roteiros.

## Decisão editorial principal

A IA poderá propor que um TikTok seja movido para outra posição. Por exemplo:

```text
Ordem atual:  TikTok 1 → TikTok 2 → TikTok 3 → TikTok 4 → TikTok 5
Nova ordem:   TikTok 1 → TikTok 4 → TikTok 2 → TikTok 5 → TikTok 3
```

A IA deve explicar brevemente o motivo de cada mudança, mas nunca poderá perder ou recriar um TikTok por causa da reorganização.

A abertura permanece fixa antes dos TikToks. Os IDs originais continuam sendo a referência; o número exibido na tela é apenas a posição atual.

## Escopo das alterações permitidas pela IA

### Permitido na primeira versão

- reorganizar TikToks;
- sugerir uma nova ordem completa;
- alterar falas e pensamentos;
- criar novos blocos;
- preencher blocos vazios;
- manter blocos manuais existentes;
- informar o motivo editorial da nova ordem;
- indicar quais TikToks parecem funcionar melhor como abertura, transição, clímax ou encerramento.

### Protegido por padrão

- IDs dos TikToks;
- IDs dos personagens;
- arquivos de vídeo e caminhos locais;
- fichas dos personagens;
- regras do roteiro;
- abertura;
- TikToks marcados pelo usuário como `posição fixa`;
- ordem de blocos dentro de cada TikTok, quando houver blocos manuais protegidos.

Alterar títulos ou descrições dos vídeos deve ser uma opção futura e separada. Na primeira implementação, a IA usa esses dados como contexto, mas não os modifica silenciosamente.

## Modelo de duração e quantidade de blocos

Para cada TikTok, exportar os seguintes valores calculados:

```json
{
  "durationSeconds": 20,
  "reactionStartSeconds": 10,
  "reactionWindowSeconds": 10,
  "minimumBlockSeconds": 3.2,
  "recommendedBlockCount": 4,
  "recommendedBlockRange": {
    "min": 3,
    "max": 5
  },
  "allowPostVideoContinuation": true
}
```

Regras:

```text
reactionStartSeconds = sceneEndSeconds
reactionWindowSeconds = max(0, durationSeconds - reactionStartSeconds)
recommendedBlockCount = ceil(reactionWindowSeconds / minimumBlockSeconds)
```

Se a duração ou o início das reações não forem conhecidos, a IA deve usar a descrição e produzir poucos blocos, sem inventar uma duração precisa.

A continuação depois do vídeo continua permitida, mas não deve ser usada como justificativa para gerar muitos blocos. O padrão é gerar apenas o necessário para cobrir a cena.

## Botões e responsabilidades

### Exportar base

Gera um arquivo executável, específico do roteiro:

```text
EXECUTE_E_GERE_JSON_<ROTEIRO>.md
```

Deve conter:

- identificação do roteiro;
- fichas locais dos personagens participantes;
- regras locais;
- contexto geral;
- abertura;
- TikToks em ordem atual;
- descrição, vídeo e duração de cada TikTok;
- início das falas/pensamentos;
- cálculo de blocos recomendado;
- indicação de TikToks fixos;
- liberdade editorial habilitada;
- IDs originais;
- contrato obrigatório de resposta JSON.

O arquivo deve instruir a IA a gerar falas, pensamentos e, opcionalmente, uma proposta de reorganização.

### Exportar guia

Gera um arquivo separado e reutilizável:

```text
GUIA_DE_GERACAO_E_EDICAO_DE_ROTEIROS_NYMI.md
```

O guia não deve carregar fichas, descrições ou dados de um roteiro específico. Ele deve explicar:

- estrutura dos arquivos;
- significado de cada campo;
- diferença entre fala e pensamento;
- cálculo de duração;
- política de quantidade de blocos;
- regras de continuidade;
- como propor uma nova ordem de TikToks;
- formato das operações editoriais;
- exemplos válidos e inválidos;
- contrato de resposta JSON.

### Importar base pronta

O importador deve reconhecer duas partes independentes:

1. blocos de falas e pensamentos;
2. operações editoriais, como reorganização de TikToks.

As duas partes devem aparecer separadas na prévia para o usuário poder aplicar uma e rejeitar a outra.

## Contrato de reorganização

Adicionar ao JSON de resposta um campo opcional:

```json
{
  "orderingProposal": {
    "mode": "suggest",
    "reason": "A reação do TikTok 5 funciona melhor depois da revelação do TikTok 2.",
    "orderedSectionIds": [
      "tiktok-1-id",
      "tiktok-4-id",
      "tiktok-2-id",
      "tiktok-5-id",
      "tiktok-3-id"
    ],
    "changes": [
      {
        "sectionId": "tiktok-5-id",
        "fromPosition": 5,
        "toPosition": 4,
        "reason": "Funciona melhor como consequência da revelação anterior."
      }
    ]
  }
}
```

Modos possíveis:

- `suggest`: apenas mostra a proposta;
- `apply`: permite aplicar depois da confirmação do usuário;
- `none`: não reorganiza os TikToks.

Por segurança, o aplicativo deve aceitar inicialmente apenas `suggest`, mesmo que a IA envie `apply`. A aplicação só acontece depois da confirmação visual.

## Validação obrigatória da ordem

Antes de mostrar a prévia:

- todos os IDs atuais devem aparecer exatamente uma vez;
- nenhum ID desconhecido pode ser aceito;
- a abertura não pode aparecer na lista de TikToks;
- TikToks fixos não podem mudar de posição;
- vídeos, descrições e blocos devem continuar ligados ao mesmo `sectionId`;
- uma ordem inválida deve ser rejeitada sem alterar o roteiro.

Se apenas parte da ordem for enviada, o sistema deve rejeitar a proposta ou completar somente quando a regra estiver explicitamente documentada. A primeira versão deve exigir a lista completa para evitar ambiguidades.

## Prévia visual da reorganização

Mostrar uma caixa separada no importador:

```text
ORDEM ATUAL
1. TikTok 1 — apresentação
2. TikTok 2 — descoberta
3. TikTok 3 — reação
4. TikTok 4 — conflito
5. TikTok 5 — encerramento

ORDEM PROPOSTA PELA IA
1. TikTok 1 — apresentação
2. TikTok 4 — conflito
3. TikTok 2 — descoberta
4. TikTok 5 — encerramento
5. TikTok 3 — reação
```

Cada alteração deve apresentar:

- posição anterior;
- nova posição;
- título do TikTok;
- motivo informado pela IA;
- indicação de posição fixa, quando aplicável.

Botões:

- `Aplicar falas/pensamentos`;
- `Aplicar nova ordem`;
- `Aplicar tudo`;
- `Cancelar alterações`.

Qualquer aplicação deve criar backup automático e entrar no histórico de desfazer.

## Controles recomendados no editor

Adicionar em cada TikTok:

- `Fixar posição`;
- `Permitir reorganização pela IA`;
- `Modo de geração: automático, compacto, normal ou estendido`;
- `Duração do vídeo`;
- `Início das falas/pensamentos`;
- `Blocos recomendados`.

No roteiro, adicionar uma configuração geral:

```text
Liberdade editorial da IA:
[ ] Somente gerar falas e pensamentos
[x] Pode sugerir nova ordem dos TikToks
[ ] Pode aplicar ordem automaticamente após confirmação
```

O padrão recomendado é permitir sugestão, mas exigir confirmação para aplicar.

## Fluxo completo da IA externa

1. O usuário preenche as descrições, vídeos e tempos de cada TikTok.
2. O usuário fixa os TikToks que não podem mudar de posição.
3. O usuário exporta a base do roteiro.
4. O usuário exporta o guia separado, se necessário.
5. A IA analisa fichas, regras, descrições e continuidade.
6. A IA calcula a quantidade recomendada de blocos para cada TikTok.
7. A IA gera falas e pensamentos.
8. A IA pode sugerir uma nova ordem usando os IDs originais.
9. O usuário importa o JSON.
10. O app valida IDs, blocos, personagens e ordem.
11. O app mostra prévia separada de blocos e reorganização.
12. O usuário escolhe aplicar falas, ordem ou ambos.
13. O app cria backup e registra a alteração no histórico.

## Fases de implementação

### Fase 1 — Dados de tempo e orçamento de blocos

- manter compatibilidade com `sceneEndSeconds`;
- exportar `reactionStartSeconds`;
- calcular janela de reação;
- calcular faixa recomendada de blocos;
- exibir avisos para dados ausentes ou inválidos;
- atualizar as instruções da base executável.

### Fase 2 — Exportar guia

- criar gerador de Markdown versionado;
- adicionar botão `Exportar guia`;
- separar regras gerais dos dados do roteiro;
- documentar fala, pensamento, duração, IDs e ordem;
- incluir exemplos de resposta.

### Fase 3 — Liberdade editorial e posições fixas

- adicionar `orderLocked` ou equivalente por TikTok;
- adicionar configuração de liberdade editorial;
- exportar ordem atual e posições fixas;
- instruir a IA a sugerir mudanças sem destruir dados.

### Fase 4 — Contrato de reorganização

- adicionar `orderingProposal` ao JSON;
- validar lista completa de IDs;
- detectar IDs duplicados ou desconhecidos;
- impedir alteração da abertura;
- preservar vídeos e dados pelo ID, nunca pelo índice.

### Fase 5 — Prévia e aplicação separada

- comparar ordem atual e proposta;
- mostrar justificativas;
- permitir aplicar somente blocos;
- permitir aplicar somente a ordem;
- permitir aplicar tudo;
- criar backup antes de qualquer aplicação;
- integrar com undo/redo.

### Fase 6 — Testes e segurança

Testar:

- TikTok 2 trocado com TikTok 5;
- vários TikToks movidos ao mesmo tempo;
- TikTok fixado sendo movido pela IA;
- ID desconhecido;
- ID duplicado;
- TikTok removido depois da exportação;
- vídeos preservados após a reorganização;
- blocos manuais preservados;
- abertura sempre mantida antes dos TikToks;
- importação de JSON antigo sem `orderingProposal`;
- backup e desfazer após aplicar nova ordem.

## Critérios de conclusão

O plano estará concluído quando:

- a IA conseguir receber duração e início das reações de cada TikTok;
- a quantidade de blocos ficar proporcional ao tempo disponível;
- `Exportar guia` gerar um documento independente;
- a IA conseguir sugerir uma nova ordem por IDs;
- o usuário visualizar a diferença entre ordem atual e proposta;
- a ordem puder ser aplicada sem perder vídeos, fichas ou blocos;
- posições fixas forem respeitadas;
- qualquer erro de validação impedir alterações parciais;
- todo o fluxo possuir backup, undo/redo e testes automatizados.

## Recomendação final

Começar pelas Fases 1 e 2. Depois implementar a sugestão de ordem na Fase 3, mantendo a aplicação manual até o fluxo estar bem testado. A IA pode ter liberdade para pensar como editora, mas o aplicativo deve continuar sendo o responsável por validar IDs, preservar dados e confirmar mudanças estruturais.
