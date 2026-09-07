# Alinhador Profissa — pesquisa da Fase A

Data: 2026-09-06

## Conclusão executiva

O pipeline atual já resolve o problema principal com um modelo simples,
determinístico e específico para sheets de cabeças. A pesquisa não justifica
trocar o warp scanline por TPS, optical flow ou GPU nesta fase. As três maiores
oportunidades de ganho/risco são:

1. benchmark de silhueta e estabilidade entre frames, separado de detalhes
   internos que mudam artisticamente;
2. validação estrutural 3×7 após a detecção, antes do molde;
3. comparação A/B offline entre o molde atual e um molde estatístico robusto,
   sem promover o experimental automaticamente.

## Técnicas avaliadas

| Técnica | Utilidade | Risco | Complexidade | Performance | Adequação |
|---|---|---|---|---|---|
| Procrustes ponderado | Estimar translação/escala usando topo, laterais, mandíbula e pescoço | baixa se limitar a similaridade rígida; alta se permitir deformação | média | alta | boa como diagnóstico/A-B |
| Contorno/silhueta + Chamfer/IoU | Mede estabilidade estrutural sem penalizar boca/olhos | depende da máscara alpha/chroma | média | alta offline; média no browser | excelente |
| Percentis/MAD | Rejeita uma cabeça ruim sem contaminar as outras | thresholds precisam de calibração | baixa | alta | excelente e já compatível |
| Molde mediano de perfis | Reduz dependência de uma expressão | pode suavizar uma forma legítima | média | alta | boa como experimento |
| OpenCV.js/WASM | Componentes, contornos, morfologia, distance transform | bundle/startup e manutenção | alta | variável | útil para benchmark, não comprovado para produção |
| Optical flow | Captura deslocamentos densos | pode seguir olhos, boca e blush; cria deformação/ghosting | alta | baixa/média | inadequado como warp padrão |
| TPS/piecewise affine | Ajusta contorno complexo | buracos, costuras e deformação interna | alta | média/baixa | somente experimento controlado |
| SSIM | Métrica perceptual geral | detalhes internos mudam entre expressões | média | média | útil em regiões estruturais, não sozinho |
| Web Worker/OffscreenCanvas | Evita bloquear UI em processamento pesado | cópia/transferência e compatibilidade | média | potencialmente melhor | só após profiling comprovar gargalo |
| Playwright visual regression | Verifica preview/UI e exports com tolerância | baseline depende do ambiente | baixa | não afeta runtime | recomendado |

## Fontes primárias

- OpenCV.js — contornos e features: https://docs.opencv.org/4.13.0/d0/d43/tutorial_js_table_of_contents_contours.html
- OpenCV.js — funções disponíveis no build JS, incluindo connected components,
  distance transform, morphology, remap e warpAffine:
  https://github.com/opencv/opencv/blob/4.x/platforms/js/opencv_js.config.py
- OpenCV — optical flow Lucas–Kanade/Farneback:
  https://github.com/opencv/opencv/blob/4.x/doc/tutorials/others/optical_flow.markdown
- OpenCV — thin-plate spline shape transformer:
  https://docs.opencv.org/3.0-last-rst/modules/shape/doc/shape_transformers.html
- Procrustes Methods in Statistical Analysis of Shape:
  https://academic.oup.com/jrsssb/article/53/2/285/7028139
- SSIM original paper:
  https://ece.uwaterloo.ca/~z70wang/publications/ssim.pdf
- MDN OffscreenCanvas em Worker:
  https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvasRenderingContext2D
- Playwright visual comparisons:
  https://playwright.dev/docs/test-snapshots

## Decisões desta fase

- Nenhuma biblioteca nova foi instalada.
- OpenCV fica como POC offline futuro; não deve entrar no bundle sem ganho
  medido em fixtures reais.
- Procrustes será usado primeiro para diagnóstico/A-B rígido, nunca para warp
  livre de olhos/boca.
- Optical flow e TPS ficam descartados como padrão atual por risco de seguir
  detalhes expressivos e introduzir deformação/holes.
- SSIM será combinado com silhueta/alpha; não será usado isoladamente.
- Worker/OffscreenCanvas só será promovido se profiling demonstrar bloqueio
  relevante da thread principal.
