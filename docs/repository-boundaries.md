# Fronteiras do repositório

Este documento define o que pertence ao código-fonte do Nymi Gacha e o que é estado local de trabalho.

## Código versionado

Devem permanecer no Git:

- `app/`: interface e regras de apresentação;
- `services/`: serviços locais e persistência;
- `tests/`: testes e fixtures pequenas, estáveis e deliberadas;
- `scripts/`: automação de desenvolvimento e QA;
- `public/`: assets estáticos de fábrica necessários para uma instalação limpa;
- configurações de build, lint, TypeScript e CI;
- documentação técnica.

## Dados que nunca devem ser versionados

Devem permanecer somente na máquina de trabalho:

- `dados-locais-premium/` e `dados-locais/`;
- personagens e checkpoints criados pelo usuário;
- vídeos importados;
- exports e backups;
- arquivos do Studio/Roteiros produzidos durante uso;
- `public/models/modelos/*`, exceto o README sentinela;
- caches, logs, resultados de teste e builds.

## Motivo

O Git precisa representar uma instalação reproduzível do produto, não uma cópia do computador do autor. Misturar os dois aumenta drasticamente o repositório, torna clones e CI frágeis e cria risco de exposição de dados locais.

## Política de migração

A branch `autonomous-overhaul` parte de uma fotografia íntegra da `V12`. Os dados locais removidos do tracking continuam recuperáveis no histórico anterior; a limpeza não reescreve o histórico e não apaga a cópia local de ninguém.

## Regra para assets de fábrica

Um asset só deve entrar no repositório quando for necessário para uma instalação vazia funcionar. Assets gerados pelo Criador/Fabricador pertencem ao diretório de dados do usuário, não ao bundle de origem.

## Gate obrigatório

O CI deve falhar caso qualquer caminho local proibido volte a ser rastreado ou caso arquivos grandes não autorizados entrem no código.
