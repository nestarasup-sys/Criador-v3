# Editor de vídeo

Módulo dedicado do Nymi Gacha para a futura criação, edição e pré-visualização
de vídeos. A implementação ficará isolada das áreas `studio` e `roteiros`.
Nesta fase, ela também permanecerá isolada do `Criador de Personagens`.

## Regras iniciais

- Não duplicar nem alterar a lógica existente do Studio, de Roteiros ou do Criador de Personagens.
- Não ler nem modificar diretamente o estado, os assets ou as telas do Criador de Personagens.
- Compartilhar somente contratos e serviços explicitamente definidos.
- Manter o estado e os assets do editor separados até a integração ser aprovada.
- Adicionar cada funcionalidade com testes de regressão e possibilidade de rollback.

## Estrutura planejada

- `components/`: interface e controles do editor.
- `core/`: timeline, composição, camadas e validações puras.
- `storage/`: projetos, mídias, backups e importação/exportação.
- `types.ts`: contratos públicos do módulo.

O módulo ainda não possui comportamento implementado; esta pasta é o ponto de
partida isolado para a próxima etapa.
