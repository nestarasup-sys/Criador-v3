# Matriz de paridade funcional

## Princípio

A reconstrução só substitui o Premium quando o mesmo projeto de usuário puder
ser aberto, editado e exportado sem perda. Melhorias visuais não autorizam a
remoção de fluxos existentes.

Estados usados:

- `B0`: comprovado no baseline copiado.
- `P`: obrigatório para a primeira versão com paridade.
- `P+`: melhoria posterior, sem bloquear a paridade.
- `L`: legado/parcial; requer decisão de produto antes de migrar.

## Registro detalhado obrigatório

| Funcionalidade atual | Localização atual | Problemas encontrados | Solução proposta para a versão nova | Estado da reconstrução | Testes necessários | Compatibilidade |
|---|---|---|---|---|---|---|
| Criar/salvar personagens | `app/page.tsx`; `/characters` | UI, regra e persistência acopladas | Caso de uso e repositório tipado, mantendo rota adaptadora | Inventariada | CRUD, reinício e falha de serviço | Ler/escrever estado v2 |
| Modelos e expressões | `app/page.tsx`; `public/models`; `/models` | Constantes duplicadas e aliases espalhados | Registro único e normalizador versionado | Fundação concluída; reconstrução visual pendente | descoberta, aliases e pack incompleto | `pack-N` → `modelo-N` |
| Cabelos em camadas | `app/page.tsx` | Regras de par no componente | Entidade `HairGroup` e compositor puro | Inventariada | item, par, folha, z-order e máscara | IDs atuais preservados |
| Roupas variantes | `app/page.tsx`; servidor | Migração e ordenação implícitas | `OutfitGroup` com índice/capa explícitos | Inventariada | 4/6 variantes, reorder, cor e export | campos legados normalizados |
| Chroma/recorte | `chroma-processing.mjs`; `page.tsx` | Parte pura e parte duplicada na UI | Pipeline único, depois Worker com fallback | Inventariada | halo, verde legítimo, regiões e bordas | resultado visual equivalente |
| Ajustes e máscaras | Criador; `studio/types.ts` | Tipos duplicados | Contrato compartilhado e comandos testáveis | Contrato compartilhado concluído; comandos pendentes | round-trip, undo/redo e export | strokes antigos preservados |
| PNG/ZIP | Criador; `character-export.ts` | Dois caminhos de composição | Renderizador canônico com adaptadores | Inventariada | golden images e estrutura ZIP | nomes aceitos pelo Video Maker |
| CRUD de Studio | `studio/page.tsx`; `storage.ts` | Store local ao componente | Store por comandos e repositório local | Inventariada | CRUD, tombstone, mesclagem e reload | studios existentes abrem iguais |
| Canvas do Studio | `studio/page.tsx` | Risco de divergência preview/export | Cena imutável e renderizador compartilhado | Inventariada | drag, layer e print golden | coordenadas atuais preservadas |
| Balões/narrador | `studio/page.tsx` | Editor e render no mesmo módulo | Componentes e layout engine testável | Inventariada | PT/EN, ponta, camada e duplicar | contrato Studio atual |
| Tradução no Studio | Studio; servidor | Falhas externas pouco uniformes | Gateway IA com timeout/cancelamento/erro comum | Inventariada | offline, timeout, sucesso e unload | Ollama/LM Studio mantidos |
| Fichas narrativas | `RoteirosHome.tsx` | Acopladas à página | Feature isolada usando IDs do Criador | Inventariada | filtros, relações e autosave | estado Roteiros v1 |
| Editor de Roteiros | `RoteiroEditor.tsx` | Componente grande e comandos inline | Store transacional e cards modulares | Inventariada | TikTok/bloco CRUD e ordenação | JSON v1 e IDs atuais |
| Vídeos de TikTok | `roteiros/storage.ts`; servidor | Validação/tamanho limitados | Serviço de mídia com política explícita | Inventariada | upload, Range, replace, remove | caminhos existentes resolvidos |
| IA de Roteiros | `services/roteiros/service.mjs` | Cliente, prompt e parsing juntos | Casos de uso e schema de resposta | Inventariada | modelos, timeout, JSON inválido e fallback | configurações atuais mantidas |
| Exportações de Roteiros | UI/storage/servidor | Destinos Windows hardcoded | Preferências com defaults legados | Inventariada | arquivos, nomes, replace e abrir pasta | destinos atuais seguem padrão |
| Persistência/backup | servidor e browser stores | Compatibilidade histórica e conflito pouco visível | PC canônico, journal versionado e restauração explícita | Fase 7 concluída; journal e backups cobertos por testes | falhas físicas de disco e migração manual | migração não destrutiva |
| Video Maker parcial | `/video-maker/*` no servidor | Não há UI/fluxo validado | Congelar até decisão específica | Legado, fora da paridade | ausência de regressão | endpoints não removidos agora |

## Criador de Personagens

| Capacidade | Baseline | Meta | Evidência/aceite |
|---|---:|---:|---|
| CRUD de personagens | B0 | P | Criar, salvar, reabrir e excluir sem alterar o resultado. |
| Gêneros e modelos numerados | B0 | P | Descobrir `modelo-N`; exibir somente o gênero correto. |
| Packs completos de expressão | B0 | P | Preview e ZIP usam as mesmas expressões, blink e talk. |
| Cabelo frontal/traseiro | B0 | P | Z-order e máscaras independentes preservados. |
| Item e folha de cabelo | B0 | P | Recortes e pares importados sem troca de ordem. |
| Roupa individual e folha de variantes | B0 | P | Variante padrão também aparece na lista completa. |
| Recorte por conteúdo | B0 | P | Primeiro/último pixel visível e canvas normalizado. |
| Chroma key avançado | B0 | P | Sem halo verde e sem apagar verde legítimo desconectado. |
| Ajuste fino e autoencaixe | B0 | P | Transformações antigas abrem com o mesmo resultado. |
| Máscaras por camada | B0 | P | Strokes antigos continuam editáveis e exportáveis. |
| Ajustes de cor vinculados | B0 | P | Todas as variantes do grupo mudam juntas. |
| Proteção manual de detalhes | B0 | P | Máscara existente preserva os mesmos pixels. |
| Foto do personagem | B0 | P | Atualiza um único arquivo estável por personagem. |
| Exportar PNG | B0 | P | Dimensão, transparência e composição equivalentes. |
| Exportar ZIP | B0 | P | Estrutura, nomes e frames aceitos pelo Video Maker. |
| Processamento fora da thread principal | — | P+ | Importações grandes não bloqueiam a UI. |

## Studio

| Capacidade | Baseline | Meta | Evidência/aceite |
|---|---:|---:|---|
| CRUD e autosave de studios | B0 | P | Reinício do navegador não perde a composição. |
| Fundo, personagens e objetos | B0 | P | Mesma ordem e transformações após reabrir. |
| Balões de fala/pensamento | B0 | P | Texto, tamanho, ponta e camada equivalentes. |
| Narrador | B0 | P | Persistência e export visual equivalentes. |
| Arraste e inspetores | B0 | P | Pointer, escala, rotação e posição funcionam. |
| Undo/redo | B0 | P | Histórico cobre operações já suportadas. |
| Copiar/colar texto | B0 | P | Permissões negadas geram mensagem recuperável. |
| Tradução local | B0 | P | Ollama/LM Studio indisponível não quebra edição manual. |
| Print 1920×1080 | B0 | P | PNG salvo no PC é igual ao preview sem controles. |
| Abrir pasta de prints | B0 | P | Abre apenas o diretório permitido. |
| Renderização incremental | — | P+ | Cena grande mantém interação fluida. |

## Roteiros

| Capacidade | Baseline | Meta | Evidência/aceite |
|---|---:|---:|---|
| CRUD, duplicação e autosave | B0 | P | Estado versão 1 é carregado sem migração destrutiva. |
| Participantes do Criador | B0 | P | Nome e foto atualizam sem perder a referência por ID. |
| Fichas narrativas | B0 | P | Todos os campos e relações direcionais preservados. |
| Regras e IA local | B0 | P | Configuração, teste, geração e modo desligado preservados. |
| TikToks | B0 | P | Ordenar, descrever, objetivo, tempo e instruções. |
| Vídeos | B0 | P | Upload, Range preview, substituir e remover. |
| Blocos | B0 | P | Tipos, ordenação, duplicação, PT/EN e emoção. |
| Geração seletiva | B0 | P | Preencher vazios e regenerar não sobrescrevem indevidamente. |
| Exportar JSON | B0 | P | Contrato `GACHA_PREMIUM_ROTEIROS_V1`. |
| Exportar vídeos/personagens/texto | B0 | P | Destinos configuráveis e nomes determinísticos. |
| Abrir pastas | B0 | P | Funciona pelo serviço local e falha com mensagem clara. |
| Cancelamento/progresso de IA | Parcial | P+ | Requisição cancelável e feedback consistente. |

## Infraestrutura e dados

| Capacidade | Baseline | Meta | Evidência/aceite |
|---|---:|---:|---|
| Estado versão 2 do app | B0 | P | Migração e round-trip sem perda. |
| Estado versão 1 de Roteiros | B0 | P | Round-trip e campos desconhecidos tratados conscientemente. |
| JSON atômico | B0 | P | Nunca deixa arquivo parcial após falha simulada. |
| Backups rotativos | B0 | P | Retenção e restauração documentadas. |
| CORS loopback | B0 | P | Origens não locais rejeitadas. |
| Segurança de caminhos | B0 | P | IDs e destinos não escapam das raízes permitidas. |
| Compatibilidade com navegador | B0 | P | Chrome/Edge atuais no Windows. |
| Observabilidade local | Parcial | P+ | Logs estruturados e diagnóstico exportável. |
| Video Maker embutido | Legado | L | Fora da primeira paridade; não há UI ativa. |

## Gate de paridade

Uma fatia é considerada equivalente apenas quando:

1. abre dados reais copiados de uma fixture anonimizada;
2. mantém o resultado visual esperado;
3. salva e reabre sem perda;
4. exporta no formato antigo quando aplicável;
5. passa testes unitários, de contrato e um fluxo E2E;
6. não exige alteração no Premium original;
7. possui rollback para o commit estável anterior.
