# Inventário atual de funcionalidades

## Escopo auditado

Este documento descreve o estado copiado do Gacha Maker Premium no commit-base
`bf8410f`, dentro de `C:\TRABALHO 2\NYMI GACHA`. O projeto Premium original é
somente uma referência de leitura e não faz parte do ciclo de alterações desta
versão.

Legenda:

- **Pronto**: há interface, persistência e cobertura mínima por teste ou build.
- **Parcial**: existe implementação útil, porém há lacunas de UX, integração ou teste.
- **Legado/inativo**: existe código, mas não há fluxo de produto acessível e validado.

## 1. Criador de Personagens (`/`)

| Área | Estado | Comportamento atual |
|---|---|---|
| Personagens | Pronto | Criar, selecionar, nomear, salvar, excluir e gerar foto de apresentação. |
| Gênero | Pronto | Catálogos e modelos separados em feminino e masculino. |
| Modelos | Pronto | Descoberta de pastas `modelo-N`, packs de expressão e compatibilidade com nomes legados `pack-N`. |
| Expressões | Pronto | Estado normal, blink e talk; emoções adicionais dependem das imagens disponíveis no pack. |
| Cabelo | Pronto | Item frontal individual, par frente/trás e folha de pares; camadas frontal e traseira independentes. |
| Roupas | Pronto | Item individual e folha de variantes; capa padrão mais variantes compartilhadas entre modelos do mesmo gênero. |
| Rosto | Pronto | Base do modelo, rosto individual e pack de expressões. |
| Ajuste de item | Pronto | Posição, escala uniforme, largura, altura, rotação, espelhamento e encaixe automático. |
| Máscaras | Pronto | Borracha/restauração não destrutiva para corpo, cabelo frontal, cabelo traseiro e roupa, com undo/redo. |
| Chroma key | Pronto | Remoção de fundo conectada, tolerância, suavidade, seleção de cor e descontaminação do halo. |
| Cor do item | Pronto | Matiz, saturação, brilho/valor e proteção pintada de regiões; roupas vinculadas recebem o mesmo ajuste. |
| Recorte de folhas | Pronto | Detecção por pixels visíveis, recorte por variante e normalização do conjunto para canvas comum. |
| Preview | Pronto | Canvas 1920×1080, fundo transparente, zoom, pan, enquadramento e ferramentas ancoradas ao canvas. |
| Exportar PNG | Pronto | Exporta a composição atual com transparência. |
| Exportar ZIP | Pronto | Gera todas as expressões finais com corpo, roupa, cabelo e máscaras aplicadas. |
| Autosave | Pronto | Salva alterações de personagens existentes; não cria personagem apenas por trocar o modelo. |
| Migração do navegador | Parcial | IndexedDB e `localStorage` antigos podem ser migrados para o serviço local; aumenta a complexidade de estado. |

### Restrições observadas

- `app/page.tsx` reúne tipos, regras de domínio, processamento de imagem,
  persistência, renderização Canvas e toda a UI em cerca de 221 KB.
- Há tipos do Criador duplicados em `app/studio/types.ts`.
- Processamento de folhas e chroma acontece na thread da interface; imagens grandes
  podem causar travamentos perceptíveis.
- A persistência do Roteiros possui fonte principal no PC e um journal de
  recuperação temporário no navegador; IndexedDB/`localStorage` do Criador
  permanecem somente como migração de compatibilidade.

## 2. Studio (`/studio`)

| Área | Estado | Comportamento atual |
|---|---|---|
| Lista de studios | Pronto | Criar, abrir, salvar e excluir composições. |
| Cena | Pronto | Canvas com fundo, personagens, objetos, balões e narrador. |
| Personagens | Pronto | Usa os personagens salvos no Criador e suas expressões finais. |
| Transformações | Pronto | Arraste, posição, escala, rotação, visibilidade e ordem de camada. |
| Objetos e fundos | Pronto | Upload de arquivos e persistência local no PC. |
| Balões | Pronto | Fala e pensamento, texto, direção da ponta, largura, escala, fonte, duplicação e camadas. |
| Texto | Pronto | Copiar, colar e gerar versão em inglês por IA local. |
| Narrador | Pronto | Bloco visual independente na cena. |
| Histórico | Pronto | Undo/redo da composição. |
| Autosave | Pronto | Journal temporário no navegador e fila serial de gravação no serviço local. |
| Print | Pronto | Gera PNG e salva em pasta configurada no PC; permite abrir a pasta. |
| Fullscreen | Pronto | Modo de visualização da cena. |
| IA local | Parcial | Tradução via Ollama/LM Studio, warmup/unload; depende de serviço externo instalado e ativo. |

### Restrições observadas

- `app/studio/page.tsx` ainda concentra o editor e seus inspetores em cerca de 56 KB.
- Undo/redo é local ao componente e não tem contrato reutilizável.
- O journal de recuperação em `localStorage` é temporário e agora informa
  claramente quando existe uma cópia pendente diferente do PC.
- A exportação e o preview precisam permanecer visualmente equivalentes em toda
  refatoração.

## 3. Roteiros (`/roteiros` e `/roteiros/[id]`)

| Área | Estado | Comportamento atual |
|---|---|---|
| Lista de roteiros | Pronto | Criar, duplicar, excluir e exportar JSON. |
| Participantes | Pronto | Seleciona personagens já salvos no Criador. |
| Fichas narrativas | Pronto | Personalidade, história, relação com FYN, estilo de fala, regras e relações direcionais. |
| Contexto geral | Pronto | Contexto persistido por roteiro. |
| TikToks | Pronto | Criar, ordenar, excluir, nomear, descrever, definir objetivo, linha temporal e regras. |
| Vídeo por TikTok | Pronto | Upload, substituição, preview reproduzível e remoção. |
| Blocos de reação | Pronto | Fala, pensamento ou reação silenciosa; personagem, emoção, PT e EN; ordenar, duplicar e excluir. |
| IA de blocos | Pronto | Preencher vazios, substituir todos, regenerar um bloco, refazer frase e traduzir. |
| IA de contexto | Pronto | Melhora descrição com aceite/cancelamento. |
| Configuração da IA | Pronto | Desativada, Ollama ou LM Studio; listar modelos, testar e ajustar geração. |
| Regras globais | Pronto | Regras livres, prioridade, ativação e regras estruturais protegidas. |
| Autosave | Pronto | Debounce, fila serial, arquivo local atômico, backups no PC e journal versionado de recuperação. |
| Exportações locais | Pronto | Vídeos, personagens compostos e texto do roteiro para pastas do Video Maker original. |
| Abrir pastas | Pronto | Comando local restrito a destinos conhecidos. |

### Restrições observadas

- O contrato de Roteiros é versão 1 e possui normalização defensiva, mas não há
  validação formal compartilhada entre cliente e servidor.
- A integração com o Video Maker usa caminhos Windows específicos como padrão.
- O editor central e a IA estão acoplados ao componente React e ao serviço MJS.
- Cancelamento de requisições e feedback progressivo não são uniformes.

## 4. Serviço de dados local (`local-data-server.mjs`)

### Capacidades ativas

- Servidor HTTP somente em `127.0.0.1:6800`, com token efêmero por processo para operações da UI.
- Estado principal versão 2 em `dados-locais-premium/state.json`.
- Gravação JSON atômica e retenção de backups.
- Armazenamento de catálogo, packs, fotos, assets do Studio e vídeos de Roteiros.
- Suporte a `Range` para preview de mídia.
- Descoberta de modelos em `public/models/modelos`.
- Abertura de pastas via processo local.
- Proxy controlado para Ollama e LM Studio.
- Exportação para pastas do Video Maker original.

### Código parcial/legado

Existem endpoints `/video-maker/*` para personagens, TikToks, projetos, IA e
exports. Não existe rota de interface do Video Maker neste snapshot. Eles devem
ser tratados como compatibilidade/experimento até que um fluxo completo seja
especificado e testado; não entram na paridade obrigatória da primeira versão de
NYMI GACHA.

## 5. Inicialização e operação

- Interface: `http://localhost:6700` via Vinext/Vite.
- Serviço local: `http://127.0.0.1:6800` via Node.js.
- O BAT encerra uma instância anterior reconhecida do serviço de dados, inicia
  uma nova instância oculta, abre o navegador e mantém o servidor da interface.
- Runtime mínimo declarado: Node.js 22.13.
- O projeto é local-first e não possui autenticação de usuário.

## 6. Cobertura automatizada atual

O baseline oficial (`npm test`) compila a aplicação e executa 57 testes. A suíte
cobre especialmente:

- contrato visual/HTML das três áreas;
- packs e expressões;
- cabelo em camadas;
- recorte e chroma key;
- máscaras e ajustes de cor;
- autosave e persistência no PC;
- Studio e seus balões;
- Roteiros e exportações;
- segurança de caminhos, byte ranges e gravação atômica.

Na fase 8 foram adicionados Playwright para os fluxos críticos, um benchmark de
estado grande, contrato de acessibilidade/contraste, monitoramento de URLs de
objeto e smoke estático do launcher. A comparação visual agora está disponível
em `scripts/compare-png.mjs` para referências PNG reais.

Ainda não há um conjunto de screenshots dourados versionado nem uma execução em
uma máquina Windows limpa; essas validações permanecem parte do beta. Falhas do
Ollama/LM Studio e renderizações de Canvas de altíssimo volume continuam sendo
testes manuais/de ambiente.

## 7. Páginas, rotas e integrações

### Rotas visíveis

| Rota | Página | Usuário principal |
|---|---|---|
| `/` | Criador de Personagens | Pessoa que monta e exporta assets Gacha. |
| `/studio` | Lista e editor de cenas | Pessoa que compõe prints manualmente. |
| `/roteiros` | Roteiros, fichas e IA/regras | Pessoa que escreve e organiza histórias. |
| `/roteiros/[id]` | Editor de um roteiro | Pessoa que estrutura TikToks e reações. |

Há um único tipo de usuário local. Não existem login, papéis ou permissões de
produto. As permissões efetivas são as do usuário do Windows que iniciou o BAT.

### Rotas do serviço local

| Grupo | Operações |
|---|---|
| Saúde/estado | `GET /health`, `GET /state`, `GET /models`. |
| Personagens | salvar lista, enviar foto estável e servir foto. |
| Catálogo/packs | criar, excluir e servir PNGs. |
| Studio | salvar studios, enviar/excluir/servir assets, salvar prints e abrir pasta. |
| Roteiros | carregar/salvar estado, upload/preview/delete de vídeo, exports e abrir pasta. |
| IA | listar/testar modelos, gerar/melhorar/traduzir, warmup e unload conforme área. |
| Video Maker | endpoints experimentais sem página ativa; não contam como produto pronto. |

## 8. Formulários, filtros e configurações

### Criador

- nome do personagem, gênero, modelo e expressão;
- tabs de cabelo/rosto/roupa e subtabs frente/trás, base/item/pack e padrão/variantes;
- importadores de item, folha, par e pack;
- transformações numéricas e direcionais;
- chroma: cor, tolerância, suavidade e fundo conectado;
- cor: matiz, saturação, luminosidade e máscara de proteção;
- borracha: camada, tamanho, apagar/restaurar, undo/redo;
- busca visual ocorre por catálogo/abas; não há campo textual de busca no baseline.

### Studio

- nome e seleção de studio;
- fundo, objetos, elenco e expressões;
- posição, escala, rotação, z-index e visibilidade;
- texto, tipo, largura, escala, fonte, ponta e camada de balão;
- narrador e ações de print/view.

### Roteiros

- busca e filtro de fichas por todos/incompletos/completos;
- contexto geral e seleção de participantes;
- TikTok: título, objetivo, descrição, linha temporal, instrução e regras;
- bloco: personagem, tipo, emoção, texto PT e tradução EN;
- IA: provedor, endereço, modelo, criatividade, tamanho padrão, histórico e falas curtas;
- regras: título, prioridade, ativa/inativa e descrição.

## 9. Formatos de entrada e saída

| Direção | Formato | Uso |
|---|---|---|
| Entrada | PNG/JPG/JPEG/WebP | modelos, cabelo, roupa, rosto, objetos e fundos conforme o fluxo. |
| Entrada | Folha raster | múltiplos cabelos, pares, roupas variantes e packs de expressão. |
| Entrada | MP4 e mídia aceita pelo navegador | vídeo associado a um TikTok. |
| Entrada | Estado legado no navegador | migração de personagens, catálogo e studios. |
| Saída | PNG transparente | personagem/frame atual e prints do Studio. |
| Saída | ZIP | pack final de personagem com expressões compostas. |
| Saída | JSON | backup/roteiro no contrato atual. |
| Saída | TXT/arquivos e MP4 copiados | integração local de Roteiros com Video Maker externo. |

## 10. Regras de negócio críticas

- cabelo é compartilhado por gênero; frente e trás são camadas diferentes;
- roupa variante pertence a um grupo, cuja variante zero é capa/padrão;
- roupa importada é compartilhada entre modelos do mesmo gênero;
- máscaras e transformações são não destrutivas e pertencem ao personagem/item;
- troca de modelo, isoladamente, não cria um personagem salvo;
- ZIP compõe assets sobre cada expressão final, em vez de exportar fontes soltas;
- IDs, não nomes, ligam personagens a Studio e Roteiros;
- IA é opcional e nunca deve bloquear edição manual;
- exclusões e sobrescritas materiais precisam de confirmação ou backup;
- arquivos do usuário ficam fora do Git e sob raízes locais conhecidas.
