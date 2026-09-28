# Fabricador de Modelo V2 — estado atual

Atualizado em 28/09/2026 para a branch `V11-TESTE`.

Este documento descreve somente a implementação atual. Registros antigos de Head Master, Folha 1/Folha 2, 21/42 sprites e painéis de qualidade pertencem a uma arquitetura anterior e não devem orientar novas alterações.

## Objetivo

O Fabricador monta modelos head-only a partir de camadas independentes:

- olhos: 2 linhas, aberto em cima e fechado embaixo;
- sobrancelhas: par esquerdo/direito;
- bocas: grade 7×3 com 21 células;
- blush: imagem individual;
- shadow: imagem individual;
- manpu: grade 7×3 com 21 células, permitindo células vazias;
- molde fixo: `public/Ferramentas/fabricador-de-modelo/molde.png`.

## Fluxo da interface

A interface foi reconstruída em quatro etapas claras:

1. **Assets** — upload e estado das camadas.
2. **Encaixe** — chroma e posição da camada selecionada.
3. **Expressões** — edição dos 21 presets, efeitos e microajustes.
4. **Exportar** — geração, revisão, ZIP e envio para o catálogo.

O preview fica central e estável. A biblioteca fica separada das ações de edição.

Ações destrutivas e não destrutivas agora são distintas:

- **Remover da montagem** não apaga o arquivo.
- **Excluir da biblioteca** pede confirmação e remove o arquivo permanentemente.

## Arquitetura

Arquivos principais:

- `page.tsx` — orquestração do workspace e estado da sessão;
- `components/ControlPrimitives.tsx` — controles reutilizáveis;
- `fabricador-config.ts` — defaults, limites, presets e tipos de fluxo;
- `core/compositor.ts` — composição em canvas e frame 1920×1080;
- `core/eye-processing.ts` — chroma, detecção e recorte;
- `fabricador-storage.ts` — biblioteca e fallback offline;
- `services/models/model-export-session.mjs` — publicação atômica de modelos;
- `local-data-server.mjs` — endpoints e persistência local.

## Chroma e processamento

O chroma agora separa duas responsabilidades:

- **máscara estrutural** usa força 100% para localizar corretamente os pixels do asset e calcular recortes;
- **imagem visual** respeita Força, Tolerância e Suavidade escolhidas pelo usuário.

Isso evita que um fundo parcialmente transparente seja confundido com conteúdo durante o recorte.

Proteções adicionais:

- arquivos acima de 48 MB são rejeitados antes do processamento;
- imagens acima de 40 milhões de pixels são recusadas antes de criar canvas grande;
- olhos exigem conteúdo visível nas duas linhas e dois elementos por linha;
- sobrancelhas exigem conteúdo visível;
- bocas exigem 21 células não vazias;
- manpu aceita células vazias.

## Expressões e efeitos

Existem 21 expressões canônicas em `constants/expressions.ts`.

Cada expressão pode escolher blush, shadow e manpu próprios. Na geração, a posição base é carregada do asset específico usado por aquela expressão — não da última camada aberta no editor.

Manpu não simula seleção individual de célula: a folha 7×3 é o asset, e a célula correspondente é escolhida automaticamente pelo índice da expressão.

O processamento de efeitos é cacheado por asset + chroma durante a geração. Olhos e sobrancelhas decodificados também são reutilizados.

Qualquer alteração que muda a composição invalida a grade já gerada, evitando exportar PNGs antigos depois de reposicionar ou trocar assets.

## Biblioteca e persistência

Assets ficam em:

- `arquivos/fabricador-modelos/`;
- `arquivos/fabricador-modelos/index.json`;
- presets em `arquivos/fabricador-modelos/presets.json`.

Fallback do navegador:

- assets criados offline são preservados;
- assets `localOnly` tentam sincronizar quando o servidor retorna;
- presets offline ficam marcados como pendentes;
- falta de espaço no localStorage não é tratada como salvamento bem-sucedido.

Servidor:

- IDs duplicados são rejeitados;
- POST/PATCH/presets fazem rollback de memória quando a gravação atômica falha;
- exclusão usa quarentena do arquivo antes de alterar manifestos;
- efeitos excluídos são removidos dos presets que os referenciam.

## Exportação atômica

A exportação não grava mais diretamente em `public/models/modelos`.

Fluxo:

1. consulta o próximo número;
2. reserva `modelo-N` numa pasta de staging;
3. envia manifesto + 63 PNGs para staging;
4. servidor verifica as 21 chaves únicas e todos os 64 arquivos;
5. um `rename` publica a pasta completa de uma vez.

Se houver falha:

- staging é cancelado;
- nenhum modelo parcial aparece no catálogo;
- uma segunda exportação não consegue roubar uma reserva ativa;
- numerações reservadas entram no cálculo do próximo modelo;
- staging antigo é limpo quando o servidor reinicia.

## Testes adicionados

- `tests/model-export-session.test.mjs`:
  - reserva concorrente;
  - commit incompleto;
  - publicação completa;
  - cancelamento;
  - próximo número considerando staging.
- `tests/ferramentas-layout.test.mjs`:
  - contratos estruturais do Fabricador V2;
  - persistência offline;
  - exportação em staging;
  - layout novo.
- `scripts/e2e-check.mjs`:
  - abre o Fabricador;
  - envia folha sintética de olhos;
  - envia grade sintética 7×3 de bocas;
  - confirma 21/21;
  - gera as 21 expressões;
  - valida que o preview continua visível.

## Validação recomendada no Windows self-hosted

Sem artifacts, executar no checkout da `V11-TESTE`:

```powershell
npm run typecheck
node --test tests/model-export-session.test.mjs tests/ferramentas-layout.test.mjs
npm run build
npm run test:e2e
```

Além da automação, ainda vale um teste visual com seus assets reais para conferir gosto/posicionamento, porque isso não pode ser inferido por uma folha sintética.
