# Investigação definitiva — encerramento do bug de exportação PNG de personagens

**Data da rodada:** 29/08/2026  
**Escopo:** Criador, exportação PNG única, exportação de variantes, Roteiros e renderer de personagens do Studio.  
**Caso principal:** Cronista Real - Iris Bellamy · POSE 1 · expressão `serio`/`serio_talk`.  
**Ambiente de validação:** aplicação web local, navegador Chromium/Playwright isolado e dados copiados para diretório temporário. Os assets manuais dos modelos 8, 9, 10 e 11 do usuário não foram incluídos em commits.

## Resultado executivo

O defeito principal foi encontrado e comprovado no asset, antes da exportação:

1. Os PNGs `serio.png`, `serio_talk.png` e outras expressões do pacote `modelo-4` tinham uma janela transparente na região do pescoço.
2. O cabelo traseiro era desenhado corretamente atrás do corpo.
3. Como o corpo estava transparente exatamente nessa janela, o cabelo atrás continuava visível por composição `source-over`. Isso parecia cabelo atravessando o corpo/roupa, mas não era um `drawImage` posterior nem uma inversão de z-order.
4. O PNG exportado estava reproduzindo fielmente o canvas. A prévia e o PNG não divergiam no canvas real.
5. A correção definitiva foi reparar somente os pixels faltantes da região do pescoço dos assets de expressão, usando o frame `*_blink.png` correspondente como referência. A correção foi registrada em `110d89f`.
6. Também foram alinhados os contextos de qualidade do renderer do Criador com os do renderer compartilhado do Studio. Isso eliminou uma divergência grande de rasterização entre os dois caminhos; a diferença residual é pequena, fora do pescoço e classificada como dívida técnica/paridade, não como a causa do bug.

Conclusão: o bug de pescoço da Iris foi **BUG CONFIRMADO, corrigido e protegido por teste de regressão**. A única comparação que não pôde ser feita diretamente foi com o arquivo externo em `D:\EDITOR WEB 2\...`, porque esse caminho não existe neste ambiente. Foi preparada uma ferramenta portátil para essa última conferência no computador do usuário.

## 1. Última etapa correta e primeira etapa incorreta

### Última etapa correta

O asset de referência `serio_blink.png` possui pixels de pele cobrindo a área do pescoço. A seleção de `backHair`, o ajuste da transformação, a criação dos canvases e a ordem lógica das camadas estavam corretos.

### Primeira etapa incorreta

Ao carregar o asset original `serio.png`, alguns pixels da região do pescoço tinham alpha zero. Quando o renderer desenhava o `backHair`, esses pixels recebiam a cor do cabelo. Em seguida, o corpo com alpha zero nesses mesmos pontos não tinha conteúdo opaco para cobri-los.

### Operação que introduzia o problema

Com o corpo antigo, em `(955,330)`:

```text
backHair local aproximado: (190,184)
backHair:       [21, 20, 20, 253]
body-serio:     [0, 0, 0, 0]
após body:      [21, 20, 20, 253]
```

Em `(980,340)`:

```text
backHair:       [9, 9, 8, 253]
body-serio:     [0, 0, 0, 0]
após body:      [9, 9, 8, 253]
```

Esses pixels não foram criados pelo exportador. Eles foram preservados porque a camada superior estava transparente.

Após o reparo:

```text
body-serio em (955,330): [252, 237, 229, 255]
final após body:         [252, 237, 229, 255]

body-serio em (980,340): [252, 237, 229, 255]
final após body:         [252, 237, 229, 255]
```

O ponto `(950,345)` permaneceu transparente por estar na borda/abaixo da área reparada; isso é contorno/alpha de borda esperado, não a janela de pescoço que causava o bloco.

## 2. Inventário das alterações da investigação

| Commit | Classificação | Alteração | Evidência/efeito |
|---|---|---|---|
| `4e9388b` | Correção confirmada | Mantém cabelo traseiro atrás da roupa | Ordem necessária e compatível com a composição esperada. |
| `04b7427` | Correção confirmada | Achata camadas com ordem explícita | Reforçou `backHair → body → roupa → rosto → frontHair`. |
| `1ea7f40` | Correção confirmada | Estabiliza exportação de variantes | Reduziu dependência de estado mutável entre variantes. |
| `04c961a` | Correção confirmada | Alinha camadas nas exportações de personagens | Corrigiu o caminho de exportação que divergia da prévia. |
| `101da83`, `db209f3`, `171ace3` | Instrumentação/defesa | Logs e limites do ciclo de render | Não alteram o fluxo normal. |
| `5a3d4f6`, `04b9c06`, `b42f11d` | Instrumentação | Snapshots intermediários do compositor | Permitiram localizar a primeira etapa problemática. |
| `235de96` | Instrumentação | Diagnóstico de alpha/pixels dos assets | Demonstrou a existência de pixels verdes e, principalmente, ausência de RGB oculto nos pixels totalmente transparentes. |
| `e5408b7` | Teste/ferramenta | Comparador portátil de PNG | Permite comparar dois arquivos no ambiente externo. |
| `7f6b8e3` | Instrumentação | Identidade de modelo/expressão no diagnóstico | Evita atribuir asset de outro pacote. |
| `b0f4a8d` | Proteção defensiva | Evita render com estado antigo | Descartou stale state como causa do caso atual e protege callbacks. |
| `7823f49` | Proteção defensiva | Defaults reais nas dependências de render | Reduziu divergência de fallback entre caminhos. |
| `91dfa0e` | Regressão | Teste de cobertura do pescoço | Detecta novamente a janela transparente em expressões head-only. |
| `110d89f` | **Correção confirmada** | Repara pixels faltantes do pescoço em 13 PNGs do `modelo-4` | Eliminou `missingPixels` em todas as 14 expressões verificadas. `raiva.png` não precisou ser alterado porque já estava coberto. |
| `c9fe892`, `e1c9648` | Instrumentação/debug | Eventos, snapshots e canvas final | Debug condicionado; não interfere no fluxo normal. |
| `17c0696` | Instrumentação/debug | Modo de identidade de layers por cores | Debug condicionado por URL; não altera assets. |
| `a6cc0a9` | Correção de paridade | Configura qualidade nos canvases mascarados do Criador | Alinha rasterização das camadas intermediárias. |
| `7eb6dac` | Correção de paridade | Configura qualidade no canvas final do Criador | Reduziu divergência do canvas final com o Studio. |
| `329056b` | Correção de paridade | Configura qualidade nos canvases de cena/corpo do Criador | Removeu diferença grande de smoothing entre os renderers. |
| `3aff8d4` | Regressão | Teste de determinismo com 50 exports | 50 saídas iguais no mesmo input. |
| `2304f4b` | Regressão | Teste de não-contaminação entre personagens | Iris → outro personagem → Iris manteve o mesmo hash. |

Não ficou experimento de cor artificial, remoção de layer, RGB zerado ou smoothing desligado no fluxo normal. O debug de cores permanece apenas atrás de `characterRenderLayers=1`.

## 3. Matriz definitiva de hipóteses

| Hipótese | Resultado | Evidência |
|---|---|---|
| H1 — ordem incorreta das camadas | **DESCARTADA como causa** | Ordem explícita correta e snapshots mostram `backHair` antes do corpo. |
| H2 — `backHair` desenhado duas vezes | **DESCARTADA** | Busca e eventos mostram uma única etapa `backHairDone`; modo de cores não revelou segunda camada no centro do pescoço. |
| H3 — `globalCompositeOperation` vazando | **DESCARTADA como causa** | Compositor reseta `source-over` e usa `save/restore`; nenhuma operação posterior redesenha o cabelo. |
| H4 — `globalAlpha` vazando | **DESCARTADA como causa** | Compositor reseta `globalAlpha=1` e os snapshots reproduzem o problema somente quando o corpo é transparente. |
| H5 — transformação vazando | **DESCARTADA como causa** | Canvases de layers são isolados e o pixel tracing coincide com a transformação esperada do cabelo. |
| H6 — `clip()` persistente | **DESCARTADA no caso** | O caminho principal do personagem não usa `clip()`; os usos de diagnóstico ficam em contexto controlado. |
| H7 — canvas não limpo | **DESCARTADA como causa** | Os canvases de render são novos; a limpeza da UI é separada e não produz o bloco localizado. |
| H8 — máscara errada | **DESCARTADA como causa principal** | Máscaras atuam em canvases isolados; não explicam a ausência de pixels no asset de expressão. Permanece risco defensivo no contexto de máscara do Studio. |
| H9 — pixels verdes existentes nos assets | **CONFIRMADA como fato, descartada como causa do pescoço** | Há pixels esverdeados em cabelo/roupa, mas eles não correspondem à origem do bloco e não há RGB não-zero em alpha zero. |
| H10 — halo de alpha/resampling | **DESCARTADA como causa principal** | O defeito já aparece em composição 1:1 sem depender de interpolação; o corpo antigo tinha alpha zero no ponto exato. |
| H11 — preview DOM diferente do canvas | **CONFIRMADA para a representação visual** | O screenshot DOM inclui checkerboard, controles, zoom e label; não é o canvas bruto. O canvas real e o PNG coincidem. |
| H12 — Criador e Roteiros divergem | **CONFIRMADA como dívida/paridade, não causa principal** | Criador tem composição própria; Roteiros usa `renderStudioCharacter`. Diferença atual de 760 pixels é residual, fora do pescoço. |
| H13 — stale state | **DESCARTADA como causa atual** | Guard de estado e teste de 50 renders/interferência não mostram divergência. |
| H14 — race condition | **DESCARTADA como causa atual** | Outputs determinísticos e canvases novos por render; variantes são serializadas. |
| H15 — canvas compartilhado | **DESCARTADA** | Não existe singleton de canvas; cada render cria seus próprios canvases. |
| H16 — cache incorreto | **DESCARTADA como causa atual** | Cache de chroma usa URL completa/versionada; erro invalida entrada. Testes de cache passaram. |
| H17 — bundle antigo | **DESCARTADA no build validado** | Build foi refeito e smoke/E2E passaram no bundle atual. |
| H18 — arquivo sobrescrito depois | **DESCARTADA no pipeline local** | Exportação chama `toBlob` diretamente e não há rotina posterior local que recomponha o PNG. O arquivo externo do usuário não está acessível para confirmação. |
| H19 — processamento externo modifica PNG | **DESCARTADA no app** | Não há etapa `sharp`/`jimp`/node-canvas posterior no fluxo web analisado. |
| H20 — metadata interna de modelo inconsistente | **RISCO CONFIRMADO, não causa do caso** | `modelo-4/model.json` declara internamente `modelo-7`, mas o servidor resolve pelo diretório. Deve ser tratado como risco de integridade de dados. |
| H21 — aquecimento do Ollama no Studio | **COMPORTAMENTO ADJACENTE CONFIRMADO, não relacionado** | `/studio/ai/warmup` pode responder 400 e é capturado sem bloquear o render; não altera PNG do personagem. |

## 4. Proveniência objetiva dos pixels

### Região do problema

A região auditada pelo teste é `left=940`, `top=321`, `width=46`, `height=21`, em coordenadas do canvas de 1920×1080. Ela corresponde ao encaixe do pescoço do pacote head-only do modelo 4.

O cabelo traseiro da Iris usa a transformação final aproximada `x=-16,7`, `y=129`, `size=377×535`, com imagem posicionada em `left=764,8`, `top=146,5`.

### Amostras

| Coordenada | Asset antigo do corpo | backHair transformado | Após desenhar backHair | Após desenhar corpo antigo | Corpo reparado | Resultado reparado |
|---|---|---|---|---|---|---|
| `(955,330)` | `[0,0,0,0]` | `[21,20,20,253]` | `[21,20,20,253]` | `[21,20,20,253]` | `[252,237,229,255]` | `[252,237,229,255]` |
| `(980,340)` | `[0,0,0,0]` | `[9,9,8,253]` | `[9,9,8,253]` | `[9,9,8,253]` | `[252,237,229,255]` | `[252,237,229,255]` |
| `(950,345)` | transparente de borda | cabelo/contorno de borda | preservado | preservado | fora da janela de reparo | comportamento de borda esperado |
| `(975,345)` | alpha parcial de borda | cabelo parcial | mistura de borda | mistura de borda | não é o centro da janela ausente | não classificado como bloco do pescoço |

O teste fatal de identidade das layers confirmou ainda que:

- `backHair` colorido artificialmente de magenta aparece somente nas mechas laterais;
- o centro da região problemática não vira magenta;
- ao remover `backHair`, a região central continua sendo formada por corpo/roupa;
- a região central que antes parecia cabelo desaparece quando o body asset é reparado.

Portanto, a origem dos pixels problemáticos no caso principal é: **ausência de pixels opacos no asset de expressão do corpo, permitindo que o backHair legítimo atrás permaneça visível**.

## 5. Auditoria dos assets da Iris

Relatório gerado em:

`C:\Users\luiz\AppData\Local\Temp\nymi-render-evidence-8b4275bc87814e7b815fbe9e762bbfde\asset-analysis\report.json`

Máscaras diagnósticas:

- `...\asset-analysis\backhair-green-pixels.png`
- `...\asset-analysis\fronthair-green-pixels.png`
- `...\asset-analysis\clothes-green-pixels.png`

| Asset | Dimensão | SHA-256 | Visíveis | Alpha parcial | alpha=0 com RGB | Verdes | BBox verdes | alpha verde min/máx/médio |
|---|---:|---|---:|---:|---:|---:|---|---|
| `body-serio.png` | 1920×1080 | `f4bc21708d9ea33213da2730fbc0594fbd781b2e91027aa70b68b3624814b520` | 52836 | 3659 | 0 | 0 | — | — |
| `body-serio-blink.png` | 1920×1080 | `011442a5632709e2f6f1c4bb25bd8c597578d7966950526fccc1a6b0772730ab` | 52980 | 3465 | 0 | 0 | — | — |
| `body-serio-talk.png` | 1920×1080 | `fc61f9ecbbb31865b5715f1924f2bc629a9cc397736df352b6fd9d8392fa4d43` | 52898 | 3504 | 0 | 0 | — | — |
| `backHair` | 377×535 | `8ba56cfcf22b81f76968bc67dca140b505a609218a82d3f851ae4eb4080adacd` | 79607 | 79418 | 0 | 1966 | x36..340/y101..429 | 6/255/241,175 |
| `frontHair` | 377×535 | `46e7aae03e59b7d163bd6a60075bb2747497b5c10bb82d554c480f1d150ece91` | 79396 | 79154 | 0 | 2161 | x25..351/y61..473 | faixa analisada |
| `clothes` | 1024×1024 | `54668c1edd277acf700ea31cb1f9cf99aee34a18dd84029d77676ff38c1d0f5b` | 205804 | 12489 | 0 | 8669 | x297..727/y51..973 | 1/255/106,173 |

Faixas de alpha dos assets relevantes:

```text
backHair: alpha 0=122088; 1-8=4293; 9-32=669; 33-64=576; 65-127=904; 128-254=72976
clothes:  alpha 0=842772; 1-8=1293; 9-32=1443; 33-64=1301; 65-127=2206; 128-254=6246
```

Não existem pixels com `alpha == 0` e RGB diferente de zero nos assets auditados. Isso descarta o caso clássico de RGB verde escondido em pixels totalmente transparentes. Existem muitos pixels semitransparentes em cabelos e roupa, mas o defeito do pescoço foi demonstrado em pixels do corpo com alpha zero e não depende de halo de resampling.

## 6. Preview real, canvas e PNG

Foram produzidos os artefatos em:

`C:\Users\luiz\AppData\Local\Temp\nymi-render-evidence-8b4275bc87814e7b815fbe9e762bbfde\final-validation\after-final-smoothing`

| Comparação | Resultado | Evidência |
|---|---|---|
| canvas real da preview × exportação PNG | **SIM** | 1920×1080, SHA `62c3296ea3935bb771c703cd388205da456eb2ba7678ce01a000cb2daac9312a`, 0 pixels diferentes. |
| snapshot before-export × PNG baixado | **SIM** | Mesmo SHA e 0 pixels diferentes. |
| preview DOM completo × canvas | **NÃO, por definição do artefato** | `creator-preview-dom.png` é screenshot de 700×393 com checkerboard, controles, zoom e label; não é uma imagem do personagem isolada. |
| preview canvas × PNG decodificado do Blob | **SIM** | `before-vs-export-diff.png` sem diferenças. |
| screenshot DOM × PNG | **NÃO COMPARÁVEL DIRETAMENTE** | O screenshot inclui interface e fundo CSS, não somente o canvas. |

A prévia do Criador é um único `<canvas aria-label="Pré-visualização do personagem">` dentro de um wrapper com UI. Não foram encontrados `<img>`, SVG, segunda camada de personagem, CSS mask ou pseudo-elemento que forme uma composição alternativa do personagem. A diferença visual percebida pelo usuário pode ser influenciada pelo zoom CSS, checkerboard e tamanho da tela; a representação exportada pelo canvas, porém, era a mesma imagem que o PNG.

### Por que a prévia parecia correta e o PNG parecia errado

O paradoxo não veio de um canvas correto sendo exportado como outro canvas. A causa comprovada era o asset transparente. Na prévia reduzida, sobre checkerboard e dentro do wrapper, a borda/escala podia tornar o defeito menos evidente. O download mostra os pixels completos em outra escala e fundo, tornando a mecha/contorno visível. Nos testes atuais, após reparar o asset, prévia canvas, before-export e PNG ficaram pixel-idênticos.

## 7. Comparação Criador × Studio/Roteiros

O Criador possui composição local em `app/page.tsx`. O Studio e a exportação de personagens utilizada por Roteiros usam `app/studio/character-renderer.ts` e `app/studio/character-export.ts`.

Ambos seguem a ordem:

```text
backHair → body → clothes → face → frontHair
```

Após alinhar o smoothing nos contextos intermediários e finais:

- `after-backHair`: 0 pixels diferentes;
- `after-body`: 0 pixels diferentes;
- `after-clothes`: 78 pixels diferentes, 0,0037616%, em uma linha de antialiasing fora do pescoço;
- `after-base-layers`: mesmos 78 pixels;
- `after-frontHair`: 174 pixels, 0,0083912%;
- final: 760 pixels, 0,0366512%, diferenças pequenas de antialiasing/canal, bbox `x799..1308 y23..1067`, sem o bloco do pescoço.

Antes do alinhamento do contexto final, a diferença chegou a 44.925 pixels/2,1665%. Isso era uma divergência real de qualidade de contexto do Criador, corrigida em `a6cc0a9`, `7eb6dac` e `329056b`.

Conclusão: `CRIADOR != STUDIO` em igualdade byte a byte residual, mas a diferença atual não é o bug da Iris, não aparece na região do pescoço e não muda a conclusão do caso. Os dois caminhos têm duplicação de renderer como **DÍVIDA TÉCNICA**; não foi feita uma refatoração ampla apenas por duplicação.

## 8. Estado de Canvas, alpha, smoothing e máscaras

- `compositeCharacterLayers` reseta `globalCompositeOperation` para `source-over`, `globalAlpha` para `1` e usa `save/restore` por layer.
- Os canvases de render são criados por operação; não há singleton de canvas compartilhado.
- O cache de chroma é de imagens processadas, indexado pela URL completa, com limite e invalidação em erro.
- A máscara do corpo do Studio usa `destination-in` em contexto isolado. A falta de `save/restore` nesse contexto é um **RISCO DEFENSIVO**, não causa do caso, pois o contexto não é reutilizado para outra layer.
- Não foi encontrado `clip()` persistente no caminho principal do personagem.
- `clearRect` não é executado com transformação ativa nos canvases principais de render; eles são novos e transparentes.
- Os contexts do Criador agora recebem a mesma configuração de alta qualidade do Studio, incluindo canvas de layer, corpo, roupa, cena e canvas final.
- O teste de smoothing/qualidade demonstrou que o contexto não alinhado explicava parte da diferença Criador/Studio. O problema do pescoço, contudo, existe em composição direta por causa do alpha zero do asset; não foi corrigido desligando smoothing.
- O teste de normalização de RGB oculto não justificou alteração permanente: os assets auditados têm `alpha=0, RGB!=0` igual a zero.

## 9. Determinismo, interferência e concorrência

### Mesmo input

Script: `scripts/character-export-determinism.mjs`  
Saída: `C:\Users\luiz\AppData\Local\Temp\nymi-determinism-a8eec87b3ea0485ab5045eb5b610e311\determinism-current`

- Iris/POSE 1/normal, 50 exports;
- 50/50 com SHA `a705c885592ad0e9cc631b193a23db2511972230ed6b5ce2a9928992b7b142dd`;
- 50/50 com 629.551 bytes;
- page errors: 0;
- console errors: 0.

### Interferência

Sequência Iris → outro personagem → Iris:

- SHA restaurado igual ao baseline;
- tamanho restaurado: 629.551 bytes;
- `matchesBaseline=true`;
- page errors: 0;
- console errors: 0.

### Serial/paralelo

O exportador de variantes do personagem usa `for...of` com `await`, portanto o fluxo real é serial. O Studio pode disparar múltiplos renders de personagens, mas cada render cria seus próprios canvases; não existe uma variante paralela compartilhando o mesmo canvas. Igualdade serial/paralelo não foi medida como experimento independente porque não há uma implementação paralela equivalente no exportador atual. Isso é **NÃO TESTADO como comparação de duas implementações**, mas a auditoria estática e o teste de interferência não encontraram o mecanismo de corrida.

Não há `forEach(async ...)` no caminho de render, nem `Image.src` compartilhado durante a composição, nem `URL.revokeObjectURL` antecipado no exportador analisado.

## 10. Eventos do render e ordem do Blob

O arquivo `creator-events.json` registrou a sequência:

```text
render:start
asset:ready backHair
layer:backHairDone
layer:bodyDone
asset:ready clothes
layer:clothesDone
layers:flattened
asset:ready frontHair
layer:frontHairDone
snapshot:before-export
render:complete
toBlob:start
toBlob:complete
```

A ordem registrada garante `renderComplete < toBlobStart`. Não existe conversão posterior entre o canvas final e o Blob PNG no fluxo testado.

## 11. Cobertura dos 121 testes

Resultado atual: **121 passaram, 0 falharam**.

Cobertura relevante:

- `tests/base-expression-integrity.test.mjs`: usa pixels/PNG reais do pacote `modelo-4` e confirma a região de pescoço coberta após o reparo;
- testes de comparação visual: exercitam composição e métricas de pixel;
- testes de chroma e máscaras: usam buffers/canvas controlados e verificam pixels;
- testes de exportação e Roteiros: verificam contratos, estados, caminhos e persistência;
- a maioria dos demais testes é unitária/contratual, com mocks ou fixtures reduzidas;
- `scripts/character-export-determinism.mjs`: valida o caminho real no navegador isolado, com 50 exports e interferência;
- `test:e2e`: valida o app construído em navegador e passou sem erros de objeto URL;
- `creator-load-smoke.mjs`: abriu 27 personagens, incluindo Iris e modelos manuais, com 0 erros de página/console;
- `diagnose:base-expressions`: confirmou 14/14 entradas `covered`, todas com `missingPixels:0`.

Os 121 testes não devem ser interpretados isoladamente como prova visual; a prova visual foi complementada pelos snapshots, PNGs reais e determinismo no navegador.

## 12. Ferramenta portátil para o caminho externo `D:\`

Arquivo: `scripts/compare-png-report.mjs`

Executar no Windows:

```powershell
node scripts/compare-png-report.mjs `
  "D:\EDITOR WEB 2\EDITOR TESTE\data\assets\characters\C.AI HISTORICAL 2 — THE ROYAL SELECTION\Cronista Real - Iris Bellamy\POSE 1\normal.png" `
  "C:\Users\luiz\Downloads\Cronista-Real---Iris-Bellamy.png" `
  "C:\Users\luiz\Downloads\iris-diff.png"
```

O relatório produz SHA-256, dimensões, quantidade de pixels diferentes, porcentagem, maior diferença, bounding box e `diff.png`. O primeiro arquivo precisa ser o PNG externo original e o segundo o download do app.

## 13. Bugs/risks adjacentes encontrados

### BUG CONFIRMADO e corrigido

- Janela transparente no pescoço das expressões head-only do `modelo-4`, causando aparição legítima do `backHair` atrás do corpo. Corrigido em `110d89f` e protegido por `91dfa0e`.

### PROTEÇÕES CONFIRMADAS

- Estado antigo não é usado no callback de render;
- contextos do Criador foram alinhados aos defaults de qualidade do Studio;
- exportação de variantes é serial e determinística;
- snapshots/debug são condicionados e não pesam no fluxo normal.

### RISCO

- `modelo-4/model.json` informa internamente `modelo-7`, embora o caminho resolvido seja `modelo-4`;
- máscara com `destination-in` do Studio não possui `save/restore` próprio, embora use contexto isolado;
- Criador e Studio/Roteiros ainda possuem renderizadores separados.

### DÍVIDA TÉCNICA

- Unificar o compositor em uma implementação canônica após avaliar compatibilidade, sem mudar o comportamento atual só por estética arquitetural;
- criar uma equivalência automatizada mais rígida entre os dois renderers, se a igualdade byte a byte se tornar requisito.

### DESCARTADO

- Exportação de vídeo pelo Studio não foi tratada como problema; o Studio é composição visual e Print/PNG.
- Mobile, PWA, Electron/Tauri, Mac/Linux, Cloudflare e multiplataforma não são problemas deste produto local Windows/browser.

## 14. Validação técnica final

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | PASSOU |
| `npm run build` | PASSOU |
| `npm run test:unit` | PASSOU — 121/121 |
| `npm run test:e2e` | PASSOU — phase 8, 0 objetos ativos |
| `npm run diagnose:base-expressions` | PASSOU — 14/14 cobertas, 0 pixels faltantes |
| smoke de carregamento do Criador | PASSOU — 27 personagens, 2 modelos, 0 erros |
| Criador preview → export único | PASSOU — 0 pixels diferentes |
| Criador before-export → PNG | PASSOU — 0 pixels diferentes |
| Studio renderer | PASSOU — sem erro de página/console; pescoço sem bloco |
| determinismo | PASSOU — 50/50 hashes iguais |
| não-contaminação por outro personagem | PASSOU |
| variantes | fluxo serial confirmado; sem divergência por concorrência observada |
| arquivo externo `D:\` | NÃO TESTADO aqui — caminho indisponível; ferramenta preparada |

## 15. Arquivos de código envolvidos

- `app/creator/base-expression-integrity.mjs`: detecção e reparo da janela de pescoço;
- `scripts/repair-base-expression-neck.mjs`: diagnóstico/reparo dos assets do modelo 4;
- `app/studio/layer-compositor.ts`: composição explícita e isolamento do estado de Canvas;
- `app/studio/render-quality.ts`: defaults de alta qualidade;
- `app/page.tsx`: composição e exportação do Criador, com contexts alinhados e snapshots debug;
- `app/studio/character-renderer.ts`: renderer de personagens do Studio/Roteiros;
- `app/studio/character-export.ts`: exportação única/variantes usada por Roteiros;
- `app/studio/render-debug.ts`: instrumentação e cores artificiais atrás de flag;
- `scripts/compare-png-report.mjs`: comparação portátil entre dois PNGs;
- `scripts/character-export-determinism.mjs`: determinismo e não-contaminação;
- `tests/base-expression-integrity.test.mjs`: regressão da cobertura de pescoço;
- `tests/model-pack-cache.test.mjs` e `tests/rendered-html.test.mjs`: contratos de ordem/cache/render.

## 16. Estado final

### CAUSA RAIZ

Assets de expressão do `modelo-4` não cobriam totalmente a região do pescoço. O `backHair`, corretamente atrás, aparecia através dessa transparência.

### EVIDÊNCIA

Pixel tracing em `(955,330)` e `(980,340)`, snapshots intermediários, inspeção do asset antigo, teste sem backHair, teste de cores artificiais e reparo com `missingPixels=0`.

### POR QUE OS TESTES ANTERIORES PASSAVAM

Os testes antigos verificavam ordem/estado/contrato e alguns comparavam canvas com exportação, mas não verificavam a cobertura real do pescoço em cada expressão do modelo 4. A nova regressão inspeciona pixels da região crítica.

### CORREÇÃO APLICADA

Reparo localizado nos PNGs do pacote `modelo-4`, copiando apenas pixels ausentes da região crítica do frame `*_blink.png` correspondente. Nenhuma ordem global foi invertida e nenhum hack de exportação foi adicionado.

### COMO EVITAR REGRESSÃO

O diagnóstico `npm run diagnose:base-expressions` e o teste de integração falham se qualquer expressão voltar a ter pixels faltantes na região do pescoço. Os testes de determinismo e interferência protegem contra contaminação entre renders. A comparação preview/before-export/Blob protege contra divergência do pipeline.

### LIMITAÇÃO RESTANTE

O PNG original localizado em `D:\EDITOR WEB 2\...` só pode ser comparado no ambiente Windows onde ele existe. Isso não impede a conclusão do bug no pipeline do app porque o caso foi reproduzido e explicado com os assets e exports disponíveis; se o download externo ainda mostrar diferença, execute o comparador portátil e envie o `report.json`/`diff.png`.

# RECONHECIMENTO E CORREÇÃO ENCERRADOS

O caso Iris/modelo-4/POSE 1 foi encerrado com causa, prova, correção e regressão. As diferenças residuais entre Criador e Studio estão documentadas como dívida de paridade, não como uma causa oculta deste bug.
