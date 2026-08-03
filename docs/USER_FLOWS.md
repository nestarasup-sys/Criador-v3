# Fluxos de usuário

## Convenções

- **PC disponível**: o serviço em `127.0.0.1:6800` respondeu após autenticar a sessão efêmera.
- **Espelho**: cópia emergencial no navegador, nunca apresentada como persistência principal.
- Todos os fluxos de escrita terminam com confirmação real de persistência.

## 1. Criar um personagem

1. Abrir **Personagens**.
2. Clicar em **Novo personagem**.
3. Escolher gênero e modelo.
4. Informar o nome.
5. Selecionar cabelo, rosto e roupa.
6. Ajustar encaixe, camadas, máscaras e cor quando necessário.
7. Conferir expressões normal, blink e talk.
8. Salvar.
9. O app grava no PC, atualiza a foto estável do personagem e exibe `Salvo no PC`.

Erros: se o serviço estiver indisponível, manter a edição aberta, explicar o que
foi salvo apenas no espelho e oferecer nova tentativa.

## 2. Importar uma roupa com variantes

1. Abrir a categoria **Roupas**.
2. Escolher **Folha**.
3. Selecionar uma imagem com fundo transparente ou chroma.
4. O app estima a cor de fundo, remove apenas o fundo conectado e descontamina bordas.
5. Detecta cada região pelo conteúdo visível.
6. Recorta do primeiro ao último pixel útil com margem.
7. Normaliza todas as variantes para um canvas comum sem distorcer o conteúdo.
8. Exibe uma tela de confirmação para ordenar, remover e reprocessar variantes.
9. A primeira vira capa/padrão; todas aparecem em **Variantes**.
10. Salvar posição/cor/máscara aplica o vínculo correto ao grupo.

## 3. Corrigir uma importação

1. Selecionar o item.
2. Usar **Chroma key** para escolher cor, tolerância e suavidade.
3. Alternar `Segure: original` para comparar.
4. Salvar ou cancelar sem modificar o arquivo original.
5. Usar **Encaixar** para posição/escala/rotação.
6. Usar **Borracha** na camada correta para remover sobra.
7. Usar **Cor** e a máscara de proteção para preservar detalhes.

## 4. Exportar um personagem

### PNG atual

1. Selecionar personagem e expressão.
2. Conferir o canvas transparente.
3. Clicar **Exportar PNG**.
4. Receber exatamente o frame mostrado, sem UI.

### Pack ZIP

1. Salvar o personagem.
2. Clicar **Exportar ZIP**.
3. O app resolve todas as expressões suportadas pelo modelo.
4. Compõe modelo, roupa, cabelo, cor e máscaras para cada frame.
5. Entrega ZIP compatível com o fluxo atual do Video Maker.

## 5. Criar uma cena no Studio

1. Abrir **Studio** e criar uma cena.
2. Selecionar fundo.
3. Adicionar personagens do elenco e objetos.
4. Arrastar, redimensionar, rotacionar e ordenar camadas.
5. Adicionar narrador, fala ou pensamento.
6. Editar texto e propriedades do balão.
7. Opcionalmente gerar inglês com IA local.
8. Desfazer/refazer quando necessário.
9. Aguardar `Salvo no PC`.

## 6. Gerar um print do Studio

1. Abrir a cena e entrar em **View**, se desejado.
2. Clicar **Print**.
3. O app renderiza 1920×1080 sem controles.
4. O serviço salva o PNG na pasta configurada.
5. Exibe nome/caminho e permite **Abrir pasta**.

## 7. Preparar fichas para IA

1. Abrir **Roteiros → Personagens**.
2. Selecionar um personagem vindo do Criador.
3. Preencher campos amplos: personalidade, história, relação com FYN, estilo de fala e regras.
4. Adicionar relações direcionais com outros personagens.
5. Aguardar confirmação de autosave.

## 8. Criar e editar um roteiro

1. Abrir **Roteiros** e clicar **Criar roteiro**.
2. Informar nome e selecionar participantes.
3. Escrever contexto geral.
4. Adicionar um TikTok.
5. Escrever título, objetivo, descrição, tempo e instruções.
6. Adicionar/substituir vídeo e conferir o preview.
7. Criar blocos e escolher personagem, tipo e emoção.
8. Preencher manualmente ou usar IA seletivamente.
9. Revisar PT/EN, ordenar e duplicar blocos.
10. Adicionar próximos TikToks.
11. Aguardar `Salvo no PC`.

## 9. Usar IA local em Roteiros

1. Em **IA e regras**, selecionar Ollama ou LM Studio.
2. Informar endpoint e modelo ou atualizar a lista.
3. Testar conexão.
4. Configurar criatividade, tamanho e contexto histórico.
5. No TikTok, usar melhorar contexto, preencher vazios ou substituir todos.
6. Confirmar ações destrutivas antes de sobrescrever blocos.
7. Em falha/timeout, preservar o texto anterior e permitir nova tentativa.
8. Com IA desativada, todas as funções manuais continuam disponíveis.

## 10. Exportar um roteiro para o fluxo externo

1. Abrir o roteiro concluído.
2. Exportar vídeos para a pasta nomeada pelo roteiro.
3. Exportar personagens participantes como packs completos.
4. Exportar o texto/JSON necessário.
5. Usar **Ir à pasta** para cada destino permitido.
6. Arquivos existentes são substituídos somente conforme a regra explícita do fluxo.

## 11. Recuperar dados

1. O app detecta falha do serviço ou uma entrada `pending` mais nova no journal
   de recuperação do navegador.
2. Mostra a origem e a data da cópia encontrada, sem mesclagem silenciosa.
3. O usuário escolhe **Usar recuperação** ou **Descartar**; ao restaurar um
   backup do PC, uma cópia de segurança é criada antes da escrita.
4. Na aba **IA e regras**, o usuário pode listar, criar e restaurar backups do
   PC, com confirmação explícita.
5. O serviço recarrega e valida o documento; JSON corrompido é colocado em
   quarentena antes de recuperar o último backup válido.

O fluxo de recuperação da Fase 7 está implementado e detalhado em
`docs/ROTEIROS_RECOVERY.md`.
