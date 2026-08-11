# Plano de execução em fase única — Editor de vídeo do Nymi Gacha

**Projeto oficial:** `C:\TRABALHO 2\NYMI GACHA`  
**Módulo isolado:** `app/editor-video`  
**Data:** 2026-08-11  
**Objetivo:** reconstruir, em TypeScript/React/Canvas/Node, o comportamento essencial do Video Maker original, sem alterar o Criador de Personagens, o Studio ou Roteiros até que uma integração explícita seja concluída.

## 1. Resultado esperado

Ao final desta fase única, o usuário deverá conseguir:

1. importar um ZIP exportado pelo Criador de Personagens;
2. importar personagens exportados por Roteiros;
3. importar ou selecionar vídeos e cenários;
4. abrir um projeto JSON compatível com o contrato do Video Maker original;
5. visualizar a timeline em um Canvas 1920×1080;
6. posicionar personagens, vídeos e balões;
7. reproduzir expressões, blink, talk, diálogos, pensamentos e reações;
8. revisar e corrigir eventos com validação clara;
9. usar o chat local do Ollama somente para propor alterações estruturadas;
10. salvar automaticamente, criar backups e recuperar versões anteriores;
11. exportar MP4 final em 1920×1080 a 30 FPS;
12. exportar uma versão rápida em 1280×720 a 15 FPS;
13. cancelar uma exportação sem deixar arquivos corrompidos;
14. manter o Nymi Gacha original funcional mesmo se o Editor de vídeo estiver fechado.

O resultado não será uma cópia da interface PySide6. Será uma implementação web local nativa, com o mesmo comportamento de domínio e uma interface coerente com o Nymi Gacha.

## 2. Escopo e limites

### Incluído

- núcleo de documentos e schemas;
- codec compatível com JSON V1/V2 e aliases históricos;
- catálogo local de personagens, poses e expressões;
- importação de ZIP, pasta e referências exportadas por Roteiros;
- staging, diagnóstico e cópia atômica de assets;
- timeline sequencial e duração automática de vídeos;
- runtime determinístico de cena;
- Canvas de preview;
- edição visual de layers, personagens, vídeos e balões;
- blink, talk, variantes e fallback de expressão;
- comentários temporizados de TikTok;
- áudio interno dos vídeos;
- exportação local por FFmpeg;
- autosave, recovery, undo/redo e backups;
- integração opcional com Ollama/Gemma;
- testes unitários, integração, mídia e build.

### Não incluído nesta fase

- alteração de regras do Criador de Personagens;
- alteração de regras do Studio;
- alteração de regras de Roteiros;
- execução do Python original dentro do Nymi;
- upload para nuvem;
- contas, autenticação ou colaboração online;
- geração de imagens por IA;
- inpainting, ControlNet, upscale ou edição avançada de assets;
- áudio gerado por IA ou dublagem;
- publicação automática em redes sociais.

## 3. Evidência e estado atual

### Projeto original auditado

O ZIP em `app/editor-video/Gacha-Editor-V2-app-current-clean-20260811.zip` e a auditoria existente documentam um app Python com:

- Python 3.12+;
- PySide6 Essentials/Qt Fusion;
- Pillow e NumPy;
- PyYAML;
- imageio-ffmpeg/FFmpeg;
- Ollama local;
- PyInstaller;
- pytest;
- pipeline `ProjectDocument → TimelineResolver → SceneRuntime → FrameRenderer → Preview/Export`.

### Nymi Gacha atual

- React 19, TypeScript e Vinext;
- Node.js e servidor local para dados do PC;
- Canvas 2D;
- CSS existente do Nymi Gacha;
- `JSZip` para exportação de personagens;
- módulos isolados em `app/editor-video`;
- testes Node, typecheck, lint e build.

### Trabalho já concluído

- auditoria comparativa do Video Maker;
- contratos TypeScript V1;
- schema JSON inicial;
- codec de normalização com aliases legados;
- fixture mínima de projeto;
- adaptador inicial para ZIPs do Criador;
- reconhecimento de poses e `variants-manifest.json`;
- teste de contrato do catálogo;
- isolamento do módulo na pasta `app/editor-video`.

Esses componentes são a base, mas ainda não constituem um Editor funcional completo.

## 4. Contratos canônicos

### 4.1 Projeto

O documento deve ter:

```text
EditorProject
├── schemaVersion
├── sourcePath/rootDir
├── settings
├── characters
├── initialState
├── timeline
└── extensions
```

Regras:

- `schemaVersion` é obrigatório e versionado;
- campos desconhecidos são preservados em `extensions`;
- IDs são estáveis, sem depender da posição na lista;
- caminhos persistidos são relativos ao diretório do projeto;
- nenhum JSON salvo contém caminho absoluto do usuário quando uma referência relativa for possível;
- resolução padrão é `[1920, 1080]`;
- FPS padrão é `30`;
- documentos inválidos podem ser carregados em modo recuperável, mas não podem ser exportados sem confirmação.

### 4.2 Personagem

Cada personagem deve conter:

- `id`, `name`;
- `assetDir` relativo;
- poses e expressões disponíveis;
- expressão e pose padrão;
- transformação: `x`, `y`, escala, rotação, espelhamento, âncora e camada;
- chroma key configurável;
- auto-trim e padding;
- política de blink/talk;
- extensões futuras.

O catálogo não deve inventar expressões que não existem no ZIP. A interface deve mostrar somente estados realmente disponíveis, mantendo fallback explícito quando o roteiro solicitar um estado ausente.

### 4.3 Asset importado

Cada asset deve ter:

- caminho relativo seguro;
- tipo MIME;
- hash ou assinatura de conteúdo;
- tamanho;
- personagem/pose/expressão de origem;
- status: `staged`, `ready`, `missing`, `invalid`;
- diagnóstico legível.

### 4.4 Eventos

Eventos aceitos:

- `pause`;
- `beat`;
- `dialogue`;
- `thought`;
- `state`, `expression`, `set_expression`;
- `visibility`;
- `reaction`;
- `group_reaction`;
- `video` com comentários;
- `unknown`, preservado para compatibilidade.

Cada evento deve possuir ID, tipo, duração, extensões e posição temporal quando aplicável.

### 4.5 Regras de persistência

- alterações confirmadas geram autosave com debounce;
- cada save cria backup rotativo antes da substituição;
- gravação usa arquivo temporário e rename atômico;
- undo/redo opera sobre comandos ou snapshots imutáveis;
- recovery journal registra operações ainda não persistidas;
- falha de armazenamento nunca apaga o último documento válido.

## 5. Catálogo e importação

### 5.1 Fontes aceitas

1. ZIP normal do Criador de Personagens;
2. ZIP de variantes com `POSE 1`, `POSE 2` e `variants-manifest.json`;
3. pasta selecionada pelo usuário;
4. personagens exportados na pasta de Roteiros;
5. projeto antigo com `assets/characters`;
6. fixture de teste.

### 5.2 Staging

Importação nunca grava diretamente no catálogo final.

Fluxo:

```text
Selecionar ZIP/pasta
    ↓
Validar nomes, tamanho e caminhos
    ↓
Ler manifest e inferir arquivos
    ↓
Mostrar prévia e diagnósticos
    ↓
Usuário confirma
    ↓
Copiar para staging
    ↓
Verificar hashes e arquivos obrigatórios
    ↓
Trocar staging pelo catálogo final atomicamente
```

### 5.3 Expressões

O parser deve reconhecer:

- `normal.png`;
- `normal_blink.png`;
- `normal_talk.png`;
- `normal talk 1.png`;
- `normal talk 2.png`;
- expressões em português e inglês;
- aliases históricos documentados pelo original.

O parser não deve assumir que todo personagem possui nove expressões. A lista real vem dos arquivos e do manifest.

### 5.4 Variantes

- variante padrão fica na raiz do pacote;
- variantes são agrupadas por `POSE n`;
- cada pose possui seus próprios frames, blink e talk;
- assets ausentes em uma pose geram warning, não crash;
- o catálogo mostra claramente qual pose está ativa;
- o exportador mantém a estrutura original para compatibilidade.

### 5.5 Segurança

- rejeitar `..`, caminhos absolutos, separadores inválidos e NUL;
- limitar quantidade de arquivos;
- limitar bytes descompactados;
- aceitar somente extensões permitidas;
- impedir overwrite fora da pasta do Editor;
- não executar nenhum arquivo importado;
- não confiar em nome vindo de manifest ou IA;
- normalizar nomes de pasta antes de gravar.

## 6. Timeline e relógio do projeto

Implementar um único `TimelineResolver` usado pelo preview e pelo export.

### Regras

- eventos sequenciais usam o fim do evento anterior;
- `start` explícito é respeitado após validação;
- `duration: "auto"` usa metadados reais do vídeo;
- `clip_start` e `clip_end` limitam o vídeo;
- comentários de TikTok usam tempo relativo ao início do vídeo;
- `hold_video_frame` mantém o último frame do vídeo anterior;
- duração inválida vira erro de validação;
- eventos desconhecidos preservam posição e duração sem quebrar a leitura.

### Saída

O resolver deve produzir intervalos determinísticos:

```text
ResolvedEvent {
  eventId;
  type;
  start;
  end;
  duration;
  source;
  localVideoTime?;
}
```

## 7. Runtime de cena

O `SceneRuntime` recebe um projeto e um tempo e devolve um snapshot puro.

### Estado por personagem

- expressão atual;
- pose/variante atual;
- visibilidade;
- posição e transformação;
- estado falando/pensando;
- último tempo de mudança;
- agenda de blink;
- frame atual de talk;
- fallback usado, se houver.

### Regras de expressão

1. usar o estado solicitado se existir;
2. procurar alias normalizado;
3. procurar variante específica;
4. usar expressão padrão;
5. usar primeiro frame renderizável;
6. registrar warning.

### Blink

- agenda determinística por personagem;
- intervalo configurável;
- não sincronizar todos os personagens;
- bloquear blink imediatamente após troca de pose;
- usar blink específico antes do genérico;
- não gerar blink artificial quando o asset não existe.

### Talk

- usar frames talk disponíveis;
- sequência de ida e volta quando houver múltiplos frames;
- manter frame único quando houver apenas um;
- pensamento não usa talk por padrão;
- não trocar expressão durante a fala sem evento explícito.

## 8. Renderização e Canvas

### Ordem de camadas

```text
background
vídeo TikTok
objetos/overlays
personagens por layer/z-index
balões
comentários
controles de edição
```

### Renderizador compartilhado

Preview e export devem chamar o mesmo `renderFrame(snapshot, target)`.

O target pode ser:

- Canvas de preview;
- Canvas offscreen;
- frame para FFmpeg.

### Desempenho

- cache de imagens por URL/hash;
- pré-carregamento da expressão seguinte;
- não remover a imagem atual antes da nova terminar de carregar;
- decodificação fora do thread principal quando possível;
- limitar cache de frames de vídeo;
- cancelar trabalho obsoleto;
- usar `requestAnimationFrame` no preview;
- renderizar somente quando o snapshot mudar.

### Edição visual

- selecionar personagem, vídeo ou balão;
- arrastar;
- escala proporcional;
- rotação;
- flip;
- z-index;
- snap opcional;
- campos numéricos no Inspector;
- limites que impedem perder o objeto fora da tela;
- comando de centralizar e restaurar.

## 9. Vídeos, áudio e comentários

### Importação

- aceitar MP4, WebM e formatos confirmados pelo FFmpeg local;
- copiar para pasta do projeto ou biblioteca do Editor;
- gerar metadados de duração, dimensões, FPS e áudio;
- mostrar erro específico para codec incompatível;
- nunca depender do caminho original do navegador.

### Preview

- usar elemento de vídeo ou decodificador compatível;
- sincronizar o relógio do preview com a timeline;
- permitir play/pause, scrub e salto para evento;
- desenhar comentários relativos ao TikTok;
- manter último frame quando solicitado.

### Áudio

- usar áudio embutido no MP4;
- respeitar `audio: false` e `mute: true`;
- cortar áudio com os mesmos limites do vídeo;
- manter sincronização por tempo absoluto;
- informar quando o vídeo não possui áudio.

## 10. Exportação

### Perfis

| Perfil | Resolução | FPS | Objetivo |
|---|---:|---:|---|
| Final | 1920×1080 | 30 | vídeo final |
| Rápido | 1280×720 | 15 | teste e revisão |

### Pipeline

```text
Validar projeto
    ↓
Resolver timeline
    ↓
Criar snapshots de cena
    ↓
Renderizar frames
    ↓
Compor áudio
    ↓
Executar FFmpeg local
    ↓
Validar MP4 produzido
    ↓
Mover para output final atomicamente
```

### Requisitos

- preview e export devem usar o mesmo runtime;
- exibir progresso por frames/eventos;
- permitir cancelamento;
- remover temporários em erro;
- preservar logs de FFmpeg;
- não sobrescrever export anterior sem backup ou confirmação;
- validar existência de áudio quando esperado;
- registrar perfil, resolução e FPS no resultado.

## 11. Interface do Editor

### Áreas

1. biblioteca de projetos;
2. biblioteca de personagens e assets;
3. Canvas central;
4. timeline vertical/horizontal;
5. Inspector do item selecionado;
6. painel de validação;
7. painel de exportação;
8. chat local da IA.

### Princípios

- manter estética e navegação do Nymi Gacha;
- não misturar o estado do Editor com Studio ou Roteiros;
- mostrar estados de carregamento sem apagar o frame atual;
- mensagens de erro acionáveis;
- acessibilidade por teclado;
- suporte a zoom do Canvas;
- layout responsivo para a janela local;
- confirmação antes de exclusões e substituições.

## 12. IA local

### Integração

- Ollama apenas em loopback;
- modelo padrão configurável, inicialmente Gemma instalado localmente;
- timeout e cancelamento;
- diagnóstico quando Ollama estiver desligado;
- nenhum acesso da IA a shell, filesystem ou FFmpeg.

### Formato da proposta

```json
{
  "operation": "replace_events",
  "reason": "...",
  "changes": [
    { "eventId": "...", "patch": { "pt": "..." } }
  ]
}
```

### Segurança da proposta

- validar schema antes de exibir;
- mostrar diff antes de aplicar;
- permitir aceitar, rejeitar ou aceitar parcialmente;
- preservar texto original;
- nunca aplicar automaticamente;
- registrar modelo, prompt e horário em log local opcional.

## 13. Persistência e recovery

Estrutura proposta:

```text
data/editor-video/
├── projects/
├── assets/characters/
├── assets/tiktoks/
├── assets/backgrounds/
├── outputs/
├── backups/
├── staging/
├── recovery/
└── catalog.json
```

Regras:

- projetos isolados de `data/roteiros` e `data/studio`;
- autosave com debounce de 650 ms;
- backup antes de cada substituição relevante;
- retenção configurável dos últimos backups;
- recovery após queda do servidor ou navegador;
- quarentena de JSON corrompido;
- migrações versionadas e reversíveis.

## 14. Integração com Roteiros

Somente após o núcleo estar estável:

1. Roteiros exporta personagens para o catálogo do Editor;
2. Roteiros exporta vídeos para a biblioteca do Editor;
3. Editor lê o TXT/JSON sem modificar o roteiro original;
4. importador converte blocos em eventos;
5. referências mantêm nome e caminho relativo;
6. ausência do Editor não impede salvar Roteiros;
7. operação “Enviar para Editor” é explícita e confirmada;
8. duplicatas são identificadas por ID/hash, não por nome apenas.

## 15. Testes obrigatórios

### Contratos

- schema mínimo;
- schema legado;
- campos desconhecidos preservados;
- aliases de expressões;
- IDs e paths.

### Assets

- ZIP normal;
- ZIP de variantes;
- pasta com manifest;
- manifest ausente;
- PNG ausente;
- blink/talk parcial;
- caminhos maliciosos;
- limite de arquivos e tamanho;
- nomes Unicode.

### Timeline/runtime

- eventos sequenciais;
- `duration: auto`;
- `clip_start/clip_end`;
- comentários relativos;
- hold de vídeo;
- fallback de expressão;
- blink determinístico;
- talk multi-frame;
- pensamento sem talk.

### Render/export

- preview e export com snapshots iguais;
- posição, escala, rotação e camada;
- balões PT/EN;
- vídeo com e sem áudio;
- cancelamento;
- FFmpeg indisponível;
- saída parcial removida.

### Nymi existente

- Criador continua carregando;
- Studio continua carregando;
- Roteiros continua carregando;
- testes atuais continuam passando;
- nenhum asset de usuário entra no commit;
- build Vinext continua passando.

## 16. Observabilidade e diagnóstico

Criar logs estruturados locais com:

- fase da operação;
- projeto e evento afetados;
- tempo gasto;
- asset ausente;
- warning de fallback;
- comando FFmpeg sem dados sensíveis;
- erro de Ollama;
- motivo de cancelamento.

O usuário deve receber uma mensagem curta e uma opção de detalhes técnicos.

## 17. Segurança local

- servidor limitado a loopback;
- rotas do Editor com validação de origem/token quando necessário;
- limites de upload;
- nomes sanitizados;
- nenhum comando shell recebido diretamente do cliente;
- argumentos FFmpeg construídos por listas, nunca concatenação livre;
- sem execução de scripts vindos de ZIP;
- sem exposição de diretórios arbitrários;
- caminhos resolvidos e verificados dentro de `data/editor-video`.

## 18. Ordem de implementação dentro da fase única

Embora seja uma única fase de entrega, a execução será internamente sequencial:

1. consolidar contratos e schema;
2. finalizar parser e adaptador de catálogo;
3. criar staging e persistência de assets;
4. implementar importação de vídeos e backgrounds;
5. implementar `TimelineResolver`;
6. implementar `SceneRuntime`;
7. implementar renderer Canvas e cache;
8. implementar preview e timeline interativa;
9. implementar Inspector e comandos de edição;
10. implementar balões e comentários;
11. implementar autosave, recovery e undo/redo;
12. implementar probe, áudio e FFmpeg;
13. implementar validação visual e painel de erros;
14. implementar IA como proposta/diff;
15. integrar Roteiros por adaptadores explícitos;
16. executar testes completos;
17. atualizar documentação;
18. criar commit consolidado somente após todos os critérios passarem.

Nenhuma etapa posterior deve mascarar falha de uma etapa anterior.

## 19. Estratégia de commits e rollback

Commits pequenos durante o desenvolvimento:

1. `contratos e schema do editor`;
2. `catalogo e staging de personagens`;
3. `timeline e runtime`;
4. `renderer e preview`;
5. `editor visual e historico`;
6. `midia e exportacao`;
7. `ia e validacao`;
8. `integracao com roteiros`;
9. `beta do editor de video`.

Antes de cada bloco:

- verificar `git status`;
- confirmar que o Nymi Premium não está sendo alterado fora do escopo;
- criar backup quando houver mudança de persistência;
- registrar testes de entrada.

Rollback deve usar commits ou backup nomeado. Não usar `git reset --hard` sem autorização explícita.

## 20. Critérios de aceite da entrega completa

A fase será considerada concluída quando:

- um ZIP real do Criador importar sem intervenção manual;
- poses, blink e talk aparecerem corretamente;
- um personagem puder ser selecionado e editado no Canvas;
- um projeto JSON original abrir sem perda de campos;
- a timeline produzir os mesmos intervalos esperados;
- preview e export forem visualmente equivalentes;
- TikToks exibirem comentários no tempo relativo correto;
- áudio permanecer sincronizado;
- final e rápido exportarem com os perfis definidos;
- cancelamento e recuperação forem testados;
- IA mostrar diff e nunca aplicar silenciosamente;
- Roteiros continuar independente quando o Editor estiver fechado;
- testes, typecheck, lint e build passarem;
- nenhum arquivo do usuário ou asset entrar no commit por acidente;
- documentação de instalação e uso estiver completa.

## 21. Definição de pronto para beta

- todos os testes automatizados verdes;
- smoke test manual com personagem real, roupa, cabelo, poses e expressões;
- smoke test com vídeo real contendo áudio;
- export final validado em player externo;
- recuperação após encerramento forçado;
- projeto movido para outra pasta sem quebrar referências relativas;
- diagnóstico claro para asset faltante;
- sem regressão nas rotas atuais do Nymi Gacha;
- backup restaurável;
- changelog e limitações conhecidas documentados.

## 22. Próximo bloco de execução

Após aprovação deste plano, continuar do estado atual pela implementação de:

1. staging persistente do catálogo;
2. `catalog.json` versionado;
3. importação confirmada de ZIP/folder;
4. tela de biblioteca do Editor;
5. testes reais de extração e recuperação.

Esse bloco não altera o Criador, Studio ou Roteiros; apenas cria a biblioteca isolada do Editor de vídeo.
