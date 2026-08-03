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

## Fase 5 — Studio por fatias (concluída)

1. Os tipos públicos e o renderizador de personagem continuam compartilhados
   pelo adaptador `app/studio/types.ts` e `character-renderer.ts`.
2. Operações de cena e histórico foram extraídos para `scene-ops.ts` e
   `history.ts`; a página conserva os mesmos callbacks e o mesmo limite de
   histórico para manter o comportamento atual.
3. Toolbar, elenco, canvas e inspetor agora são componentes independentes em
   `app/studio/components/` sem alteração do contrato visual ou das ações.
4. O pipeline de Print 1920×1080 foi centralizado em
   `scene-print-renderer.ts`, usando o mesmo `renderStudioCharacter`, cache,
   ordem de camadas e tipografia do Studio. O salvamento continua no mesmo
   diretório local e com o mesmo nome de arquivo.
5. Clipboard, tradução, autosave e feedback continuam sendo controlados pela
   página, mas o inspetor recebe callbacks explícitos e mantém os botões
   independentes de seleção; isso evita acoplamento e preserva mensagens,
   estados de carregamento e fallback existentes.
6. Testes de fonte cobrem a composição dos componentes, histórico, operações
   de cena, Print compartilhado, clipboard e criação de balões. A suíte inteira
   passa com build, typecheck e lint sem erros.

Aceite validado: 42 testes passam; `npm run typecheck`, `npm run build` e
`npm run lint` passam (os 13 avisos são apenas a recomendação existente para
`<img>`). Nenhuma rota, persistência, exportação ou ação do Studio foi removida.

Rollback: o commit anterior à fase 5 permanece disponível; os novos módulos
podem ser removidos e a página pode voltar aos trechos inline sem tocar no
Criador ou em Roteiros.

## Fase 6 — Roteiros por fatias (concluída)

Objetivo: reduzir o acoplamento do editor de Roteiros e tornar os fluxos de
vídeo, IA e exportação verificáveis sem mudar os contratos públicos da tela.

Entregas realizadas:

1. O schema runtime em `app/domain/document-schemas.mjs` agora normaliza e
   valida perfis, roteiros, TikToks, vídeos, blocos e envelopes de exportação.
   O mesmo normalizador continua sendo usado pelo cliente e por
   `services/roteiros/service.mjs`, preservando campos futuros desconhecidos.
2. Operações de roteiro e blocos foram centralizadas em `app/roteiros/commands.ts`:
   atualização, inclusão, ordenação, exclusão, duplicação e patch de blocos.
   A página conserva os callbacks públicos e delega mutações a esses comandos.
3. A lista de blocos foi extraída para
   `app/roteiros/components/ReactionBlockList.tsx`. Os controles de personagem,
   tipo, emoção, texto, tradução, regeneração, ordenação, duplicação e exclusão
   continuam interativos e mantêm o fallback visual de fotos inválidas.
4. O envelope versionado de exportação foi formalizado em
   `app/roteiros/export-contract.ts` (`GACHA_PREMIUM_ROTEIROS_V1`, versão 1).
   O botão JSON do editor usa esse contrato sem alterar o formato do roteiro
   interno nem as exportações locais existentes.
5. Upload, prévia e remoção de vídeo continuam ligados ao TikTok correto; o
   servidor mantém leitura `Range`, limites de upload, exportação de vídeos,
   texto e personagens e abertura de pastas sem ampliar os caminhos aceitos.
6. A IA recebeu timeout uniforme de 150 s no serviço e timeout/cancelamento por
   `AbortController` no cliente. O usuário pode cancelar geração, melhoria,
   regeneração ou tradução; desmontar o TikTok também cancela a requisição.
   O limite de duas gerações simultâneas foi preservado.
7. O fixture `tests/fixtures/roteiro-export-v1.json` e os testes de schema
   validam o envelope contra um documento representativo do fluxo externo.
   Testes de fonte cobrem componentes, comandos, upload/Range/remove,
   exportações e cancelamento sem exigir um servidor externo de IA.

Aceite validado:

- 45 testes unitários/regressão passam;
- `npm run typecheck` passa;
- `npm run lint` passa sem erros (os avisos são apenas recomendações de
  otimização de `<img>` já presentes nas telas locais);
- `npm run build` passa;
- o Gacha Premium original não foi acessado para escrita.

Limites conscientemente preservados para as próximas fases: o TikTok ainda é
orquestrado pelo `RoteiroEditor.tsx` e a suíte de interação real do navegador
continua planejada para a fase 8 (Playwright). A fase 6 não altera a persistência
canônica nem inicia a migração para SQLite.

## Fase 7 — Persistência única e recuperação (concluída)

1. O PC é a fonte canônica em `dados-locais-premium/roteiros/estado.json`.
   `writeJsonAtomic` e a fila do serviço impedem JSON parcial e gravações
   concorrentes.
2. O navegador mantém somente o journal versionado
   `gacha-premium-roteiros-recovery-v1`, limitado a 24 entradas. O mirror
   `gacha-premium-roteiros-emergency-v1` foi preservado apenas como fallback de
   leitura para compatibilidade.
3. A aba **IA e regras** agora lista backups, cria backup manual e restaura uma
   versão com confirmação. Restaurações criam automaticamente um backup de
   segurança do estado atual.
4. O serviço recupera o último backup válido quando `estado.json` está
   corrompido, movendo o arquivo original para uma quarentena com timestamp.
   Nomes e caminhos de backup são validados.
5. Testes cobrem journal, quota/storage corrompido, backup/restore, recuperação
   após JSON inválido, gravações concorrentes e ausência de temporários órfãos.
6. A estratégia histórica de migração está documentada em
   `docs/ROTEIROS_RECOVERY.md`; não há importação automática do RAMIFICADO V2.

Aceite validado: 50 testes unitários/regressão passam, typecheck passa e lint
passa sem erros. Os nove avisos restantes são recomendações pré-existentes de
otimização de `<img>`.

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
