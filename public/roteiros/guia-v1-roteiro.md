# Guia V1 — Roteiro de Reações

Este guia serve para usar o prompt do botão **Preencher vazios** fora do Nymi Gacha, em qualquer ferramenta de IA que aceite texto.

## Como usar

1. Copie este guia para a ferramenta de IA.
2. Substitua os campos entre `{{` e `}}` pelos dados reais.
3. Cole as descrições dos vídeos em `{{DESCRICOES_DOS_VIDEOS}}`.
4. Cole os personagens e suas fichas em `{{PERSONAGENS_E_FICHAS}}`.
5. Informe a quantidade desejada em `{{QUANTIDADE_DE_BLOCOS}}`.
6. Se já houver reações escritas, coloque-as em `{{BLOCOS_JA_EXISTENTES}}`.
7. Se não houver histórico ou instruções extras, escreva `Nenhum`.

O texto foi ajustado para responder diretamente no chat. Ele não pede arquivo JSON nem arquivo para download.

## Estrutura recomendada dos personagens

Para cada personagem, informe:

- nome;
- personalidade;
- história;
- relação com FYN;
- estilo de fala;
- regras particulares;
- relações com os demais personagens.

Use nomes consistentes durante todo o teste. Não troque o nome de um personagem entre a ficha, a descrição e o histórico.

## Prompt completo

```text
# PAPEL E OBJETIVO

Você escreve roteiros de reação para personagens fictícios.

Os personagens estão juntos em uma sala assistindo ao conteúdo apresentado. Eles não estão dentro da cena exibida.

Produza uma sequência de reações coerente, progressiva e destinada à leitura silenciosa, usando somente os dados fornecidos.

# REGRAS PROTEGIDAS

- Os personagens reatores estão juntos na sala assistindo ao conteúdo.
- Uma versão de um personagem mostrada no conteúdo é diferente do personagem presente na sala.
- Trate o conteúdo exibido como uma visão, representação ou bola de cristal, e não como uma gravação feita por alguém.
- Não invente câmera, filmagem, gravação, fotógrafo, autor, postagem, público ou medo de FYN ficar brava por ter sido filmada, a menos que isso esteja explicitamente confirmado.
- Falas são ouvidas.
- Pensamentos são privados e não podem receber resposta direta ou indireta baseada em informação que apareceu somente no pensamento.
- Cada bloco deve conter uma fala ou pensamento com texto.
- Suspeitas, ciúmes, medos, ironias e interpretações podem existir, mas devem permanecer claramente como hipóteses quando o contexto não confirmar algo.
- Preserve quem pratica e quem sofre cada ação.
- Não inverta agente, alvo, agressor ou vítima.
- Respeite a linha do tempo e o conhecimento disponível para cada personagem.
- Os blocos devem formar uma conversa contínua e progressiva, não uma lista de comentários independentes.
- Use personalidade, história, relações e estilo de fala sem recitar ou copiar a ficha do personagem.
- O texto deve funcionar visualmente no papel, sem depender de entonação, volume ou atuação vocal.
- Preserve a diferença entre fala e pensamento.
- Não produza narração, rubricas ou instruções de atuação dentro das reações.
- Não invente fatos, falas anteriores, ações, motivos ou conhecimentos ausentes dos dados.
- É permitido criar opiniões, dúvidas, provocações e interpretações coerentes com a personalidade.
- Personagens presentes podem se tratar diretamente pelo nome ou pela segunda pessoa.
- Não repita a mesma observação, posição emocional ou função dramática apenas trocando palavras.

# POLÍTICA NARRATIVA

Escreva uma sequência de reações destinada à leitura silenciosa.

Os blocos devem formar uma conversa contínua e progressiva, não uma lista de comentários independentes.

Cada novo bloco precisa acrescentar uma perspectiva, dúvida, provocação, contestação, defesa, revelação emocional ou mudança de tensão que ainda não tenha sido usada na sequência.

Escolha o participante com maior motivo narrativo para reagir naquele momento.

Não trate a ordem da lista de personagens como ordem obrigatória de fala.

Não force participação igual entre os personagens.

Evite repetir personagem, assunto, posição emocional e construção de frase quando houver alternativa coerente.

Os personagens podem discordar, provocar, debochar, desconfiar, defender, mentir, recuar ou interpretar uma situação incorretamente.

Quando o contexto não confirmar uma interpretação, escreva-a como suspeita, pergunta, receio ou opinião, nunca como fato estabelecido.

Quando houver um encerramento natural, considere terminar a sequência com um pensamento privado.

Esse pensamento pode:

- refletir sobre o que os outros disseram;
- revelar indignação;
- revelar raiva;
- demonstrar descrença;
- expressar desprezo;
- conter deboche;
- mostrar admiração;
- mostrar ciúme;
- revelar confusão;
- apresentar uma conclusão provisória;
- refletir sobre FYN;
- refletir sobre a situação;
- julgar duramente outro personagem.

A API pode escolher livremente a reação mais interessante e coerente com a personalidade, inclusive um pensamento considerando alguém um idiota, desde que isso permaneça como pensamento interno e não seja tratado como fato confirmado.

Não force um pensamento no final quando a sequência terminar melhor com uma fala.

O diálogo deve ser natural, claro e completo para leitura silenciosa, mas ainda escrito como fala ou pensamento, jamais como narração.

# TAREFA

Gere exatamente {{QUANTIDADE_DE_BLOCOS}} blocos de reação para o conteúdo descrito.

Preencha somente os blocos solicitados.

Não altere blocos que já possuem conteúdo, salvo se eles forem incluídos explicitamente na lista de blocos-alvo.

A ordem dos personagens deve ser escolhida por você conforme a lógica dramática da cena.

Não siga automaticamente a ordem em que os personagens aparecem na lista.

A conversa deve parecer uma sequência contínua: cada reação deve levar em conta o que já foi dito anteriormente.

# REGRAS DA CENA

- Os personagens estão assistindo ao conteúdo em uma sala.
- Eles não participaram da cena exibida.
- Eles não estão filmando ninguém.
- Não invente uma pessoa gravando o conteúdo.
- Não diga que FYN ficará brava por ter sido filmada.
- Não invente postagem, câmera, público ou descoberta de gravação.
- Trate o conteúdo como uma visão, representação ou imagem observada por eles.
- Os personagens podem interpretar errado o que veem, mas devem demonstrar dúvida, suspeita ou opinião quando não houver confirmação.
- Não faça todos reagirem da mesma forma.
- Não faça todos concordarem.
- Não obrigue todos os personagens a participar.
- Escolha livremente quem reage em cada bloco.
- Evite começar sempre pelo primeiro personagem da lista.
- Evite seguir uma sequência previsível.
- Varie quem inicia, quem interrompe, quem provoca e quem encerra.
- Preserve a personalidade, o estilo de fala e as relações de cada personagem.
- Não transforme toda reação em romance.
- Não transforme toda reação em briga.
- Use romance, ciúme, tensão, deboche, desconfiança, defesa ou conflito somente quando forem coerentes com os dados.
- Não crie fatos novos para provocar drama.
- Você pode criar interpretações, dúvidas, opiniões e suspeitas coerentes.
- Pensamentos não podem ser respondidos pelos outros personagens como se tivessem sido ouvidos.

# DADOS DOS PERSONAGENS E FICHAS

{{PERSONAGENS_E_FICHAS}}

# CONTEXTO GERAL DO ROTEIRO

{{CONTEXTO_GERAL}}

# DESCRIÇÕES DOS VÍDEOS OU CENAS

{{DESCRICOES_DOS_VIDEOS}}

# HISTÓRICO DE REAÇÕES ANTERIORES

{{HISTORICO_DE_REACOES}}

# BLOCOS JÁ EXISTENTES

{{BLOCOS_JA_EXISTENTES}}

# BLOCOS QUE DEVEM SER PREENCHIDOS

{{BLOCOS_ALVO}}

# INSTRUÇÕES ADICIONAIS DA CENA

{{INSTRUCOES_DA_CENA}}

# FORMATO DA RESPOSTA

Responda diretamente no chat.

Não gere arquivo.
Não use JSON.
Não use tabela.
Não inclua explicações antes ou depois das reações.
Não inclua análise do seu próprio resultado.

Organize exatamente assim:

BLOCO 1
Personagem: Nome exato do personagem
Tipo: speech ou thought
Emoção: emoção curta
Texto: reação completa

BLOCO 2
Personagem: Nome exato do personagem
Tipo: speech ou thought
Emoção: emoção curta
Texto: reação completa

Continue até completar exatamente {{QUANTIDADE_DE_BLOCOS}} blocos.

# REGRAS FINAIS DE FORMATAÇÃO

- Use os nomes dos personagens exatamente como aparecem nas fichas.
- Não invente personagens.
- Não invente IDs.
- Não repita a mesma ideia apenas trocando palavras.
- A ordem das reações deve ser escolhida livremente pela lógica dramática.
- Não siga automaticamente a ordem da lista de personagens.
- Pensamentos são privados e não podem ser respondidos pelos outros.
- Falas são ouvidas pelos personagens presentes.
- Use “speech” somente para falas audíveis.
- Use “thought” somente para pensamentos privados.
- Não escreva narração.
- Não escreva instruções de atuação.
- Não coloque ações de câmera.
- Não coloque descrições de filmagem.
- Não coloque comentários fora dos blocos.
- Entregue somente os blocos de reação.
```

## Exemplo de preenchimento

No lugar dos campos, use algo como:

```text
{{QUANTIDADE_DE_BLOCOS}} = 6

{{CONTEXTO_GERAL}} = Cinco personagens estão reunidos na sala. Eles têm relações tensas e não confiam uns nos outros.

{{DESCRICOES_DOS_VIDEOS}} = Vídeo 01: FYN atravessa uma praça e para para conversar com um homem desconhecido.

{{HISTORICO_DE_REACOES}} = Nenhum. Esta é a primeira reação.

{{BLOCOS_JA_EXISTENTES}} = Nenhum. Todos os blocos estão vazios.

{{BLOCOS_ALVO}} = Blocos 1, 2, 3, 4, 5 e 6.

{{INSTRUCOES_DA_CENA}} = Priorize tensão, ciúme e interpretações diferentes. Não transforme suspeitas em fatos.
```
