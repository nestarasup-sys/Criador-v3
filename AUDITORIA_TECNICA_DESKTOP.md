# Auditoria técnica e plano de migração para desktop

**Projeto auditado:** `C:\TRABALHO 2\gacha maker - premium`  
**Data da auditoria:** 1 de agosto de 2026  
**Objetivo:** transformar o GACHA MAKER PREMIUM em um aplicativo desktop instalável, profissional, seguro e sustentável, mantendo o projeto web atual intacto durante a reconstrução.  
**Escopo desta entrega:** auditoria e planejamento. Nenhuma implementação ou alteração funcional foi realizada.

## Resumo executivo

O projeto atual já contém uma quantidade relevante de lógica reutilizável: composição de personagens com Canvas, chroma key, recorte de folhas, transformações por camada, máscaras de borracha, exportação de personagens, Studio, Roteiros, integração local com Ollama/LM Studio e armazenamento no computador. A interface React e boa parte dos tipos e algoritmos podem ser reaproveitados.

O principal problema não é a interface web em si, mas o modo como ela foi crescendo ao redor de um navegador e de um servidor Node auxiliar. Hoje existem dois processos, duas portas, três mecanismos de persistência e vários caminhos fixos do computador do autor. Isso dificulta instalação, recuperação de dados, segurança, testes e manutenção.

**Recomendação final:** criar um projeto desktop separado usando **Tauri 2 + React 19 + TypeScript + Vite + Rust + SQLite**, migrando a aplicação por módulos. O frontend deve ser uma SPA estática; operações de sistema, dados e arquivos devem passar por comandos Tauri com permissões mínimas. Arquivos grandes permanecem no disco e metadados transacionais vão para SQLite.

Electron é a alternativa de contingência caso uma prova visual revele diferenças inaceitáveis entre o WebView2 e o navegador atual. Ele exige menos adaptação imediata do servidor Node, mas produz uma aplicação maior, consome mais memória e aumenta a superfície de atualização e segurança. Wails e Neutralino são tecnicamente viáveis, porém oferecem menos vantagem para este projeto específico.

Antes da migração, há bloqueadores P0 no projeto atual: erros de TypeScript e lint, vulnerabilidades conhecidas em dependências de produção, ausência de uma fonte única de verdade para dados, gravação de JSON sem atomicidade e falta de testes comportamentais do pipeline gráfico.

---

## 1. Resumo da arquitetura atual

### 1.1 Tecnologias

| Camada | Tecnologia atual | Observação |
|---|---|---|
| Interface | React 19.2.6 e Next 16.2.6 | Páginas majoritariamente client-side |
| Build local | Vinext 0.0.50, Vite 8.0.13 | Também contém configuração Cloudflare |
| Linguagem | TypeScript 5.9.3 e JavaScript ESM | `strict: true`, mas o typecheck não passa |
| Estilo | CSS Modules, CSS global e Tailwind/PostCSS | O uso de Tailwind não é central |
| Imagens | Canvas 2D, Blob, Object URLs | Processamento pesado no renderer/browser |
| ZIP | JSZip 3.10.1 | Compressão feita no frontend |
| Persistência | JSON em disco, arquivos, IndexedDB e LocalStorage | Fontes paralelas e reconciliação manual |
| Serviço local | Node `http` em `127.0.0.1:4318` | Acesso a arquivos, exportação e IA local |
| IA | Ollama e LM Studio locais | URLs limitadas a localhost no módulo de Roteiros |
| Hospedagem opcional | Vinext/Cloudflare Worker | Não é necessária para o desktop local |

### 1.2 Estrutura funcional

```text
Navegador em localhost:9099
├── Criador de Personagens
│   ├── modelos e packs de expressão
│   ├── cabelo, roupa, rosto e variantes
│   ├── ajustes, máscaras e chroma key
│   └── composição e exportação ZIP
├── Studio
│   ├── personagens, fundo e objetos
│   ├── balões e tradução local
│   └── captura de cena
└── Roteiros
    ├── fichas de personagens
    ├── TikToks e blocos de reação
    ├── vídeos locais
    └── geração e tradução por IA local

Servidor Node em 127.0.0.1:4318
├── estado e catálogo em JSON/arquivos
├── imagens, vídeos, fotos e backups
├── acesso ao Explorer e pastas externas
├── integração com Ollama/LM Studio
└── rotas legadas do Video Maker
```

### 1.3 Inicialização atual

O arquivo `INICIAR-GACHA-PREMIUM.bat`:

1. encerra um processo Node que esteja ocupando a porta 4318 e corresponda ao servidor local;
2. inicia `local-data-server.mjs` oculto;
3. espera quatro segundos e abre `http://localhost:9099/`;
4. executa `npm run dev` no terminal.

Isso é um ambiente de desenvolvimento, não um runtime de produção. O usuário precisa ter Node/npm e todas as dependências instaladas. Não há gerenciamento formal de PID, encerramento coordenado, crash recovery, instância única ou verificação robusta de saúde.

Há divergência de portas: `vite.config.ts` usa 9098, enquanto `package.json`, launcher e CORS usam 9099. O README também está desatualizado e cita nomes/pastas anteriores.

### 1.4 Persistência atual

Há três caminhos simultâneos:

- servidor local: `dados-locais-premium`, incluindo JSON, arquivos, vídeos e backups;
- IndexedDB: catálogo e packs de expressão;
- LocalStorage: personagens, Studios e espelho emergencial dos Roteiros.

O Studio mescla dados do navegador com dados do PC usando `updatedAt` e registros de exclusão. O Roteiros mantém um espelho no LocalStorage. A estratégia reduz perda quando o servidor está indisponível, mas cria situações de conflito, dados órfãos e comportamento diferente entre navegadores.

### 1.5 Volume atual

Valores observados na máquina auditada:

| Área | Arquivos | Tamanho aproximado |
|---|---:|---:|
| `app` | 20 | 0,51 MB |
| `public` | 463 | 63,11 MB |
| `dados-locais-premium` | 292 | 104,14 MB |
| `dist` | 512 | 65,97 MB |
| `node_modules` | 29.810 | 684,73 MB |

O pacote de instalação não deve incluir `node_modules`, builds antigos, backups nem dados pessoais. Assets de fábrica e dados do usuário precisam ser separados.

### 1.6 Partes reutilizáveis

**Reutilização alta:**

- componentes visuais React e CSS;
- tipos do Studio e Roteiros;
- lógica de composição em Canvas;
- chroma key, proteção de cores e recorte de folhas;
- transformações, camadas e máscaras;
- parser/organização dos packs de expressão;
- construção de ZIP e frames finais, depois de movida para um serviço dedicado;
- modelos de Roteiros, prompts e integração conceitual com IA local.

**Reutilização com adaptação:**

- `app/page.tsx`: os algoritmos são úteis, mas precisam ser extraídos do componente monolítico;
- `local-data-server.mjs`: serve como especificação de comportamento, não como backend definitivo;
- módulos `storage.ts`: contratos e regras de migração podem ser preservados, mas HTTP/LocalStorage devem ser substituídos;
- rotas de abertura/exportação de pastas: viram comandos nativos;
- configuração Ollama/LM Studio: vira cliente nativo restrito a loopback.

**Não migrar para o runtime desktop:**

- Vinext, Wrangler e o Worker Cloudflare;
- `.openai/hosting.json` e artefatos de hospedagem;
- launcher `.bat` e servidor HTTP em porta fixa;
- autenticação por cabeçalhos `oai-authenticated-*`, específica da hospedagem;
- rotas antigas do Video Maker que não pertencem mais ao produto atual;
- artefatos `dist`, `build`, `.vinext`, `.wrangler` e `node_modules`.

---

## 2. Problemas, riscos e débitos técnicos

### 2.1 Bloqueadores de qualidade

Na auditoria foram executados `npm run lint`, `npx tsc --noEmit --incremental false`, `npm ls --depth=0`, `npm outdated --json` e `npm audit --omit=dev`.

- **TypeScript falha:** quatro erros, dois no Studio por `string | undefined` e dois no Worker por tipos Cloudflare ausentes.
- **Lint falha:** três erros de atualização síncrona de estado dentro de efeitos, além de dez avisos.
- **Dependências de produção:** o audit reportou três pacotes vulneráveis de severidade alta na árvore de produção. O Next 16.2.6 possui correção indicada em 16.2.12, incluindo avisos de SSRF, negação de serviço e bypass de autorização.
- **Não há script `typecheck`** no `package.json`.
- **O build sozinho não garante integridade:** Vinext consegue gerar uma saída mesmo com problemas que o TypeScript e ESLint detectam.

Prioridade: **P0 antes da primeira versão desktop**.

### 2.2 Monólito de interface

`app/page.tsx` possui aproximadamente 4.453 linhas e 214 KB. Ele concentra estado visual, persistência, processamento de imagem, importação, exportação, máscaras, catálogo e regras de domínio.

Consequências:

- alteração pequena pode quebrar fluxos não relacionados;
- testes unitários exigem montar a página inteira;
- re-renderizações são difíceis de rastrear;
- lógica não pode ser usada facilmente por workers ou backend nativo;
- onboarding e manutenção ficam caros.

### 2.3 Persistência fragmentada

Problemas observados:

- três fontes de verdade concorrentes;
- fusão baseada em datas do relógio local;
- gravação do `state.json` diretamente com `writeFile`, sem arquivo temporário + `fsync` + rename atômico;
- metadados e arquivos não são confirmados em uma única transação;
- possibilidade de arquivo órfão ou estado apontando para arquivo ausente;
- backups por intervalo, não por transação crítica;
- estrutura de dados validada manualmente, sem schema de runtime e migrações formais;
- `drizzle.config.ts` aponta para `db/schema.ts`, mas esse schema não foi encontrado e Drizzle não está efetivamente implantado.

### 2.4 Segurança local

Pontos positivos existentes:

- servidor vinculado a `127.0.0.1`, não à rede inteira;
- sanitização de IDs e nomes de pasta;
- verificações para impedir saída do diretório permitido;
- limite de corpo em diversas rotas;
- validação de assinatura PNG em uploads importantes;
- URLs de Ollama/LM Studio limitadas a `localhost` e `127.0.0.1`.

Riscos:

- o servidor aceita operações destrutivas sem token de sessão ou autenticação;
- a política CORS aceita qualquer porta em localhost/127.0.0.1;
- uma página maliciosa servida localmente pode tentar chamar as rotas;
- não há CSP explícita nem política desktop de navegação;
- abertura de pastas e execução de FFmpeg são expostas por uma API HTTP ampla;
- há caminhos absolutos com nome do usuário e integrações externas fixas;
- não existe log de auditoria das operações nativas;
- não há segregação explícita entre comandos somente leitura e comandos mutáveis.

No desktop, o servidor HTTP deve desaparecer. O frontend deve acessar somente comandos nativos autorizados e tipados.

### 2.5 Desempenho e memória

- operações grandes de Canvas executam na thread da interface;
- composição usa canvases 1920×1080 e canvases intermediários maiores;
- recorte, chroma key, máscaras e geração de fotos percorrem pixels no renderer;
- ZIP é criado no frontend;
- dezenas de `URL.createObjectURL` aumentam o risco de URLs não revogadas e memória retida;
- não foram encontrados Web Workers ou OffscreenCanvas;
- salvamento automático, geração de foto e atualização da prévia podem competir entre si;
- grandes vídeos e imagens podem ser lidos integralmente antes da gravação;
- a pasta pública contém assets duplicados/legados e a build replica grande parte deles.

### 2.6 Integração com o sistema operacional

- somente Windows está realmente contemplado no servidor (`explorer.exe`, caminhos `C:\...`);
- pastas de exportação são fixas e não selecionadas pelo usuário;
- ausência de diálogos nativos de arquivo/pasta;
- ausência de lock de instância única;
- encerramento do frontend não encerra formalmente o processo de dados;
- não há logs rotativos, crash reports locais ou tela de diagnóstico;
- FFmpeg depende de estar disponível externamente no PATH em rotas legadas.

### 2.7 Build e configuração

- coexistem Next, Vinext, Vite, Cloudflare Worker, Wrangler e Drizzle, embora o produto local não precise de todos;
- a versão Vinext atual é pré-1.0 e a mais recente encontrada ainda é beta;
- README, launcher e configurações divergem;
- não foi detectado repositório Git na raiz auditada;
- não há CI/CD, política de releases, versionamento de schema ou changelog;
- não há configuração de instalador, assinatura, updater ou SBOM.

### 2.8 Testes insuficientes

Existem testes úteis do serviço de Roteiros, mas grande parte da suíte verifica strings e expressões regulares no código-fonte. Isso confirma que determinado texto existe, não que o fluxo funciona.

Faltam:

- testes unitários dos algoritmos de imagem;
- imagens douradas e comparação visual com tolerância;
- teste real de importação → ajuste → salvamento → reinício → exportação;
- teste de corrupção/queda durante gravação;
- migração de dados antigos;
- integração com Ollama/LM Studio simulados;
- testes do instalador, atualização e desinstalação;
- testes em WebView2, WKWebView e WebKitGTK.

---

## 3. Comparação das principais soluções

### 3.1 Critérios

Pesos propostos para este projeto:

| Critério | Peso |
|---|---:|
| Reutilização do React/TypeScript/Canvas | 25% |
| Integração segura com arquivos e SO | 20% |
| Memória e tamanho do instalador | 15% |
| Manutenção e clareza arquitetural | 15% |
| Consistência visual/renderização | 10% |
| Atualização, assinatura e distribuição | 10% |
| Multiplataforma | 5% |

### 3.2 Tabela comparativa

| Opção | Reutilização | Tamanho/memória | Segurança | Distribuição | Custo de migração | Adequação |
|---|---|---|---|---|---|---|
| **Tauri 2** | Alta no frontend; backend refeito | Excelente, usa webview do SO | Forte modelo de capabilities/commands | NSIS/MSI, DMG, AppImage/deb/rpm e updater assinado | Médio/alto | **Melhor arquitetura final** |
| **Electron** | Muito alta; Node reaproveitável | Instalador e RAM maiores por incluir Chromium/Node | Boa se endurecido; perigosa se APIs forem expostas | Ecossistema muito maduro | Baixo/médio | Melhor plano B e caminho mais rápido |
| **Wails 2** | Alta no frontend; backend refeito em Go | Leve, usa webview do SO | Boa com bindings explícitos | Build simples, ecossistema menor | Alto | Viável, sem vantagem clara sobre Tauri |
| **Neutralinojs** | Alta no frontend | Muito leve | Allowlist nativa; comunicação HTTP/WebSocket interna | Instaladores e updater menos maduros | Médio | Bom para apps menores; fraco para este produto |
| **PWA/browser** | Máxima | Sem shell próprio | Sandbox do navegador | Instalação simples | Baixo | Não atende bem arquivos, pastas, backup e integração local |
| **.NET/Avalonia/Qt** | Baixa | Variável | Forte | Madura | Muito alto | Reescrita quase total sem benefício proporcional |

### 3.3 Tauri 2

Vantagens:

- reaproveita React, TypeScript, CSS e Canvas;
- usa WebView2 no Windows, WKWebView no macOS e WebKitGTK no Linux;
- elimina Chromium/Node empacotados e reduz tamanho e memória;
- comandos Rust tipados substituem o servidor local;
- capabilities permitem liberar somente arquivos, pastas e comandos necessários;
- plugins oficiais para filesystem, diálogo, opener, single-instance, SQL, logging e updater;
- updater gera bundles assinados nos três sistemas.

Limitações:

- atua como host estático e não suporta SSR nativamente; a documentação recomenda SPA/SSG e Vite. Portanto, o projeto precisa sair de Next/Vinext para React/Vite ou usar export estático estrito ([configuração de frontend do Tauri](https://v2.tauri.app/start/frontend/));
- exige Rust e toolchains de cada plataforma;
- o webview varia entre sistemas, exigindo testes visuais;
- no Windows, o runtime depende do WebView2, presente nas versões modernas mas ainda parte da estratégia de instalação ([pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/)).

### 3.4 Electron

Vantagens:

- maior compatibilidade imediata com Next/Node;
- Chromium fixo oferece renderização consistente do Canvas entre sistemas;
- ecossistema de empacotamento, crash reporting e atualizações muito maduro;
- Electron Forge é a ferramenta recomendada oficialmente para empacotamento ([distribuição do Electron](https://www.electronjs.org/docs/latest/tutorial/application-distribution)).

Limitações:

- cada aplicação inclui Chromium e Node; até uma aplicação mínima acompanha o tamanho do binário Electron ([Electron Packager](https://packages.electronjs.org/packager/v20.0.1/index.html));
- maior consumo de RAM e superfície de atualização;
- exige arquitetura main/preload/renderer e IPC rigorosamente validada;
- a documentação exige Node integration desativada, context isolation, sandbox, CSP, validação de sender e navegação restrita ([checklist de segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security));
- updater embutido cobre Windows e macOS, enquanto Linux normalmente depende do gerenciador de pacotes ([autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)).

### 3.5 Wails

Wails combina frontend web com backend Go e gera bindings TypeScript. Produz binário com assets embutidos e usa o webview do sistema ([arquitetura do Wails](https://wails.io/docs/howdoesitwork/)). É uma alternativa legítima, mas introduzir Go não reduz o trabalho em relação a Rust/Tauri e o ecossistema de plugins, atualizações e permissões é menos alinhado ao projeto.

### 3.6 Neutralinojs

Neutralino é muito leve e usa um núcleo C++ com webview e comunicação HTTP/WebSocket ([arquitetura do Neutralino](https://neutralino.js.org/docs/contributing/architecture/)). Porém, a documentação de distribuição ainda direciona partes do empacotamento a scripts comunitários e informa que guias oficiais de instaladores não estão completos ([distribuição do Neutralino](https://neutralino.js.org/docs/distribution/overview/)). Para um app com dados críticos, imagens, vídeos, IA local e updater, essa economia não compensa a menor maturidade operacional.

---

## 4. Recomendação final

### Escolha: Tauri 2 com frontend React/Vite e backend Rust

Esta opção entrega a melhor combinação de:

- reaproveitamento visual e dos algoritmos TypeScript;
- menor instalador e consumo de RAM;
- integração nativa sem servidor/portas;
- armazenamento transacional;
- permissões mínimas e auditáveis;
- instaladores e atualizações oficiais multiplataforma;
- base sustentável para recursos futuros.

### Condição de aprovação técnica

Antes da migração completa deve existir um **spike de paridade visual**:

1. abrir no Tauri uma cena representativa do Criador e outra do Studio;
2. gerar PNGs com WebView2 e comparar pixel a pixel com o navegador atual;
3. testar fontes, transparência, chroma, máscaras, zoom e exportação ZIP;
4. medir memória, tempo de primeira abertura e tempo de composição;
5. repetir um conjunto mínimo no macOS e Linux se esses sistemas forem realmente alvo.

Critério sugerido: nenhuma diferença funcional e diferença visual média inferior ao limite definido nos golden tests. Se o WebView causar divergências incontornáveis, usar **Electron** mantendo a mesma arquitetura de domínio e persistência. Assim, o investimento de refatoração não é perdido.

---

## 5. Arquitetura proposta para a versão desktop

### 5.1 Visão geral

```text
GACHA MAKER PREMIUM Desktop
├── Frontend React/Vite (WebView)
│   ├── Creator
│   ├── Studio
│   ├── Roteiros
│   ├── componentes compartilhados
│   ├── domínio TypeScript puro
│   └── workers de imagem/ZIP
├── Ponte Tauri
│   ├── comandos tipados
│   ├── events/progress
│   └── capabilities por janela
├── Core Rust
│   ├── repositórios e migrações
│   ├── filesystem seguro
│   ├── importação/exportação
│   ├── cliente Ollama/LM Studio
│   ├── backups e recuperação
│   └── logs e diagnóstico
└── Dados do usuário
    ├── SQLite (metadados)
    ├── assets/ (PNG, ZIP, MP4)
    ├── backups/
    ├── exports/
    └── logs/
```

### 5.2 Organização sugerida do novo repositório

```text
gacha-maker-premium-desktop/
├── apps/
│   └── desktop/
│       ├── src/                 # React/Vite
│       ├── src-tauri/           # Rust/Tauri
│       └── capabilities/
├── packages/
│   ├── domain/                  # tipos e regras puras
│   ├── image-engine/            # Canvas, chroma, masks, sheets
│   ├── creator/
│   ├── studio/
│   ├── scripts/
│   └── ui/
├── migrations/
├── fixtures/
│   ├── images/
│   └── legacy-data/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── visual/
│   └── e2e/
├── scripts/
├── docs/
└── .github/workflows/
```

O projeto web atual permanece intacto. A nova pasta recebe cópias controladas dos módulos depois que cada comportamento estiver coberto por teste.

### 5.3 Frontend

- React 19 + TypeScript strict + Vite;
- rotas client-side simples;
- componentes menores por domínio;
- estado de documento separado de estado efêmero da UI;
- autosave por fila com revisão monotônica, não por vários `useEffect` independentes;
- operações pesadas em Web Worker/OffscreenCanvas quando suportado;
- revogação centralizada de Object URLs;
- cache de imagens com limite LRU;
- nenhum acesso direto a Node, shell ou filesystem.

### 5.4 Backend nativo

Comandos agrupados por domínio, por exemplo:

- `characters.list/get/save/delete/export`;
- `catalog.import/list/delete`;
- `studios.save/load/export_image`;
- `scripts.save/load/video_add/video_remove`;
- `ai.models/test/generate/translate/unload`;
- `system.choose_folder/open_path/diagnostics`.

Cada comando deve:

- validar payload e versão do schema;
- operar apenas em diretórios autorizados;
- retornar erros tipados e mensagens amigáveis;
- registrar operação, duração e falha sem gravar conteúdo sensível;
- nunca aceitar caminho arbitrário vindo do frontend sem validação/capability.

### 5.5 Armazenamento

**SQLite:** personagens, catálogos, packs, Studios, Roteiros, configurações, revisões, referências de assets e histórico de migrações.

**Arquivos:** PNG, MP4, ZIP, thumbnails e exportações. Não colocar blobs grandes no banco.

Estrutura por plataforma usando o diretório de dados da aplicação:

```text
Gacha Maker Premium/
├── database/app.sqlite3
├── assets/{characters,catalog,studio,scripts}/
├── thumbnails/
├── exports/
├── backups/
├── logs/
└── settings.json
```

Regras:

- transação SQLite confirma metadados somente depois que o arquivo temporário foi escrito e renomeado;
- nomes físicos baseados em UUID/hash, nomes de exibição ficam no banco;
- foreign keys e índices ativados;
- `PRAGMA user_version` ou tabela formal de migrações;
- backup consistente por checkpoint do SQLite + cópia dos assets referenciados;
- verificação de integridade na inicialização e ferramenta “Diagnóstico e reparo”.

### 5.6 Migração dos dados atuais

Na primeira abertura:

1. detectar `dados-locais-premium` somente em local escolhido ou confirmado pelo usuário;
2. criar backup imutável antes da importação;
3. ler e validar JSON antigo;
4. importar assets com hash para eliminar duplicados;
5. registrar correspondência ID antigo → ID novo;
6. gerar relatório de importados, ignorados, duplicados e inválidos;
7. não apagar nem modificar a pasta antiga;
8. permitir reexecutar importação idempotente.

IndexedDB/LocalStorage dependem do perfil do navegador. A migração deve oferecer uma pequena versão exportadora no app web atual ou importar um backup JSON explicitamente escolhido; o desktop não deve tentar vasculhar perfis de navegadores.

### 5.7 IA local

- manter suporte a Ollama e LM Studio;
- permitir apenas endpoints loopback por padrão;
- testar conexão e listar modelos;
- timeout, cancelamento e limites de resposta;
- fila única para o modelo de tradução do Studio;
- descarregamento ao sair do módulo quando suportado;
- prompts versionados no projeto;
- nunca empacotar modelos de IA no instalador inicial;
- opção avançada para permitir outro host, acompanhada de aviso explícito.

---

## 6. Plano de migração por etapas

### Etapa 0 — congelar e proteger o estado atual (P0)

- criar o novo repositório/pasta desktop separado;
- colocar o código sob Git;
- inventariar dados e gerar checksums;
- documentar fluxos críticos com vídeos e screenshots;
- definir fixtures sem dados pessoais;
- corrigir vulnerabilidades, typecheck e lint no código que será copiado;
- eliminar segredos e caminhos pessoais das fixtures.

**Saída:** baseline reproduzível e suite mínima verde.

### Etapa 1 — extrair domínio e motor gráfico (P0)

- quebrar `app/page.tsx` em módulos;
- mover funções puras de imagem para `image-engine`;
- criar contratos de storage e OS bridge;
- criar testes unitários e golden images;
- centralizar gestão de Blob/Object URL;
- introduzir cancelamento e progresso para operações longas.

**Saída:** motor executável fora da página principal.

### Etapa 2 — prova Tauri (gate de tecnologia) (P0)

- shell Tauri mínimo com React/Vite;
- Creator e Studio com fixtures;
- teste de Canvas/WebView2;
- medição de RAM, startup e exportação;
- teste de diálogos, clipboard, abertura de pasta e single instance;
- decisão definitiva Tauri versus Electron.

**Saída:** relatório de paridade aprovado.

### Etapa 3 — persistência desktop (P0)

- schema SQLite e migrações;
- repositórios Rust;
- escrita atômica de assets;
- backup e restauração;
- importador idempotente do estado antigo;
- remover dependência de HTTP, IndexedDB e LocalStorage para dados principais.

**Saída:** reiniciar o app não perde nem duplica dados.

### Etapa 4 — migrar Criador de Personagens (P1)

- catálogo, modelos, expressões e variantes;
- máscaras e ferramentas de ajuste;
- importações item/folha;
- geração de foto;
- exportação ZIP;
- testes de compatibilidade com personagens existentes.

### Etapa 5 — migrar Studio (P1)

- cenas, personagens, objetos, balões e prints;
- tradução local;
- persistência de layout;
- exportação para pasta selecionada;
- testes visuais 1920×1080.

### Etapa 6 — migrar Roteiros (P1)

- fichas, scripts, TikToks, vídeos e blocos;
- IA local;
- exportações e abertura de pastas;
- histórico e recuperação.

### Etapa 7 — desempenho e robustez (P1)

- Web Workers e cache LRU;
- thumbnails e carregamento sob demanda;
- ZIP e cópias grandes fora da thread da UI;
- telemetria local opt-in ou diagnóstico exportável;
- testes de carga com centenas de assets.

### Etapa 8 — empacotamento e beta Windows (P0 para release)

- NSIS por usuário;
- assinatura de código;
- updater assinado em canal beta;
- migração real em cópia de dados;
- instalação limpa, atualização, rollback e desinstalação;
- beta fechado antes do canal estável.

### Etapa 9 — macOS e Linux (P2)

- somente após estabilizar Windows;
- corrigir diferenças de webview/fontes;
- builds nativas em runners de cada sistema;
- assinatura/notarização macOS;
- AppImage/deb e política de atualização Linux.

---

## 7. Instalação e desinstalação

### 7.1 Windows

Recomendação inicial: **NSIS `setup.exe`, instalação por usuário**, sem exigir administrador. MSI fica como opção posterior para ambientes corporativos. O Tauri suporta NSIS e MSI ([Windows Installer](https://v2.tauri.app/distribute/windows-installer/)).

O instalador deve:

- verificar/instalar WebView2 Evergreen quando necessário;
- instalar em `%LOCALAPPDATA%\Programs\Gacha Maker Premium`;
- criar atalhos opcionais;
- registrar protocolo interno somente se houver uso real;
- não copiar dados pessoais para a pasta do programa;
- não depender de Node/npm/Rust na máquina do usuário;
- exibir versão, publicador e licença;
- iniciar o app e oferecer importação do projeto web.

### 7.2 Desinstalação

Por padrão:

- remover binários, atalhos e integração do sistema;
- **preservar dados do usuário**;
- oferecer opção separada “Remover também meus dados” com confirmação e tamanho estimado;
- permitir exportar backup antes da remoção;
- nunca apagar pastas externas de exportação ou a instalação web antiga.

### 7.3 macOS

- distribuir `.dmg` com `.app` universal ou builds arm64/x64;
- dados em `Application Support`;
- preferências em local apropriado do sistema;
- remoção do `.app` não apaga automaticamente os projetos do usuário.

### 7.4 Linux

- AppImage para distribuição direta;
- `.deb` para Debian/Ubuntu;
- avaliar Flatpak apenas quando permissões de filesystem estiverem bem definidas;
- dados conforme XDG (`$XDG_DATA_HOME`, `$XDG_CONFIG_HOME`).

---

## 8. Atualizações automáticas e rollback

### 8.1 Atualização

Usar o plugin oficial de updater do Tauri:

- canais `beta` e `stable` separados;
- manifesto servido somente por HTTPS;
- artefatos e manifesto assinados;
- chave privada exclusivamente no cofre do CI;
- checagem alguns segundos após a inicialização, não antes de carregar os dados;
- exibir versão, notas e tamanho;
- baixar em segundo plano;
- instalar apenas com autorização ou no encerramento, conforme preferência;
- bloquear atualização se backup pré-update falhar.

O updater gera artefatos e assinaturas para Windows, macOS e Linux, usando a chave privada apenas no build ([updater do Tauri](https://v2.tauri.app/plugin/updater/)). Essa assinatura do updater é adicional à assinatura de código do sistema operacional.

### 8.2 Compatibilidade de dados

- migrações aditivas sempre que possível;
- manter leitura da versão de schema anterior por pelo menos uma release;
- backup versionado antes da migração;
- nunca rebaixar schema automaticamente;
- registrar `app_version`, `schema_version` e hash do backup;
- executar `PRAGMA integrity_check` antes/depois de migrações importantes.

### 8.3 Rollback

O rollback deve ser explícito; não se deve presumir que o updater faça rollback automático completo.

- manter o instalador anterior no servidor e em uma pasta de recuperação local limitada;
- gravar um marcador de “primeira inicialização saudável” após a atualização;
- se a nova versão falhar antes desse marcador, mostrar um recovery launcher ou instrução para reinstalar a versão anterior;
- restaurar dados somente de backup compatível e sempre preservar a cópia mais nova;
- permitir desativar temporariamente updates automáticos após rollback;
- pausar rollout no servidor quando crash/erros forem detectados no beta.

---

## 9. Assinatura e publicação

### 9.1 Windows

- assinar `.exe`, instalador e, se usado, MSI;
- usar identidade consistente em todas as releases;
- considerar **Microsoft Artifact Signing** para distribuição fora da Store e integração com CI;
- alternativa: certificado OV/EV de autoridade reconhecida conforme regras atuais do fornecedor;
- aplicar timestamp confiável;
- validar assinatura com `signtool verify` no pipeline;
- opcionalmente publicar na Microsoft Store.

A Microsoft informa que a Store evita alertas de download e recomenda Artifact Signing para distribuição externa; mesmo um binário novo assinado pode levar tempo para construir reputação SmartScreen ([orientação oficial do SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).

### 9.2 macOS

- Apple Developer Program;
- certificado Developer ID Application;
- Hardened Runtime e entitlements mínimos;
- assinar todos os binários auxiliares;
- notarizar com `notarytool`/API e anexar o ticket;
- validar com `codesign` e `spctl`;
- gerar e testar DMG em runner macOS.

A Apple exige Developer ID e notarização para distribuição direta moderna; o serviço verifica malware e problemas de assinatura, e o ticket é usado pelo Gatekeeper ([documentação de notarização](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)). A documentação Tauri também exige build/assinatura em dispositivo Apple e credenciais de notarização ([assinatura macOS no Tauri](https://v2.tauri.app/distribute/sign/macos/)).

### 9.3 Linux

- publicar SHA-256 de todos os artefatos;
- assinar repositório `.deb`/`.rpm` com GPG quando houver;
- assinar os artefatos do updater Tauri;
- opcionalmente gerar provenance/Sigstore;
- documentar dependências de WebKitGTK por distribuição;
- não prometer um único pacote universal perfeito para todas as distros.

---

## 10. Testes necessários

### 10.1 Unitários

- parser de modelos, expressões e variantes;
- detecção e recorte de folhas de 1, 4 e 6 peças;
- chroma key, despill e regiões fechadas;
- transformações e matrizes de camada;
- máscaras por corpo, roupa, cabelo frontal e traseiro;
- serialização, migrações e validação;
- nomes seguros e resolução de paths;
- estimativa e geração de thumbnails.

### 10.2 Golden/visuais

- fixture por gênero/modelo;
- comparação PNG do navegador atual versus desktop;
- tolerância separada para antialias de texto e pixels de imagem;
- cenas do Studio com transparência e balões;
- exportações 1920×1080;
- snapshots em Windows, macOS e Linux.

### 10.3 Integração

- criar, salvar, reiniciar e recarregar personagem;
- importar folha, ajustar, apagar, autosave e exportar ZIP;
- adicionar vídeo a TikTok e reabrir;
- fila de autosave sob alterações rápidas;
- falha de disco, arquivo bloqueado e falta de espaço;
- escrita interrompida e restauração de backup;
- Ollama e LM Studio simulados, lentos e indisponíveis;
- paths com acentos, espaços e nomes longos.

### 10.4 E2E desktop

- instalação limpa;
- primeira execução e importação legada;
- instância única;
- abrir pasta e diálogos;
- atalhos, clipboard e drag/drop;
- atualização beta → stable;
- cancelamento de update;
- rollback;
- desinstalação preservando dados;
- desinstalação removendo dados após confirmação.

### 10.5 Segurança

- capabilities Tauri por janela;
- tentativa de path traversal;
- payloads grandes e arquivos falsos;
- links externos e navegação bloqueada;
- CSP sem `unsafe-eval`;
- comandos rejeitam chamadas fora do escopo;
- dependency audit, cargo audit e secret scan;
- assinatura e hash dos artefatos.

### 10.6 Desempenho

Metas iniciais sugeridas para uma máquina semelhante à atual:

- primeira janela utilizável em até 3 s após cache quente;
- idle abaixo de 250 MB de RAM no Windows;
- interação em 60 FPS durante ajustes simples;
- composição 1920×1080 sem congelar a UI por mais de 100 ms;
- catálogo de 500 assets com thumbnails sob demanda;
- autosave sem bloquear a interação;
- zero crescimento contínuo de memória após 50 trocas de asset.

As metas precisam ser confirmadas pelo spike, não tratadas como garantia antecipada.

---

## 11. Estrutura de CI/CD

### 11.1 Pull requests

Executar em toda PR:

1. instalação reprodutível com lockfile;
2. format/lint;
3. TypeScript strict;
4. testes unitários TS e Rust;
5. audit de dependências;
6. build do frontend;
7. build Tauri sem assinatura;
8. testes de integração;
9. golden tests Windows obrigatórios;
10. relatório de tamanho do bundle.

### 11.2 Releases

Matriz nativa:

| Runner | Artefatos |
|---|---|
| `windows-latest` | NSIS e MSI, assinatura Windows |
| `macos-14`/equivalente | arm64/x64/universal, DMG, assinatura e notarização |
| `ubuntu-latest` | AppImage e deb, hashes/assinaturas |

Fluxo:

```text
tag vX.Y.Z
→ testes completos
→ build por sistema
→ assinatura de código
→ notarização macOS
→ testes dos instaladores
→ SBOM + checksums + provenance
→ artefatos de updater assinados
→ canal beta
→ aprovação manual
→ canal stable
```

Segredos no cofre do CI:

- chave do updater Tauri;
- credenciais Microsoft Artifact Signing/certificado;
- certificado e chave Apple;
- credenciais da notarização;
- tokens de publicação.

Nunca armazenar chaves em `.env`, repositório ou build logs. Preferir OIDC/credenciais temporárias quando o provedor suportar.

### 11.3 Governança

- SemVer;
- changelog por release;
- branches protegidas e revisão obrigatória;
- Dependabot/Renovate com PRs testadas;
- SBOM CycloneDX/SPDX;
- política de suporte de schema e rollback;
- releases reproduzíveis dentro do possível;
- retenção controlada de artefatos e backups.

---

## 12. Checklist de implementação

### Fundação

- [ ] Criar pasta/repositório desktop separado
- [ ] Registrar baseline e fixtures
- [ ] Corrigir vulnerabilidades conhecidas
- [ ] Fazer lint e typecheck passarem
- [ ] Remover dependências cloud do runtime desktop
- [ ] Definir schemas versionados

### Refatoração

- [ ] Dividir `app/page.tsx`
- [ ] Extrair image engine puro
- [ ] Criar adapter de armazenamento
- [ ] Criar adapter de sistema operacional
- [ ] Centralizar autosave e erros
- [ ] Centralizar Object URLs e caches

### Prova Tauri

- [ ] Criar React/Vite + Tauri 2
- [ ] Validar Creator e Studio no WebView2
- [ ] Criar golden tests
- [ ] Medir memória e startup
- [ ] Aprovar gate ou acionar Electron como fallback

### Dados

- [ ] Modelar SQLite
- [ ] Criar migrações
- [ ] Implementar escrita atômica
- [ ] Implementar backup/restauração
- [ ] Importar dados legados de forma idempotente
- [ ] Criar diagnóstico e reparo

### Recursos

- [ ] Migrar Criador
- [ ] Migrar Studio
- [ ] Migrar Roteiros
- [ ] Migrar IA local
- [ ] Migrar exportações e seleção de pastas
- [ ] Remover servidor/portas e `.bat`

### Segurança

- [ ] Capabilities mínimas
- [ ] CSP restritiva
- [ ] Validar todos os comandos e paths
- [ ] Bloquear navegação externa não autorizada
- [ ] Redigir logs sensíveis
- [ ] Auditar dependências TS e Rust

### Distribuição

- [ ] Ícones e identidade do app
- [ ] NSIS por usuário
- [ ] Assinatura Windows
- [ ] Updater beta/stable
- [ ] Backup pré-update e rollback testado
- [ ] DMG assinado/notarizado
- [ ] AppImage/deb assinados
- [ ] CI/CD e SBOM

### Qualidade

- [ ] Unitários
- [ ] Integração
- [ ] E2E desktop
- [ ] Golden tests
- [ ] Testes de corrupção e falta de espaço
- [ ] Testes de instalação, atualização e desinstalação

---

## 13. Complexidade, riscos e prioridades

### 13.1 Estimativa

Estimativa para uma pessoa com dedicação principal, considerando o estado atual:

| Bloco | Complexidade | Estimativa indicativa |
|---|---|---:|
| Baseline, correções e testes iniciais | Média | 1–2 semanas |
| Extração do domínio/image engine | Alta | 2–4 semanas |
| Spike e shell Tauri | Média | 1–2 semanas |
| SQLite, filesystem e migração | Alta | 3–5 semanas |
| Criador de Personagens | Alta | 3–5 semanas |
| Studio | Média/alta | 2–4 semanas |
| Roteiros e IA local | Média/alta | 2–4 semanas |
| Performance e robustez | Alta | 2–4 semanas |
| Installer/updater/assinatura Windows | Média/alta | 2–3 semanas |
| macOS e Linux | Alta | 3–6 semanas adicionais |

**Faixa realista:** 12–20 semanas para um beta Windows confiável e 16–28 semanas para uma entrega multiplataforma amadurecida. Há sobreposição possível, mas um único desenvolvedor não deve contar as fases como totalmente paralelas.

### 13.2 Maiores riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Diferença de Canvas/fontes entre webviews | Média | Alto | Spike e golden tests antes da migração |
| Perda/corrupção na migração de dados | Média | Crítico | Importação idempotente, backup e relatório |
| Regressão ao dividir o monólito | Alta | Alto | Characterization tests antes de extrair |
| UI travar em operações de imagem/ZIP | Alta | Alto | Workers, progresso, cancelamento e cache |
| Updater + migração impedirem downgrade | Média | Crítico | schema compatível, backup pré-update, beta |
| Assinatura macOS/Windows atrasar release | Média | Médio | preparar contas e CI cedo |
| Integração local de IA variar por máquina | Alta | Médio | timeouts, diagnóstico, adapters e mocks |
| Escopo crescer durante reconstrução | Alta | Alto | paridade primeiro; recursos novos depois |

### 13.3 Prioridades

**P0 — antes de migrar:**

- proteger dados e colocar o novo projeto sob controle de versão;
- corrigir dependências vulneráveis, lint e TypeScript;
- criar characterization/golden tests;
- realizar o gate Tauri;
- projetar schema e migração.

**P1 — beta Windows:**

- Criador, Studio e Roteiros com paridade;
- SQLite, backups, importador e diagnóstico;
- performance básica;
- NSIS assinado e updater beta.

**P2 — pós-beta:**

- macOS/Linux;
- otimizações avançadas;
- Store/Flatpak;
- telemetria opt-in e crash reporting remoto, se desejado.

**P3 — somente após estabilização:**

- novos geradores de assets;
- integrações adicionais com Video Maker;
- sincronização em nuvem;
- colaboração multiusuário.

---

## Decisão recomendada

1. **Não empacotar o projeto atual “como está”.** Isso apenas esconderia dois servidores e problemas de persistência dentro de um instalador.
2. **Manter `gacha maker - premium` intacto como referência funcional.**
3. **Criar `gacha-maker-premium-desktop` separado.**
4. **Reutilizar React/CSS/Canvas e regras de domínio, não a infraestrutura Vinext/Cloudflare/HTTP.**
5. **Usar Tauri 2 como primeira escolha e Electron como fallback condicionado ao teste visual.**
6. **Entregar primeiro um beta Windows**, pois o produto e integrações atuais são fortemente orientados a Windows.
7. **Só iniciar implementação após aprovar o gate, o schema de dados e o plano de migração.**

Essa abordagem exige mais disciplina no início do que envolver o site atual em uma janela, mas produz um aplicativo realmente instalável, previsível, menor, seguro e fácil de evoluir.

