# Motores do Laboratório de Cor

Esta pasta é a fronteira removível dos analisadores automáticos. A interface depende
somente de `ColorAnalysisEngine`.

## Ativo agora

- `classic-engine.ts`: executa no Web Worker o detector local de anatomia estilizada.
- O detector usa transparência, região da cabeça, componentes conectados, morfologia,
  pares espelhados de olhos e sobrancelhas e pontuação de confiança.
- Não envia imagens para a internet e não bloqueia a interface.

## Integrações avaliadas

- **OpenCV.js**: útil se os benchmarks mostrarem gargalo ou necessidade de operações
  morfológicas adicionais. A implementação local atual evita carregar ~15 MB sem ganho
  comprovado.
- **ONNX Runtime Web/WebGPU**: encaixa neste contrato quando existir um modelo treinado
  para os sprites do projeto. O runtime sozinho ocupa mais de 100 MB e não sabe detectar
  pupilas ou sobrancelhas sem esse modelo.
- **SAM 2**: apropriado para sugerir máscaras durante a criação de dataset, não como
  detector definitivo de regiões pequenas em todo navegador.
- **CVAT**: ferramenta externa para revisar/anotar o dataset. Não é uma biblioteca web
  embarcável no aplicativo.

Quando houver um modelo ONNX validado, basta criar `onnx-engine.ts` nesta pasta. Toda a
integração poderá ser removida apagando a pasta desta ferramenta, sem alterar Criador ou
Studio.
