# Studio — qualidade máxima

## Objetivo

O Studio usa uma cena lógica fixa de **1920 × 1080 pixels**. A prévia exibida na tela é apenas uma escala responsiva dessa cena; posição, tamanho, camadas e composição continuam sendo calculados na resolução final.

Essa arquitetura elimina diferenças de enquadramento entre a prévia e o print e evita que a resolução do monitor determine a qualidade do arquivo exportado.

## Contratos visuais

- Resolução lógica e de exportação: `1920 × 1080`.
- Formato do print: PNG, preservando a qualidade sem perdas de JPEG.
- Fundo: `cover` ou `contain`, com a mesma regra na prévia e na exportação.
- Personagens: altura-base proporcional à cena lógica.
- Objetos: largura-base proporcional à cena lógica.
- Texto: fonte, peso, largura e tamanho iguais na prévia e no compositor do print.
- Interpolação: suavização de imagem em qualidade alta nos canvases de composição.

## Processamento dos personagens

O compositor do Studio reutiliza os assets originais e aplica:

1. chroma key avançado, com tolerância, suavização de borda e despill;
2. recorte alfa pixel a pixel, preservando detalhes finos;
3. composição das camadas na resolução de trabalho;
4. cache compartilhado das imagens decodificadas;
5. cache limitado das composições para evitar crescimento contínuo de memória.

Nenhum arquivo original é sobrescrito e nenhum asset recebe upscale permanente.

## Diagnóstico de fonte

Ao selecionar fundo, personagem ou objeto, o inspetor informa:

- a resolução real do arquivo;
- o fator de ampliação necessário na cena;
- `QUALIDADE MÁXIMA` quando a fonte atende ao tamanho de destino;
- `QUALIDADE LIMITADA PELA FONTE` quando seria necessário ampliar mais de 5%.

O aviso é informativo e não bloqueia a edição nem altera o conteúdo.

## Limites de qualidade

A aplicação preserva o máximo disponível no arquivo, mas não consegue recriar detalhes ausentes em uma imagem pequena ou desfocada. Para melhores resultados:

- use PNG transparente sempre que possível;
- prefira personagens com pelo menos a altura em que serão exibidos no print;
- use fundos 1920 × 1080 ou maiores;
- evite imagens previamente comprimidas em JPEG;
- ajuste o tamanho na cena sem ampliar excessivamente fontes pequenas.

## Validação

Comandos obrigatórios da implementação:

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e
npm run visual:phase9
```

O teste ponta a ponta do Studio usa armazenamento temporário e portas isoladas, cria uma cena real, confirma o palco 16:9 em `1920x1080`, renderiza um personagem e valida o diagnóstico de qualidade.
