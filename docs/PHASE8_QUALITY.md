# Fase 8 — Qualidade e desempenho

Este documento registra a implementação e os critérios de execução da fase 8
do Nymi Gacha. A fase adiciona validações e observabilidade sem mudar o
comportamento das três áreas do produto.

## Comandos

```powershell
npm install
npx playwright install chromium
npm run build
npm run test:unit
npm run test:e2e
npm run test:phase8
npm run benchmark:phase8
npm run visual:compare -- referencia.png candidato.png 0.02
npm run typecheck
npm run lint
npm test
```

`test:phase8` executa build, a suíte unitária e E2E. O E2E inicia o build de
produção pelo wrapper `scripts/production-server.mjs`; isso evita o scanner de
dependências do modo dev e corrige separadores de caminho no Windows. O
Chromium é instalado separadamente pelo Playwright e fica fora do repositório.
`lint` mantém os avisos
pré-existentes de uso de `<img>`, mas não aceita novos erros.

## Cobertura

### Fluxos E2E

`scripts/run-e2e.mjs` inicia um servidor de dados temporário e uma instância
Vinext na porta 6700; `scripts/e2e-check.mjs` usa Chromium real e valida:

- navegação e área ativa Personagens → Studio → Roteiros;
- foco de teclado em controles principais;
- criação de roteiro, inclusão de TikTok e persistência após reload;
- monitoramento de `URL.createObjectURL`/`URL.revokeObjectURL` durante a
  navegação, com limite de URLs ativas inferior a 100.

O servidor E2E usa `GACHA_DATA_ROOT` temporário; nenhum dado pessoal ou pasta
`dados-locais-premium` é modificado.

### Workload de desempenho

`scripts/phase8-benchmark.mjs` cria 100 perfis, 100 roteiros, seis TikToks por
roteiro e oito blocos por TikTok. O teste de regressão aceita até 2.000 ms de
normalização e 15 MB de JSON. A medição desta fase ficou abaixo de 3 ms e 1 MB
na máquina de desenvolvimento.

### Comparação visual

`compare-png.mjs` compara imagens PNG com `sharp`, exigindo dimensões iguais e
calculando pixels alterados, proporção e diferença média. O limite é informado
como fração (`0.02` = 2%); o script não gera nem substitui imagens. A Fase 9
versionou os goldens oficiais em `tests/golden/phase9` e adicionou a captura
determinística em `scripts/phase9-visual.mjs`.

### Acessibilidade e launcher

`accessibility-contract.test.mjs` verifica contratos de teclado, redução de
movimento, nomes ARIA e contraste dos tokens principais. `bat-smoke.test.mjs`
verifica o launcher sem iniciar ou encerrar processos reais: loopback, portas,
serviço oculto, navegador e caminho fora do Premium.

## Limitações e próximos testes de beta

- executar E2E em uma máquina Windows limpa com Node 22.13+;
- exercitar upload de 100 assets e um roteiro longo com vídeos reais;
- testar Ollama/LM Studio desligado, lento e indisponível;
- medir memória/CPU durante importação de folhas grandes;
- revisar as vulnerabilidades de dependências antes de uma distribuição pública.

Esses itens não foram mascarados por mocks na implementação e permanecem
explicitamente como pendências de beta. A execução automatizada local já usa o
build de produção; o wrapper `scripts/production-server.mjs` corrige a
normalização de caminhos estáticos do Vinext no Windows.
