# Roteiros — Base de Dados e Importação de Roteiros por IA

## Objetivo

Transformar a área independente **Base de dados** em uma fonte organizada de vídeos e personagens para uma IA externa. A IA receberá um TXT com todos os vídeos cadastrados e somente os personagens escolhidos; depois devolverá um JSON validado que criará um roteiro novo dentro de **Roteiros**.

O campo **tempo que termina a cena da descrição** é uma informação operacional: ao importar o JSON, ele será copiado para o campo \`sceneEndSeconds\` do TikTok criado. Esse é o ponto a partir do qual as falas e pensamentos podem começar.

## Regras definitivas

- Os personagens disponíveis vêm do Criador de Personagens.
- A seleção consulta os personagens do Criador, mas a ficha exportada é somente a ficha narrativa do Roteiros: personalidade, história, relações, estilo de fala, regras e relacionamentos narrativos.
- Os caminhos dos vídeos exportados são absolutos.
- A IA pode escolher e reorganizar os vídeos livremente.
- Um mesmo vídeo não pode aparecer mais de uma vez no roteiro importado.
- A exportação inclui todos os vídeos cadastrados e somente os personagens selecionados.
- O botão Salvar da Base de dados será substituído por salvamento automático.
- O botão Importar de Roteiros será renomeado para **Importar roteiro da IA**.
- A importação sempre cria um roteiro novo e nunca sobrescreve um roteiro existente.
- Os tipos de bloco permitidos no JSON novo são somente \`speech\` e \`thought\`.
- A IA referencia vídeos e personagens por ID; o app resolve os dados localmente e não confia em caminhos enviados pela IA.

## Fase 0 — Preparação e contratos

- Auditar os contratos atuais de Base de dados, Criador e Roteiros.
- Registrar este plano em \`docs/ROTEIROS_BASE_DE_DADOS_PLANO.md\`.
- Criar os formatos versionados \`NYMI_BASE_DATABASE_EXPORT_V2\` e \`NYMI_IMPORTABLE_SCRIPT_V1\`.
- Preservar compatibilidade com estados antigos da Base de dados e Roteiros.
- Criar IDs estáveis para vídeos, sem depender do nome original do arquivo.
- Definir o adaptador de importação para o contrato atual de \`ScriptProject\`, \`TikTokSection\` e \`ReactionBlock\`.
- Criar commit local de segurança antes das alterações de código.

## Fase 1 — Salvamento automático

- Remover o botão Salvar dos cards.
- Salvar descrição e tempo final automaticamente depois de uma pausa na digitação.
- Usar debounce e fila de gravação para não perder a última alteração.
- Isolar os drafts por ID de vídeo.
- Cancelar ou substituir gravações obsoletas.
- Sincronizar o card depois da resposta do servidor.
- Manter o estado íntegro em recarregamentos e trocas rápidas de campo.
- Evitar faixas grandes de aviso na interface.
- Testar edição, troca de vídeo, reload e gravações consecutivas.

## Fase 2 — Identidade e integridade dos vídeos

- Preservar sequência visual 01, 02, 03 etc.
- Persistir ID interno estável para cada item.
- Invalidar o cache do player com \`updatedAt\`.
- Impedir que vídeo excluído reapareça ao adicionar outro.
- Detectar arquivo ausente na pasta local.
- Não usar nome original como chave.
- Preservar duração calculada, descrição e \`sceneEndSeconds\`.
- Testar exclusão, reimportação e arquivos removidos manualmente.

## Fase 3 — Seleção de personagens

- Adicionar o botão **Selecionar personagens** ao lado de Exportar dados.
- Carregar personagens do Criador pelo endpoint local atual.
- Mostrar ID, nome, modelo, miniatura e checkbox.
- Adicionar busca, seleção individual, limpar seleção e contador.
- Persistir a seleção durante a sessão e recuperar a seleção válida após reload.
- Não exportar personagens fora da seleção.
- Usar os dados do Criador apenas para identificar e apresentar o personagem no seletor; não exportar ajustes, roupas, modelos ou fotos.
- Anexar a ficha narrativa e relacionamentos existentes no Roteiros.

## Fase 4 — Exportação TXT

- Exportar todos os vídeos cadastrados.
- Exportar caminho absoluto, ID, sequência, nome original, descrição, duração total e tempo final da cena.
- Exportar somente os personagens selecionados.
- Incluir ID, nome e somente a ficha narrativa de Roteiros de cada personagem.
- Separar vídeos e personagens com marcadores claros.
- Preservar acentos, quebras de linha e conteúdo vazio de forma explícita.
- Não exportar blocos antigos de nenhum roteiro.
- Usar o cabeçalho \`NYMI_BASE_DATABASE_EXPORT_V2\`.
- Criar testes de conteúdo, seleção, caminhos e ausência de dados.

## Fase 5 — Guia reutilizável para IA

- Fazer Exportar guia gerar um Markdown independente de qualquer roteiro.
- Explicar o TXT, IDs, ordem livre e proibição de duplicidade.
- Explicar falas, pensamentos, vídeos e o tempo final da cena.
- Descrever o JSON obrigatório e campos opcionais.
- Instruir a IA a retornar apenas JSON válido.
- Proibir IDs, caminhos, vídeos e personagens inventados.
- Incluir exemplos válidos e inválidos.
- Explicar que o app usa a Base de dados local como fonte de verdade para duração, descrição e \`sceneEndSeconds\`.

## Fase 6 — JSON importável

Formato mínimo:

\`\`\`json
{
  "format": "NYMI_IMPORTABLE_SCRIPT_V1",
  "title": "Novo roteiro",
  "videos": [{ "videoId": "video-01", "order": 1 }],
  "characters": [{ "characterId": "personagem-01", "role": "principal" }],
  "blocks": [{
    "type": "speech",
    "characterId": "personagem-01",
    "videoId": "video-01",
    "text": "Texto da fala",
    "startAt": 10
  }]
}
\`\`\`

- Aceitar somente \`speech\` e \`thought\`.
- Exigir IDs existentes.
- Rejeitar vídeo repetido.
- Permitir ordem escolhida pela IA.
- Usar \`order\` para organizar os TikToks.
- Usar \`startAt\` opcional; quando ausente, usar o fim da descrição.
- Impedir falas e pensamentos antes de \`sceneEndSeconds\`.
- Não aceitar caminhos como fonte de verdade.

## Fase 7 — Importar roteiro da IA

- Renomear o botão Importar para **Importar roteiro da IA**.
- Aceitar JSON.
- Ler e validar sem gravar imediatamente.
- Mostrar prévia com título, vídeos, ordem, personagens, falas, pensamentos, erros e avisos.
- Permitir cancelar.
- Criar roteiro novo com ID novo.
- Criar backup do estado antes de confirmar.
- Limpar o input após o processo.
- Nunca substituir roteiro existente.

## Fase 8 — Montagem do roteiro

- Resolver vídeos por ID na Base de dados.
- Copiar caminho local, nome, duração e descrição.
- Copiar \`sceneEndSeconds\` para o campo do TikTok do roteiro.
- Criar TikToks na ordem do JSON.
- Resolver personagens por ID no Criador.
- Criar participantes ativos.
- Copiar ficha narrativa para o snapshot \`aiContext\` do roteiro.
- Criar blocos de fala e pensamento.
- Gerar IDs novos para seções e blocos.
- Preservar horários válidos.
- Permitir edição normal depois da importação.

## Fase 9 — Validação e erros

- Rejeitar JSON inválido, versão desconhecida, IDs ausentes, vídeo duplicado, bloco sem texto, personagem ausente, tipo inválido e tempo negativo.
- Diferenciar erro crítico de aviso.
- Não salvar roteiro parcial.
- Mostrar o item e campo que causaram o problema.
- Avisar quando um bloco foi ajustado para o início mínimo da cena.
- Avisar quando um arquivo local do vídeo não está disponível.
- Manter o TXT e JSON originais intactos.

## Fase 10 — Testes

- Testar autosave com digitação rápida e dois vídeos.
- Testar exclusão e substituição de vídeo.
- Testar exportação com zero, um e vários personagens.
- Testar ficha narrativa, acentos, quebras de linha e relacionamentos.
- Testar caminhos absolutos.
- Testar todos os vídeos e seleção de personagens.
- Testar guia sem dados específicos.
- Testar JSON válido, inválido, duplicado e incompleto.
- Testar ordem personalizada.
- Testar falas, pensamentos e tempo mínimo.
- Testar roteiro novo sem alterar roteiros existentes.
- Rodar testes unitários, typecheck, build e diff check.

## Fase 11 — Commits e entrega

- Criar commit de segurança antes da implementação.
- Criar commits locais por grupo funcional.
- Manter árvore limpa após cada entrega.
- Registrar nos commits o que foi implementado.
- Confirmar que os dados antigos continuam legíveis.
- Entregar o hash final e instruções de teste manual.

## Critério de conclusão

A implementação estará 100% concluída quando for possível:

1. Cadastrar vídeos e preencher descrição/tempo sem clicar em Salvar.
2. Selecionar personagens do Criador.
3. Exportar TXT com todos os vídeos e somente os personagens escolhidos.
4. Exportar o guia uma vez.
5. Receber um JSON da IA.
6. Importar o JSON pelo botão Importar roteiro da IA.
7. Visualizar a prévia e confirmar.
8. Abrir um roteiro novo com vídeos, descrições, duração, fim da cena, personagens, falas e pensamentos corretos.
9. Editar o roteiro normalmente sem afetar a Base de dados ou roteiros anteriores.

## Auditoria de execução — 2026-08-18

Status: **concluído em 100%** na branch local de testes.

- [x] Checkpoint local reversível criado antes da auditoria: `13b1a12`.
- [x] Autosave com debounce, fila por vídeo, cancelamento de edição obsoleta e proteção contra erro de rede.
- [x] IDs estáveis, sequência visual sem reutilização automática e invalidação de cache do player.
- [x] Detecção de arquivo local removido, com `fileAvailable` e aviso visual no card.
- [x] Seletor de personagens com miniatura, busca, ID, modelo, contador, limpeza e persistência local.
- [x] Exportação TXT V2 com todos os vídeos, caminhos absolutos, tempos, ID/nome e somente a ficha narrativa dos personagens escolhidos.
- [x] Guia independente com regras, schema, exemplos válidos e inválidos, incluindo `speech` e `thought`.
- [x] Importador V1 com prévia detalhada, validação de IDs, duplicidades, duração, caminho, tempos e tipos.
- [x] Criação de roteiro novo, cópia local dos vídeos por ID, `sceneEndSeconds`, fichas narrativas, blocos ordenados e rollback de cópias incompletas.
- [x] Backup obrigatório antes da confirmação da importação; falha no backup impede a operação.
- [x] Testes unitários, typecheck, build, lint e verificação de diff executados com sucesso após a conclusão.

### Reversão

Para voltar exatamente ao estado anterior à auditoria, usar `git reset --hard 13b1a12` na branch local. O commit final da auditoria será informado junto com os resultados de validação.
