# Fase 9 — Beta e substituição opcional

Esta fase transforma o estado do projeto em um candidato a beta verificável.
O objetivo é permitir teste em cópia isolada, confirmar rollback, registrar
goldens visuais e garantir que falhas de IA local não derrubem o aplicativo.
O Gacha Premium continua fora do escopo e não é usado como destino de escrita.

## Gates automatizados

```powershell
npm install
npx playwright install chromium
npm run build
npm run test:unit
npm run test:beta
npm run test:e2e
npm run visual:phase9
npm run typecheck
npm run lint
npm run security:phase9
npm test
```

`test:beta` cobre:

- cópia de um estado para uma pasta temporária;
- backup, alteração e restauração reversível;
- preservação de campos futuros e referências de vídeos;
- provedor Ollama local funcionando;
- provedor desligado com mensagem acionável;
- rejeição de endereço remoto de IA;
- normalização de 200 roteiros, três TikToks e quatro blocos por seção.

`visual:phase9` captura Criador, Studio e Roteiros em Chromium e compara as
imagens com `tests/golden/phase9`. Para atualizar os goldens intencionalmente:

```powershell
npm run visual:phase9 -- --update
```

Uma atualização de golden deve acompanhar uma justificativa no commit. O
limiar padrão de comparação é zero para a própria captura; diferenças entre
máquinas devem ser avaliadas manualmente, não mascaradas aumentando o limite.

## Segurança e dependências

O runtime de produção está fixado em Next 16.2.12, React 19.2.8, Vinext
0.0.50 e Vite 8.0.13; o Playwright de desenvolvimento está em 1.62.1 e o
esbuild direto em 0.28.0 para manter o toolchain reproduzível. Não foi usado
`npm audit fix --force`, pois ele propunha alterações incompatíveis no Drizzle.

`npm run security:phase9` executa
`npm audit --omit=dev --audit-level=high` e passou com zero vulnerabilidades de
produção. A auditoria completa ainda reporta vulnerabilidades transitivas de
ferramentas de desenvolvimento; elas não entram no runtime e ficam registradas
para revisão antes de qualquer publicação pública.

Em Windows, `scripts/production-server.mjs` corrige a indexação de caminhos
estáticos do Vinext 0.0.x antes de iniciar o servidor de produção. O script
`start` e os harnesses E2E/visual usam esse wrapper.

## Estado dos critérios do roadmap

| Critério | Estado |
|---|---|
| Paridade funcional automatizada | atendida pelas 60 unitárias + E2E |
| Migração/rollback em cópia isolada | atendida por `test:beta` |
| Premium original sem escrita | atendido; nenhum script aponta para ele durante os testes |
| Manual de backup e rollback | atendido pela documentação de recuperação e pelo teste beta |
| Zero vulnerabilidade alta/crítica | atendido por `security:phase9` |
| Windows 10/11 limpo | pendente de execução em máquina limpa |
| Validação de uso real pelo usuário | pendente de aceite manual |

## Beta manual restante

- executar o instalador/launcher em Windows 10 e 11 sem dependências de
  desenvolvimento;
- testar folhas grandes, 100 uploads reais e vídeos TikTok longos;
- verificar Ollama/LM Studio lento, desligado e com modelo inválido;
- confirmar prints, ZIPs e exportações em uma pasta de dados copiada;
- comparar visualmente os três goldens em uma tela diferente;
- aprovar o comportamento do Criador, Studio e Roteiros em uso diário.

O aplicativo só deve substituir o Premium depois desses itens manuais e de um
backup externo da pasta de dados.
