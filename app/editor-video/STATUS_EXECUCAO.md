# Editor de vídeo — status da fase única

## Entregue nesta rodada

- Núcleo isolado em TypeScript: contratos V1, normalização, validação, timeline sequencial e runtime persistente.
- Catálogo persistente em `dados-locais-premium/editor-video/`, sem reutilizar o catálogo do Studio ou do Video Maker legado.
- Importação segura de ZIP de personagem com limite de tamanho, validação de caminho, manifesto/frames e rollback por erro.
- Importação persistente de vídeos, manifesto local e URL de mídia com suporte a range HTTP.
- Tela `/editor-video` com biblioteca, importação de personagem, importação de projeto, upload de vídeo, timeline, slider de tempo e estado de runtime.
- Prévia de vídeo real com controles nativos, sincronizada ao tempo selecionado.
- Arraste de personagens no Canvas e edição básica de duração, expressão e texto de eventos.
- Assistente local via Ollama/LM Studio, validando a proposta antes de aplicá-la.
- Autosave e histórico puros disponíveis no módulo de sessão; salvamento manual do projeto pelo serviço local.
- Exportação WebM capturada do Canvas para MP4 isolada em `dados-locais-premium/editor-video/exports/`, com perfis rápido (720p/15 FPS) e final (1080p/30 FPS), e mux de áudio de vídeos importados quando disponível.
- Área adicionada à navegação principal do Nymi Gacha.

## Validação

- `npm run typecheck` — aprovado.
- `npm run lint` — aprovado (sem erros; avisos preexistentes permanecem documentados pelo projeto).
- `npm run test:unit` — 73 testes aprovados.
- `npm run build` — aprovado, incluindo `/editor-video`.
- `node --check local-data-server.mjs` — aprovado.

## Limitações explícitas restantes

O código desta fase já é utilizável, mas não deve ser confundido com paridade total do Video Maker Python. Ainda faltam, para uma versão beta completa:

1. composição de vídeo dentro do mesmo frame do Canvas (a prévia usa um elemento `<video>` sobre o palco);
2. editor visual completo de objetos, fundos, z-index, escala e rotação;
3. painel visual completo de poses, variantes, blink/talk e comentários;
4. cancelamento/progresso de exportação e validação visual automatizada de frames;
5. adaptadores de importação automática vindos da aba Roteiros;
6. testes de integração com MP4 real e áudio em todos os perfis, além de teste externo do MP4 produzido.

Esses itens são riscos de produto, não erros de compilação. O núcleo permanece isolado para que sejam adicionados sem alterar Criador, Studio ou Roteiros.
