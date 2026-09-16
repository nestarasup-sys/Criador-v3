# Testes de “Preencher vazios” — histórico de TikToks

**Data:** 16/09/2026  
**Branch:** `codex/test-roteiros-history-limit-5`  
**Commit de checkpoint:** `0ed8db2` (`chore: checkpoint antes de testes de contexto`)  
**Modelo:** `gpt-5.6-luna`  
**Modo:** criativo  
**Raciocínio:** alto  
**Presets selecionados em todos os três TikToks:** Romance + Ciúme  
**Limite configurado:** 5 TikToks anteriores

## Objetivo

Verificar se o ajuste “TikToks anteriores usados como contexto” realmente afeta o prompt do botão **Preencher vazios**, gerando os TikToks 1, 2 e 3 em sequência.

## Preparação e segurança

- A configuração estava em 4 e foi alterada para 5.
- Foi criado um backup manual de Roteiros antes do teste.
- O roteiro de origem foi duplicado para uma cópia de teste; o original permaneceu inalterado.
- A cópia ficou salva no app como **“TESTE — Histórico 5 — Romance + Ciúme — 16/09/2026”**.
- ID da cópia: `0972f656-2bd2-4d0e-84ba-28762b15bafb`.
- As gerações usaram o endpoint real do backend de Roteiros. A interface de desenvolvimento não iniciou por uma falha do runtime Vinext/Miniflare; portanto, o fluxo foi executado pelo backend em vez de clicar no botão pela tela.

## O que o limite envia

Não são apenas os nomes dos TikToks. Para cada seção anterior incluída, o backend monta contexto com:

- título;
- descrição do vídeo;
- linha temporal;
- até 12 reações anteriores, incluindo personagem, tipo (fala/pensamento), emoção e texto.

O arquivo de vídeo não é enviado. O limite é um máximo: com somente três TikToks, as chamadas têm 0, 1 e 2 seções anteriores, então este teste confirma a inclusão sequencial do histórico, mas não chega a exercitar o corte no limite de cinco.

## Resultados

### TikTok 1 — 5 blocos

1. **AYLA — fala / encantada:** “Varkas e eu formamos um belo par, exatamente como deveria ser.”
2. **VARKAS — fala / confuso:** “Então por que me associam a Thalia nessa comparação?”
3. **EDRICK — fala / desconcertado:** “Também não entendo por que Thalia e eu fomos comparados a vocês.”
4. **GARETH — fala / sarcástico:** “Talvez confundam proteção com compatibilidade, especialmente no caso de Thalia.”
5. **THALIA — pensamento / incomodada:** “Proteção não precisa parecer romance. Então por que essa comparação me incomoda?”

**Histórico anterior incluído:** nenhum, como esperado no primeiro TikTok.  
**Uso:** 4.255 tokens de entrada + 2.357 de saída = **6.612 tokens**.

### TikTok 2 — 6 blocos

1. **EDRICK — fala / surpreso:** “Ela era criança; como poderia suspeitar que aquele carinho fosse falso?”
2. **AYLA — fala / tensa:** “Talvez a cena esteja interpretando a relação de forma injusta.”
3. **VARKAS — fala / desconfortável:** “A idade dela torna essa descoberta especialmente cruel.”
4. **THALIA — fala / irritada:** “Parem de me analisar; eu não preciso da compaixão de ninguém.”
5. **GARETH — fala / indiferente:** “Compaixão? Apenas estão discutindo uma ingenuidade bastante óbvia.”
6. **THALIA — pensamento / ferida:** “Eles podem chamar de ingenuidade; não sabem o que aquela mentira significava.”

**Histórico anterior incluído:** descrição e reações do TikTok 1.  
**Uso:** 5.084 tokens de entrada + 1.372 de saída = **6.456 tokens**.

### TikTok 3 — 6 blocos

1. **EDRICK — fala / chocado:** “Ela chorava sozinha; como pôde ficar abandonada daquele jeito?”
2. **AYLA — fala / chocada:** “Eu nunca imaginei que a infância dela tivesse sido tão dolorosa.”
3. **VARKAS — fala / chocado:** “Aquela criança não deveria ter sido deixada sozinha.”
4. **THALIA — fala / irritada:** “Não transformem algumas imagens antigas em desculpa para me tratarem com pena.”
5. **EDRICK — fala / chocado:** “Pena não; isso parece uma ferida que ninguém quis enxergar.”
6. **GARETH — pensamento / desconfortável:** “Eu me lembro de tê-la machucado; por que essa visão ainda me incomoda?”

**Histórico anterior incluído:** descrições e reações dos TikToks 1 e 2.  
**Uso:** 5.815 tokens de entrada + 1.373 de saída = **7.188 tokens**.

## Conclusão do teste

- A função de histórico está ativa no caminho real de **Preencher vazios**.
- A sequência enviou o conteúdo produzido até então: o prompt do segundo TikTok continha a descrição e as reações do primeiro; o terceiro continha o histórico dos dois anteriores.
- A configuração 5 foi persistida no estado de Roteiros.
- Tokens acumulados na cópia: **20.256** (15.154 de entrada + 5.102 de saída).
- Romance e Ciúme foram enviados como direções narrativas nos três pedidos; são orientações, não exigência de que cada reação seja romântica ou ciumenta.
- O contexto de cada execução aumenta à medida que o histórico cresce; neste teste, o prompt do TikTok 3 foi maior que o do TikTok 2, que foi maior que o do TikTok 1.

## Observações para a próxima sessão

1. Continuar na branch `codex/test-roteiros-history-limit-5`.
2. A cópia de teste está no app; evitar regenerar seus blocos sem duplicá-la novamente ou limpar somente a cópia.
3. Para testar o limite máximo 5 de forma efetiva, usar pelo menos 7 TikToks sequenciais e observar que, a partir do sexto, entram apenas os cinco imediatamente anteriores.
4. A tela de Configurações v2 registra o prompt final, mas nesta rodada o snapshot da execução não mostrou `variables` nem uso por chamada; os tokens foram confirmados no acumulado do roteiro e nas respostas do backend.
5. O `npm run dev` falhou ao iniciar com `MiniflareCoreError [ERR_RUNTIME_FAILURE]`; vale investigar isso se o teste visual pela interface for necessário.

## Estado do Git

- A branch de teste foi criada a partir de `d905a71`.
- O checkpoint `0ed8db2` é um commit vazio intencional: havia somente assets de modelos já modificados/não rastreados, preservados e excluídos do commit.
- Não houve alterações nesses assets durante este teste.
