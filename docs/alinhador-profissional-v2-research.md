# Alinhador Profissional V2 — diagnóstico e decisões iniciais

## Garantia de isolamento

- O Alinhador Profissa original permanece em `public/Ferramentas/alinhador-profissa/index.html`.
- Seu SHA-256 no início desta fase é `278840c1fb7a610c7fb02936a92a1bff78f3b2d90ec281c4471a5a8e191590ee`.
- A V2 mantém uma cópia byte a byte em `public/Ferramentas/alinhador-profissional-v2/baseline-v1.html`.
- Toda evolução da V2 ocorre na rota `app/Ferramentas/alinhador-profissional-v2` e em módulos próprios.

## Arquitetura atual auditada

O alinhador atual é um aplicativo legado autocontido. O mesmo HTML concentra UI, leitura das folhas, chroma/alpha, componentes conectados, ordenação, crop, geometria, detecção de queixo e pescoço, criação do molde, warp scanline, player, diagnóstico e exportação. O resultado atual é uma referência valiosa, mas o acoplamento dificulta comparar algoritmos, testar partes isoladamente, preservar estados de edição e executar processamento fora da thread principal.

Funções centrais localizadas: `detectSheet`, `cropHead`, `geometry`, `detectChin`, `detectNeckBottom`, `buildCanonical` e `makeWarpedCanvas`. A V2 não altera essas funções.

## O que as folhas A, B e C provaram

As três imagens têm 1672 × 941 px, grade 7 × 3 e fundo opaco. O detector offline identificou 21 regiões em cada folha. Os arquivos e hashes estão registrados em `tests/alinhador-profissional-v2/fixtures/same-character-abc/metadata.json`.

Resultados iniciais:

- largura do foreground varia até 10 px no mesmo slot entre A/B/C;
- centro horizontal varia até 11,2 px;
- a orientação global estimada pela silhueta varia menos de 3°;
- as duas primeiras linhas têm altura muito próxima entre folhas, normalmente 0–5 px de diferença;
- a terceira linha da folha A está encostada no limite da imagem e apresenta até 23 px a menos de componente principal útil quando comparada a B/C;
- olhos, sobrancelhas, boca e marcas decorativas variam de forma legítima e não podem ser usados como erro de alinhamento denso;
- existem diferenças locais de bochecha, mandíbula, orelha e distribuição dos elementos internos que uma transformação global não elimina.

A diferença da última linha não é evidência suficiente de uma cabeça verticalmente comprimida: pode ser conteúdo truncado pelo enquadramento. A análise também encontrou uma faixa branca externa na base da folha C e passou a excluí-la como separador, em vez de contá-la como personagem. A V2 registra `touchesSourceBoundary` e deve impedir warps que inventem pixels ausentes.

## Técnicas avaliadas

| Técnica | Utilidade | Risco | Complexidade | Desempenho | Adequação a sprites chibi |
| --- | --- | --- | --- | --- | --- |
| Transformação de similaridade por Procrustes ponderado | Alta | Baixo | Baixa | Excelente | Alta para posição, escala e rotação |
| Landmarks manuais + automáticos assistidos | Muito alta | Baixo | Média | Excelente | Muito alta; mantém o artista no controle |
| Piecewise affine em malha | Alta | Médio | Média | Boa | Alta quando limitado por regiões e intensidade |
| Thin-plate spline regularizado | Alta | Médio/alto | Média/alta | Boa | Útil para correções suaves, perigoso sem limites |
| Optical flow denso | Média | Alto | Alta | Média | Baixa como padrão: confunde mudanças de expressão |
| Registro denso por pixels | Baixa | Alto | Alta | Média | Inadequado: olhos e boca devem mudar |
| OpenCV/WASM | Média | Médio | Alta | Boa após carregamento | Só vale se contorno/morfologia superarem JS medido |
| WebGL/WebGPU | Potencial | Médio/alto | Alta | Excelente | Só após profiling provar gargalo no warp |
| Worker + OffscreenCanvas | Alta | Baixo/médio | Média | Excelente responsividade | Alta, com fallback para Canvas 2D |

O Procrustes separa translação, rotação e escala de diferenças de forma em conjuntos de landmarks. Isso encaixa no primeiro estágio da V2, desde que os pontos tenham pesos e confiança; landmarks internos variáveis não devem dominar o ajuste. A literatura também sustenta combinar Procrustes com deformação por spline para contornos, mas a correspondência continua sendo a parte frágil. Fontes: [Goodall, 1991](https://academic.oup.com/jrsssb/article/53/2/285/7028139), [OpenCV Thin Plate Spline](https://docs.opencv.org/4.10.0/dc/d27/shape__transformer_8hpp.html) e [Bookstein, landmarks e splines](https://doi.org/10.1016/S1361-8415%2897%2985012-8).

`OffscreenCanvas` pode operar em Web Workers e permite tirar processamento pesado da UI, mas não altera a matemática nem o resultado visual. É uma otimização apropriada depois de fixar a saída determinística. Fonte: [MDN OffscreenCanvasRenderingContext2D](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvasRenderingContext2D).

## Arquitetura escolhida

1. **Interface React independente**: projeto, seleção, zoom, onion skin, diferença, landmarks, histórico e exportação.
2. **Sheet manager**: fontes imutáveis, grade validada, células, boundary flags e metadados.
3. **Motor de análise**: máscara de fundo conectada às bordas, silhueta, contorno, métricas e confiança.
4. **Motor global**: Procrustes ponderado/similarity transform usando topo, laterais, mandíbula e pescoço.
5. **Motor local**: malha piecewise affine ou TPS regularizado, desativado por padrão e com intensidade limitada.
6. **Compositor**: Canvas 2D determinístico, alpha-aware, original sempre preservado.
7. **Worker**: análise e warp em lote, com fallback síncrono testável.
8. **Benchmark**: fixture A/B/C, métricas geométricas, borda, holes, estabilidade e tempo.

Não será criado um aplicativo nativo separado nesta fase. A precisão vem do motor matemático, dos landmarks e da validação, não do contêiner da UI. Continuar no webapp mantém a integração existente e permite Worker, WASM e GPU no futuro.

## Três melhorias com maior ganho provável

1. **Landmarks estruturais ponderados com edição humana**: resolve correspondência e evita que olhos/boca expresivos contaminem o contorno.
2. **Pipeline em dois estágios (similaridade global + warp local limitado)**: corrige escala/rotação primeiro e somente depois diferenças regionais, com cada correção desligável.
3. **Validação objetiva por silhueta e borda da fonte**: rejeita holes, extrapolação e falsa “correção” de conteúdo truncado.

## O que não será padrão

- optical flow ou registro denso, porque tentariam neutralizar diferenças legítimas de expressão;
- TPS irrestrito, porque pode mover regiões distantes e deformar olhos;
- OpenCV apenas por conveniência, antes de uma prova de ganho;
- GPU antes de profiling;
- qualquer alteração destrutiva dos PNGs originais.

## Próxima validação

O primeiro protótipo deve carregar A/B/C, cortar a grade sem destruir as fontes, exibir sobreposição/diferença, permitir escolher a referência e editar landmarks. O global será comparável ao original; o local ficará explicitamente experimental. O sucesso será medido por estabilidade do contorno e ausência de pixels inventados, não por diferença pixel a pixel do rosto.
