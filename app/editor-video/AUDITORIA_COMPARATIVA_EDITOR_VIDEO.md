# Auditoria comparativa — Editor de vídeo do Nymi Gacha

Data da auditoria: 2026-08-11

## 1. Escopo e fontes

Esta auditoria compara:

- o Video Maker original fornecido em `Gacha-Editor-V2-app-current-clean-20260811.zip`;
- a documentação `AUDITORIA_COMPLETA_FUNCIONAMENTO_ATUAL.md`;
- a arquitetura atual do Nymi Gacha em `C:\TRABALHO 2\NYMI GACHA`.

Nenhum arquivo do Studio, Criador de Personagens ou Roteiros foi alterado. O
código Python continua apenas dentro do ZIP e ainda não foi copiado para o
aplicativo web.

## 2. Conclusão executiva

O app original é um editor desktop completo em Python/PySide6. O Nymi Gacha é
um app web local em React/TypeScript/Vinext. Não é seguro copiar as telas ou
tentar executar o Python dentro do Nymi. A reconstrução deve portar os
contratos e o comportamento do pipeline, mantendo a implementação nativa em
TypeScript/Canvas/Node.

O núcleo que precisa ser preservado é:

```text
Projeto JSON
   -> TimelineResolver
   -> SceneRuntime
   -> FrameRenderer
   -> Preview e Exportação
```

A futura integração com Roteiros deve receber os personagens, variantes e
vídeos exportados pelo Nymi, mas o Editor de vídeo deve continuar inicialmente
isolado das outras áreas.

## 3. Arquitetura do Video Maker original

### Tecnologias

- Python 3.12+;
- PySide6 Essentials e Qt Fusion;
- Pillow para composição e imagens;
- NumPy para processamento de pixels;
- PyYAML para leitura compatível de documentos;
- imageio-ffmpeg/FFmpeg para mídia e exportação;
- Ollama local para propostas de IA;
- PyInstaller para release portátil;
- JSON V2 como contrato principal de projeto;
- pytest para testes unitários e de integração.

### Camadas observadas

```text
PySide6 Presentation
        -> Application facade
        -> Domain / Timeline / Scene / Rendering / Media
        -> Persistence / Importing / AI
```

Regras importantes do original:

1. `domain` não conhece Qt, Pillow ou FFmpeg.
2. `TimelineResolver` é a única fonte do tempo efetivo.
3. `SceneRuntime` calcula o estado visual em qualquer instante.
4. `FrameRenderer` é compartilhado por preview e export.
5. `ProjectSession` concentra dirty, histórico, save e recovery.
6. IA só propõe alterações estruturadas; nunca executa comandos ou altera
   arquivos automaticamente.
7. Importação usa plano, staging e troca atômica.

## 4. Arquitetura existente do Nymi Gacha

O Nymi atual utiliza:

- React 19;
- TypeScript;
- Next/Vinext;
- Vite;
- Node.js;
- Canvas 2D;
- CSS Modules;
- servidor local Node para dados do PC;
- JSON/localStorage para persistência e fallback;
- módulos de Studio em `app/studio`;
- módulos de Roteiros em `app/roteiros`;
- contratos canônicos em `app/domain`;
- JSZip para pacotes de personagens;
- testes Node, typecheck e build Vinext.

### Pontos reutilizáveis

| Necessidade | Nymi atual | Estratégia |
|---|---|---|
| Composição de personagem | `app/studio/character-renderer.ts` | Reutilizar conceitos e, quando possível, funções puras; não acoplar o editor ao Studio |
| Assets e expressões | catálogo/modelos do servidor local | Criar adaptador somente leitura para o Editor |
| Roteiros | `app/roteiros` e `roteiro-contract` | Importar/exportar por contrato, sem compartilhar estado de edição diretamente |
| Persistência no PC | `local-data-server.mjs` | Adicionar rotas próprias do Editor, sem misturar documentos |
| ZIP | `JSZip` e exportadores existentes | Reutilizar somente utilitários genéricos |
| Canvas | Canvas 2D atual | Base para preview e seleção de layers |
| Testes | testes Node atuais | Adicionar testes unitários e integração isolados |

## 5. Mapeamento de dados

### 5.1 Projeto original

O original usa `ProjectDocument` imutável com:

- schema version;
- raiz do projeto;
- configurações de resolução/FPS/background;
- personagens e poses;
- estado inicial;
- timeline tipada;
- extensões futuras preservadas.

### 5.2 Personagens

O original modela:

- `asset_dir`;
- poses e expressões;
- default pose/expression;
- posição, escala, âncora, rotação, camada e flip;
- chroma key e auto-trim;
- políticas de blink, talk e fallback.

O Nymi já possui personagens, packs, cabelos, roupas, expressões e variantes,
mas eles usam contratos próprios. O Editor não deve duplicar esses dados. Deve
criar um `CharacterAssetAdapter` que converta o catálogo Nymi para o formato
interno do Editor.

### 5.3 Eventos

O original suporta:

- pause;
- beat;
- dialogue;
- thought;
- state/expression;
- visibility;
- reaction;
- group reaction;
- video com comentários;
- eventos desconhecidos preservados.

Os blocos de Roteiros do Nymi podem gerar diálogo, pensamento e reação, mas a
conversão para eventos de vídeo deve ser explícita e validada.

### 5.4 Vídeos

O original suporta:

- caminho relativo;
- início e fim do clipe;
- áudio ligado/desligado;
- comentários relativos ao vídeo;
- hold do último frame;
- layout, posição e tamanho.

Os vídeos exportados por Roteiros devem ser referenciados por caminhos relativos
ao diretório do projeto do Editor, nunca por caminhos absolutos gravados pela
IA ou pelo navegador.

## 6. Diferenças que impedem uma cópia direta

1. PySide6 não pode ser importado pelo runtime React.
2. Pillow/NumPy precisam ser substituídos por Canvas 2D, Web Workers ou um
   serviço Node com Sharp quando o processamento exigir servidor.
3. FFmpeg não deve ser executado pelo navegador; a exportação final deve usar
   uma rota local Node/FFmpeg ou um worker dedicado.
4. A herança profunda de janelas Qt não deve ser reproduzida em componentes
   React.
5. O documento imutável e o histórico precisam ser implementados com reducer,
   snapshots e comandos explícitos.
6. A IA não pode receber acesso direto a filesystem, shell ou FFmpeg.
7. Os caminhos do Windows precisam ser convertidos para referências relativas
   portáveis.

## 7. Arquitetura proposta para `app/editor-video`

```text
app/editor-video/
├── components/       # UI React isolada
├── core/              # documentos, eventos, timeline e runtime puros
├── rendering/         # composição Canvas 2D e layers
├── media/             # preview, probe e integração local com FFmpeg
├── storage/           # projetos, backups e assets do Editor
├── ai/                # Ollama local e propostas validadas
├── types.ts           # contratos públicos do módulo
└── README.md
```

O módulo deve conversar com o restante do Nymi somente por adaptadores bem
definidos:

```text
Roteiros exportados -> ImportAdapter -> EditorProject
Catálogo Nymi       -> CharacterAssetAdapter
EditorProject       -> exportação/preview
```

Não haverá import direto de componentes do Criador ou do Studio dentro do
Editor, apenas contratos e funções puras aprovadas.

## 8. Plano de reconstrução em fases

### Fase 1 — Contratos e projeto mínimo

Criar `EditorProject`, `EditorSettings`, referências de mídia, personagens,
eventos e schema versionado. Implementar leitura, validação e preservação de
campos desconhecidos.

Critério de aceite: abrir e salvar um projeto vazio e um projeto fixture sem
perda de campos.

### Fase 2 — Catálogo e importação

Implementar adaptador para personagens exportados pelos Roteiros, incluindo
expressões, variantes, blink, talk e pastas de poses. Criar staging e
diagnósticos antes da cópia.

Critério de aceite: importar um ZIP exportado pelo Nymi e listar todas as
expressões e variantes reconhecidas.

### Fase 3 — TimelineResolver

Portar resolução sequencial, `start`, `duration:auto`, clipes, comentários
relativos, hold de frame e conversão de tempo local/global.

Critério de aceite: os mesmos eventos produzem os mesmos inícios, fins e
durações descritos no JSON original.

### Fase 4 — SceneRuntime

Calcular estado visual por tempo: visibilidade, expressão, pose, variante,
blink, talk, fala, pensamento, reação e vídeo ativo.

Critério de aceite: snapshots de cena reproduzíveis em tempos fixos.

### Fase 5 — FrameRenderer e preview

Compor Canvas 2D em ordem de camadas, com background, TikTok, personagens,
balões e overlays. Implementar cache e transporte de reprodução sem travar a
interface.

Critério de aceite: preview usa o mesmo estado do export e não faz personagens
desaparecerem durante troca de expressão.

### Fase 6 — Editor visual

Adicionar canvas selecionável, timeline, Inspector, arraste, escala, rotação,
camadas, balões e comentários. Todas as alterações passam por comandos e
histórico.

Critério de aceite: cada gesto gera uma operação de undo e o documento continua
válido.

### Fase 7 — Mídia e exportação

Integrar probe, áudio, FFmpeg local, exportação 1920×1080/30 FPS e perfil rápido
720p/15 FPS, com progresso, cancelamento e logs.

Critério de aceite: gerar MP4 com áudio sincronizado e remover arquivos parciais
quando houver cancelamento ou erro.

### Fase 8 — IA local e validação

Adicionar Ollama local como proposta estruturada para corrigir texto, duração e
eventos permitidos. Implementar validação FAST/DEEP e confirmação antes de
aplicar qualquer proposta.

Critério de aceite: IA não executa shell, não altera assets e não aplica
mudanças sem confirmação.

### Fase 9 — Integração controlada com Roteiros

Adicionar importação dos exports de personagens/vídeos e, somente depois de o
formato estar estável, um comando explícito “Enviar para Editor de vídeo”.

Critério de aceite: Roteiros continua funcionando mesmo se o Editor estiver
fechado ou indisponível.

## 9. Riscos principais

- divergência visual entre Canvas e FFmpeg;
- diferenças de quebra de texto e métricas de fonte;
- consumo de memória ao decodificar vídeos grandes;
- paths absolutos do Windows em projetos movidos;
- perda de áudio durante clipping;
- mudanças no catálogo de expressões do Nymi;
- dependência externa do Ollama;
- custo de portar toda a herança e UX Qt para React;
- tentativa de implementar UI antes de estabilizar timeline e runtime.

## 10. Decisões técnicas recomendadas

1. Reconstruir o núcleo em TypeScript, não executar Python dentro do Nymi.
2. Manter o Editor isolado até os contratos passarem nos testes.
3. Reutilizar o mesmo pipeline lógico para preview e export.
4. Usar referências relativas de projeto para assets e mídia.
5. Usar Node/FFmpeg somente no servidor local para exportação final.
6. Usar Web Workers para processamento pesado de preview quando necessário.
7. Manter IA local como camada de propostas, nunca como autoridade do projeto.
8. Criar fixtures baseadas nos JSONs reais do Video Maker original.
9. Fazer commits por fase e manter rollback antes de cada integração.

## 11. Critérios para considerar o Editor compatível

- abre os JSONs necessários sem perda de campos;
- reconhece personagens, expressões e variantes exportados pelo Nymi;
- resolve a timeline com os mesmos tempos do original;
- reproduz blink, talk, diálogos, pensamentos e comments;
- mantém vídeo e áudio sincronizados;
- preview e export compartilham o mesmo runtime;
- exporta 1920×1080/30 FPS e 720p/15 FPS;
- valida assets ausentes com mensagens claras;
- possui undo/redo, recovery e cancelamento;
- não altera Studio, Criador ou Roteiros sem integração explícita;
- todos os testes de contrato, integração e export passam.

## 12. Próxima ação

Antes de criar a primeira tela, implementar a Fase 1: contratos TypeScript,
schema do `EditorProject`, codec JSON e fixtures mínimos derivados do formato
original. Essa fase é a base para evitar uma reconstrução visual incompatível.
