# Arquitetura atual e diagnóstico técnico

## 1. Visão geral

```text
Browser (React 19 / Next 16 via Vinext)
├── /                    Criador de Personagens + Canvas/ImageData
├── /studio              Compositor de cenas
└── /roteiros[/id]       Fichas e editor de roteiros
          │ HTTP loopback
          ▼
Node local-data-server.mjs — 127.0.0.1:6800 + sessão efêmera
├── state.json (app v2)
├── roteiros/state.json (roteiros v1)
├── arquivos binários
├── backups
├── abertura de pastas e exports Windows
└── proxy para Ollama / LM Studio
```

O frontend é compilado por Vinext/Vite com integração Cloudflare/Sites, mas a
operação cotidiana é local: o BAT inicia um servidor Node para os dados e um
servidor web em `localhost:6700`.

## 2. Componentes principais

### Frontend

- `app/page.tsx` — Criador completo, domínio e pipeline de imagem (221 KB).
- `app/globals.css` — estilo global do Criador (60 KB).
- `app/creator/base-packs.ts` — catálogo de modelos base e normalização de
  fontes de expressão.
- `app/creator/creator-storage.ts` — repositório do Criador, autosave,
  hidratação do serviço local e compatibilidade com IndexedDB/localStorage.
- `app/creator/image-processing.ts` e `canvas-processing.ts` — geometria,
  recorte, detecção de folhas e normalização de Canvas sem dependência de UI.
- `app/creator/chroma.worker.ts` e `chroma-worker-client.ts` — chroma key em
  Worker com fallback síncrono.
- `app/creator/components/*` — `CreatorTopbar`, `CreatorLibraryPanel`,
  `CreatorCanvasToolbar` e `CreatorCatalogHeader`, extraídos da página sem
  alterar os contratos dos callbacks existentes.
- `app/studio/page.tsx` e `studio.module.css` — Studio e renderização interativa.
- `app/studio/character-renderer.ts` — composição final de personagem.
- `app/studio/character-export.ts` — ZIP de expressões.
- `app/roteiros/components/*` — home, fichas, configurações, editor e
  `ReactionBlockList` (lista de blocos isolada).
- `app/roteiros/commands.ts` — operações puras de roteiro, TikTok e blocos;
  mantém a página como orquestradora sem duplicar regras de mutação.
- `app/roteiros/export-contract.ts` — envelope versionado do JSON exportado.
- `app/shared/NymiShell.tsx` — navegação principal, marca e indicador de
  conexão compartilhados pelas três áreas.
- `app/roteiros/storage.ts` — gateway do cliente para dados e arquivos.
- `app/lib/local-data-client.ts` — endpoint loopback centralizado.

### Serviço local

- `local-data-server.mjs` — roteamento HTTP, arquivos, compatibilidade e comandos SO.
- `services/roteiros/service.mjs` — persistência e integração de IA de Roteiros.
- `services/storage/atomic-json.mjs` — escrita temporária + rename.
- `services/storage/path-safety.mjs` — validação de IDs e contenção de caminhos.
- `services/storage/file-range.mjs` — streaming parcial de vídeos.

### Assets e modelo base

- `public/models` contém 459 arquivos, aproximadamente 66 MB.
- `public/models/modelos/{feminino,masculino}/modelo-N` é a convenção atual.
- Assets de usuário ficam sob `dados-locais-premium`, ignorados pelo Git.

## 3. Contratos e persistência

### Documento principal

`state.json`, versão 2:

```text
characters[]
catalog[]
expressionPacks[]
studios[]
studioAssets[]
```

O Criador ainda usa IndexedDB (`gacha-maker`, versão 2) e `localStorage`
(`gacha-maker-characters`) como compatibilidade/migração. O Studio usa
`localStorage` como espelho e registra tombstones de exclusão.

### Documento de Roteiros

`roteiros/state.json`, versão 1:

```text
profiles[]
scripts[]
globalRules[]
settings
```

Cada roteiro contém participantes e TikToks; cada TikTok pode referenciar um
vídeo persistido e blocos de fala, pensamento ou reação silenciosa. O schema
runtime normaliza esses documentos tanto no cliente quanto no serviço local e
valida o envelope `GACHA_PREMIUM_ROTEIROS_V1` usado no botão JSON.

### Arquivos

Imagens e vídeos não são embutidos no JSON principal. O serviço devolve URLs
loopback para catálogo, packs, fotos, assets de Studio e mídia. Uploads grandes
de TikTok suportam requisições `Range` na leitura.

## 4. Segurança atual

### Pontos positivos

- Servidor vinculado a `127.0.0.1`, não a todas as interfaces.
- Verificação de origem limita CORS a loopback.
- IDs de rota têm regex restritiva e passam por utilitários de segurança.
- Raízes de escrita são explícitas.
- JSON é escrito atomicamente.
- O comando de abrir pasta recebe alvos semânticos, não um caminho arbitrário do cliente.

### Riscos

| Risco | Impacto | Probabilidade | Observação |
|---|---|---|---|
| Serviço sem token local | Médio | Baixa/média | Outra página em loopback pode tentar chamadas; CORS reduz, mas não autentica processos locais. |
| CORS aceita qualquer porta localhost | Médio | Média | Foi uma correção pragmática; deve haver nonce de sessão na nova arquitetura. |
| Caminhos Windows hardcoded | Alto | Alta | Prints e integração com Video Maker dependem da máquina atual. |
| Corpo de upload sem limite global claro | Alto | Média | Imagens/vídeos malformados ou enormes podem consumir RAM/disco. |
| Dependências vulneráveis | Alto | Alta | `npm audit`: 18 achados (13 altos); há correções sem major para parte dos diretos. |
| Servidor de desenvolvimento em uso normal | Médio | Alta | Aumenta superfície e torna inicialização menos previsível. |
| IA recebe prompt local sem fila/cancelamento uniforme | Médio | Média | O cliente agora cancela com AbortController e o serviço mantém timeout de 150 s; cancelamento cooperativo no provedor ainda depende do encerramento da requisição HTTP. |

Nenhuma atualização de dependência foi aplicada nesta auditoria, pois a política
é preservar o baseline antes de mudanças estruturais.

## 5. Desempenho

### Gargalos

1. Ajustes avançados ainda têm partes síncronas no componente do Criador; o
   chroma key principal já possui Worker e fallback.
2. A página do Studio já não concentra a árvore visual: toolbar, biblioteca,
   canvas, elenco e inspetor vivem em componentes isolados; operações e
   histórico vivem em módulos puros.
3. URLs e blobs são hidratados em lote; catálogos grandes aumentam memória.
4. Serialização completa de snapshots no autosave.
5. CSS e DOM extensos nos editores centrais.
6. O build combina Next, Vinext, Vite, Cloudflare e Wrangler, embora o produto seja local.

### Oportunidades seguras

- Extrair funções puras de imagem sem mudar seus contratos.
- Dividir UI por painéis e aplicar memoização baseada em seletores.
- Usar Web Worker para chroma, recorte e ajustes pesados após testes de paridade.
- Introduzir repositórios tipados e schemas versionados.
- Persistir deltas/entidades em vez de snapshots completos numa fase posterior.

### Studio após a fase 5

```text
app/studio/
├── page.tsx                    orquestra estado, storage e casos de uso
├── components/
│   ├── StudioToolbar.tsx       navegação, ferramentas e inputs de arquivo
│   ├── StudioCanvas.tsx        composição DOM e arraste da cena
│   ├── StudioInspector.tsx     controles de seleção e callbacks
│   └── StudioRoster.tsx        elenco lateral
├── scene-ops.ts                operações puras de cena e camadas
├── history.ts                  undo/redo com snapshots limitados
└── scene-print-renderer.ts     composição Canvas 1920×1080 para Print
```

O `page.tsx` permanece como orquestrador para evitar mudar os contratos de
persistência existentes, mas não duplica a renderização do Print. A prévia DOM
e a exportação Canvas usam o mesmo renderizador de personagem, cache e regras de
camadas; alterações futuras devem entrar primeiro nesses módulos compartilhados.

### Roteiros após a fase 6

```text
app/roteiros/
├── components/
│   ├── RoteirosHome.tsx
│   ├── RoteiroEditor.tsx          orquestra estado e ações de IA
│   └── ReactionBlockList.tsx      campos e ações de cada bloco
├── commands.ts                    mutações puras e ordenação
├── export-contract.ts             envelope JSON versionado
├── storage.ts                     gateway PC, upload/Range e cancelamento
└── useRoteirosData.ts             autosave com fila e espelho de recovery
```

O serviço aplica o mesmo normalizador de `app/domain/document-schemas.mjs`,
mantém backups atômicos e limita a duas chamadas de IA simultâneas. Uploads de
vídeo permanecem fora do JSON, com URL loopback e leitura parcial (`Range`), e
as exportações locais continuam direcionadas aos destinos semânticos existentes.

### Roteiros após a fase 7

`dados-locais-premium/roteiros/estado.json` é a única fonte canônica. O cliente
mantém apenas `gacha-premium-roteiros-recovery-v1` como journal de recuperação
temporário; o mirror `gacha-premium-roteiros-emergency-v1` não recebe novas
gravações. A interface oferece a recuperação de um snapshot pendente e um
gerenciador de backups no PC.

O serviço expõe `GET /roteiros/backups`, `POST /roteiros/backups/create` e
`POST /roteiros/backups/restore`. Ele conserva no máximo 20 backups, cria um
backup de segurança antes de restauração e coloca um `estado.json` corrompido
em quarentena antes de recuperar o backup válido mais recente. A lista de
decisões, migração histórica e limites está em `docs/ROTEIROS_RECOVERY.md`.

## 6. Manutenibilidade

| Problema | Impacto | Risco para corrigir | Prioridade |
|---|---|---:|---:|
| `app/page.tsx` monolítico | Alto | Médio | P0 |
| Tipos duplicados Criador/Studio | Alto | Médio | P0 |
| Cliente e servidor sem schema compartilhado | Alto | Médio | P0 |
| Compatibilidade histórica entre stores | Médio | Médio | P1 |
| Rotas manuais em um servidor de 46 KB | Médio/alto | Médio | P1 |
| Caminhos locais fixos | Alto | Baixo | P1 |
| Testes HTML acoplados a strings | Médio | Médio | P1 |
| Poucos testes reais de Canvas | Alto | Médio | P1 |
| Código Video Maker sem UI | Médio | Baixo | P2/decisão |
| Artefato Python `__pycache__` versionado | Baixo | Baixo | P2 |

## 7. Baseline verificado

- `npm ci`: concluído.
- `npm run lint`: zero erros, nove avisos de `<img>`.
- `npm run typecheck`: passou.
- `npm test`: build passou e 60 testes passaram após a fase 9.
- `npm run test:unit`: 60 testes passam quando o artefato de build já existe;
  os testes de HTML dependem de `dist/server/index.js` e, portanto, devem ser
  executados após `npm run build` em um checkout limpo.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilidades de produção.
  A auditoria completa ainda lista vulnerabilidades de ferramentas de
  desenvolvimento/transitivas; elas não entram no runtime distribuído e não
  foram corrigidas com `--force`.

### Cobertura adicional da fase 8

- `scripts/e2e-check.mjs` valida navegação, foco, criação de roteiro, inclusão
  de TikTok, persistência após recarregar e crescimento de URLs de objeto com
  Chromium real; `scripts/run-e2e.mjs` isola o servidor temporário.
- `tests/phase8-performance.test.mjs` mede a normalização de 100 perfis e 100
  roteiros com seis TikToks e oito blocos por TikTok.
- `scripts/compare-png.mjs` fornece comparação RGBA determinística para
  referências visuais, sem alterar o renderizador.
- `tests/accessibility-contract.test.mjs` verifica foco visível, redução de
  movimento, nomes ARIA e contraste dos tokens principais.
- `tests/bat-smoke.test.mjs` protege o contrato do launcher (loopback,
  portas 6700/6800, serviço oculto e tratamento de erro).
- `tests/phase9-beta.test.mjs` valida cópia/rollback, IA local e carga de
  roteiros com vídeos.
- `scripts/phase9-visual.mjs` captura e compara os goldens do Criador, Studio e
  Roteiros. O E2E usa `scripts/production-server.mjs`, necessário no Windows
  para normalizar os separadores de caminho no cache de arquivos estáticos do
  Vinext 0.0.x.

## 8. Direção arquitetural recomendada

Manter React/TypeScript e reconstruir por fatias dentro deste repositório:

```text
app/
├── domain/        contratos, schemas, IDs, versões e adaptadores (atual)
├── features/      casos de uso por Personagens, Studio e Roteiros (futuro)
└── shared/        UI, canvas, history e erros compartilhados (futuro)
services/
├── storage/       persistência e segurança de arquivos
└── roteiros/      gateway local de IA e documento de Roteiros
```

Durante a transição, `app/domain` é a fonte canônica já consumida pelo frontend
e pelo serviço Node; uma futura mudança física para `src/domain` só será feita
se trouxer benefício real e não quebrar a resolução atual. As rotas permanecem
como adaptadores até cada fatia provar paridade. Não
se recomenda uma reescrita total nem uma troca simultânea do storage.
