# Roadmap de reconstrução progressiva

## Estratégia

Trabalhar em fatias verticais pequenas. Cada etapa deve preservar as rotas e os
dados existentes, possuir rollback por commit e só avançar após build, typecheck,
lint e testes relevantes.

## Classificação das mudanças

| Classe | Itens |
|---|---|
| Essenciais | contratos compartilhados, paridade, segurança de dados, autosave, schemas, testes de import/export e renderização. |
| Importantes | shell NYMI, design system, responsividade, componentização, erros consistentes, destinos configuráveis e performance medida. |
| Opcionais | paleta de comandos, favoritos, templates, tema escuro e atalhos configuráveis. |
| Futuras | empacotamento desktop, processamento em lote e eventual Video Maker. |
| Alto risco | unificar storage, migrar Canvas para Worker, trocar servidor/build stack, alterar ZIP/JSON e remover compatibilidade legada. |

## Fase 0 — Baseline e inventário (concluída)

Entregáveis:

- cópia independente em `C:\TRABALHO 2\NYMI GACHA`;
- commit-base `bf8410f`;
- instalação reproduzível com `npm ci`;
- baseline de build e 33 testes verdes;
- inventário funcional, arquitetura, paridade, redesenho e fluxos.

Risco conhecido: 18 vulnerabilidades reportadas pelo npm e script unitário
isolado dependente do artefato de build.

## Fase 1 — Fundação e contratos compartilhados

Objetivo: reduzir duplicação sem alterar UI ou dados.

Estado: **concluída**.

Primeiro slice concluído:

- tipos primitivos de modelo, categoria, transformação e máscara compartilhados
  entre Criador e Studio;
- normalização legada de modelo centralizada;
- teste unitário cobrindo valores vazios, `padrao`, `pack-N`, `modelo-N` e IDs livres;
- typecheck, build e 34 testes aprovados sem alteração visual.

Conclusão da fase:

- contratos canônicos criados em `app/domain` (local compartilhável pelo bundle
  browser e pelo serviço Node), em vez de `src/domain`;
- documentos principais v2 e Roteiros v1 formalizados;
- IDs nominais e convenção de validação definidos;
- schemas runtime integrados ao servidor e ao storage de Roteiros;
- adaptadores preservam as APIs públicas antigas durante a migração;
- gênero, categorias, modos de rosto, expressões e versões centralizados;
- round-trip moderno/legado e preservação de campos futuros cobertos;
- build, typecheck, lint sem erros e 38 testes aprovados.

Tarefas concluídas:

1. Criar `app/domain` com tipos versionados de personagem, catálogo, Studio e Roteiros.
2. Criar IDs nominalmente tipados e normalizadores legados.
3. Adicionar schemas runtime sem substituir o carregamento atual de uma vez.
4. Criar adaptadores entre contratos novos e os tipos atuais.
5. Centralizar constantes de categorias, modelos e expressões.
6. Testar round-trip de fixtures versões 1 e 2.

Aceite:

- nenhum HTML ou PNG de fixture muda;
- dados atuais carregam e salvam sem perda;
- `app/page.tsx` e Studio começam a importar a mesma fonte de tipos;
- testes completos verdes.

## Fase 2 — Segurança e estabilidade operacional — concluída

Objetivo: tornar a base segura antes de ampliar o redesign. Concluído nesta
rodada e registrado no commit da Etapa 2.

Entregas realizadas:

- Next e React foram atualizados em lote isolado para `next@16.2.12`,
  `eslint-config-next@16.2.12`, `react@19.2.8`, `react-dom@19.2.8` e
  `react-server-dom-webpack@19.2.8`.
- `postcss@8.5.25` e `sharp@0.35.3` foram fixados por `overrides` para
  eliminar vulnerabilidades transitivas de produção.
- Uploads receberam limites por finalidade, validação MIME, `Content-Length`
  antecipado e timeout de servidor.
- A UI agora obtém um token efêmero do endpoint `/session`; operações da API
  local enviam `X-Gacha-Session` e recebem renovação automática em 401.
- Prints e destinos do Video Maker continuam configuráveis por
  `GACHA_PRINTS_ROOT` e `GACHA_VIDEO_MAKER_ASSETS_ROOT`, preservando os
  defaults legados.
- Erros agora retornam código, request ID e mensagem sanitizada; logs locais
  registram somente método, rota, código e ID.
- `test:unit` permanece desacoplado do build; `npm test` cobre build + suíte
  completa.

Identidade e portas desta versão:

- Produto: **Nymi Gacha 2.0**.
- Interface: `http://localhost:6700`.
- Serviço local: `http://127.0.0.1:6800`.
- Launcher: `INICIAR-NYMI-GACHA.bat`.

Aceite validado:

- `npm audit --omit=dev`: zero vulnerabilidades.
- origens/processos sem token não escrevem dados.
- uploads excessivos e tipos não permitidos falham com 413/415.
- todos os testes do baseline passam.

## Fase 3 — Shell NYMI e design system — concluída

Objetivo: introduzir identidade e navegação sem redesenhar os editores internamente.

Entregas realizadas:

1. Tokens CSS, tipografia, ícones e componentes base acessíveis em
   `app/globals.css`.
2. Shell global reutilizável em `app/shared/NymiShell.tsx`, com navegação para
   Personagens, Studio e Roteiros e estado ativo acessível.
3. Indicador compartilhado de conexão local, preservando as mensagens de
   salvamento existentes em cada área.
4. Layout responsivo mínimo de 1366×768, com redução controlada de espaçamento
   e navegação compacta em telas menores.
5. Foco visível por teclado, suporte a `prefers-reduced-motion` e teste de
   contrato/renderização do shell em `tests/rendered-html.test.mjs`.

Aceite validado: as três áreas continuam acessíveis nas rotas antigas, os
links indicam a área ativa sem alterar suas ações internas, e os testes de
shell, build, typecheck e lint permanecem verdes. A fase não redesenha os
editores internamente; ela estabelece a base visual e de navegação para as
fases 4–6.

## Fase 4 — Criador por fatias (concluída)

Ordem executada:

1. Funções puras de geometria, detecção de folhas e processamento Canvas foram
   extraídas para `app/creator/image-processing.ts` e
   `app/creator/canvas-processing.ts`.
2. Repositório do Criador, IndexedDB/localStorage de compatibilidade, autosave
   local e hidratação do PC foram isolados em `app/creator/creator-storage.ts`.
3. A biblioteca esquerda foi separada em `CreatorLibraryPanel`.
4. A barra superior foi separada em `CreatorTopbar` e a toolbar da prévia em
   `CreatorCanvasToolbar`.
5. O cabeçalho de importação do catálogo foi separado em
   `CreatorCatalogHeader`; o inspetor permanece no mesmo contrato e estado da
   página para evitar regressão visual.
6. Chroma key agora usa `chroma.worker.ts`/`chroma-worker-client.ts`, com
   fallback síncrono explícito quando Worker não estiver disponível.
7. Contratos de renderização, PNG/ZIP, importação de folhas, máscaras e
   toolbar foram cobertos por testes de fonte e build na suíte existente.

Aceite validado: os itens do Criador continuam com paridade `P` em
`FEATURE_PARITY.md`; build, typecheck, lint (zero erros) e 41 testes passam.
Os avisos restantes são apenas recomendações de otimização para `<img>` nas
interfaces existentes. O processamento em Worker mantém paridade com a
implementação síncrona por meio de fallback e cópia dos buffers.

Rollback: o commit anterior à fase 4 permanece disponível; a fase foi feita em
arquivos isolados e a página principal só delega callbacks existentes aos novos
componentes.

## Fase 5 — Studio por fatias

1. Compartilhar tipos e renderizador de personagem.
2. Extrair store/history e casos de uso.
3. Componentizar toolbar, elenco, canvas e inspetor.
4. Unificar pipeline preview/print.
5. Melhorar feedback de clipboard e tradução.
6. Testes E2E de composição, reload e print.

## Fase 6 — Roteiros por fatias

1. Compartilhar schemas cliente/servidor.
2. Extrair store e comandos do editor.
3. Componentizar TikTok e blocos com renderização estável.
4. Adicionar cancelamento e timeout uniforme da IA.
5. Testar upload/Range/remove e todas as exportações.
6. Validar JSON exportado contra fixtures do fluxo externo.

## Fase 7 — Persistência única e recuperação

1. Definir o PC como fonte canônica.
2. Manter navegador apenas como recovery journal versionado.
3. Criar tela de backups/restauração e conflitos.
4. Testar corrupção, disco cheio, encerramento abrupto e gravações concorrentes.
5. Documentar migração desde IndexedDB/`localStorage` antigos.

## Fase 8 — Qualidade e desempenho

- E2E com Playwright nos fluxos críticos.
- comparação visual de Canvas/exports;
- métricas de importação e renderização;
- teste com 100 personagens/assets e roteiros extensos;
- acessibilidade por teclado e contraste;
- monitoramento de URLs de objeto e vazamentos de memória;
- smoke test do BAT em máquina limpa.

## Fase 9 — Beta e substituição opcional do Premium

Critérios:

- toda paridade `P` comprovada;
- migração reversível testada em cópia de dados reais;
- zero alteração no Premium original;
- manual de backup e rollback;
- zero vulnerabilidade alta de produção;
- build e execução aprovados em Windows 10/11;
- usuário valida Criador, Studio e Roteiros em uso real.

## Primeiro slice recomendado

**Contratos de personagem e catálogo + teste de round-trip**, sem qualquer mudança
visual. É o menor passo que reduz risco simultaneamente no Criador, Studio,
Roteiros e exportador ZIP.

Arquivos novos previstos:

- `src/domain/version.ts`
- `src/domain/ids.ts`
- `src/domain/characters.ts`
- `src/domain/catalog.ts`
- `src/domain/migrations.ts`
- `tests/domain-contracts.test.mjs`

Arquivos atuais inicialmente adaptados apenas depois dos testes:

- `app/studio/types.ts`
- subconjunto de tipos no topo de `app/page.tsx`
- normalização em `local-data-server.mjs`

Rollback: um commit para contratos/testes e outro para cada consumidor migrado.
