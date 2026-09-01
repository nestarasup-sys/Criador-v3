# Status de continuidade — Fabricador de Modelo

Atualizado em 31/08/2026. Branch atual: `app-v4`. Último commit da implementação: `10d7582`; último commit do registro: `c37ce38`.

Este documento registra o estado exato para retomar o trabalho depois. Nenhuma chamada de API externa foi feita nesta rodada.

## O que já foi implementado

### Núcleo de processamento

- Folha 1 obrigatória e Folha 2 opcional.
- Detecção adaptativa de 3 linhas × 7 colunas, com fallback seguro 7×3.
- Proteção vertical entre linhas para evitar que o recorte capture a célula de baixo.
- Limpeza conservadora de fragmentos estranhos nas bordas.
- Chroma key conectado às bordas, tolerância, suavidade, feather, despill e limpeza de bordas.
- Máscara visual separada da máscara estrutural.
- Anatomia estrutural com crânio, mandíbula, pescoço e perfil em 32 faixas.
- Head Master robusto com mediana, MAD, outliers, perfil e melhor trio.
- Estabilização dos trios `default`, `blink` e `talk` antes da calibração.
- Folha 1 com correção estrutural conservadora e limite configurável.
- Folha 2 calibrada globalmente apenas por `scaleX`/`scaleY`, com limite padrão de 8% e microajuste padrão de 2%. Não foi migrado warp regional, scanline, liquify ou deformação por bandas.
- Composição final transparente em 1920×1080, usando `neck-base`, âncora X/Y e escala base de 110%.
- Pontuação por estabilidade, escala, posição, proporção, silhueta, mandíbula e pescoço.

### Interface

- Grade única para 21 ou 42 sprites.
- Filtros `Alternar 21/42`, `Folha 1 (21)` e `Folha 2 (21)`.
- Comparador de expressão por folha, coluna e estado.
- Ghost entre as folhas.
- Flicker alternando de fato entre as imagens comparadas.
- Animação do trio na sequência `default → blink → default → talk → default`.
- Editor individual de escala, `scaleX`, `scaleY`, deslocamento X/Y, reset, aplicar, copiar para o trio e marcar como revisado.
- Indicadores de `OK`, `Revisar`, `Crítico` e `Revisado`.
- Controles reais de calibração: escala, intensidade e limites das folhas, chroma, recorte, padding, recorte justo, recorte quadrado e âncora.
- Layout com rolagem vertical.

### Salvamento e integração

- Validação de 21 ou 42 sprites antes do salvamento.
- Nomes duplicados são rejeitados.
- Pasta de destino existente não é sobrescrita.
- `model.json` recebe `head-only`, `neck-base`, âncora, escala base, dimensões e expressões.
- O endpoint local continua sendo `/models/fabricator`.
- O catálogo consulta `/models` dinamicamente, descobre expressões extras e usa versão baseada nos arquivos.
- O Criador é atualizado pelo evento `nymi:models-updated`, sem exigir reinício do servidor.
- O Studio e Roteiros continuam consumindo o catálogo existente.
- Crítico não revisado bloqueia o salvamento; warning não bloqueia; crítico marcado como revisado pode ser salvo conscientemente.

## Arquivos criados ou alterados

Núcleo novo/principal:

- `app/Ferramentas/fabricador-de-modelo/types/face-model.ts`
- `app/Ferramentas/fabricador-de-modelo/utils/statistics.ts`
- `app/Ferramentas/fabricador-de-modelo/core/structural-mask.ts`
- `app/Ferramentas/fabricador-de-modelo/core/anatomy.ts`
- `app/Ferramentas/fabricador-de-modelo/core/head-master.ts`
- `app/Ferramentas/fabricador-de-modelo/core/quality.ts`
- `app/Ferramentas/fabricador-de-modelo/core/normalization.ts`
- `app/Ferramentas/fabricador-de-modelo/core/chroma-key.ts`
- `app/Ferramentas/fabricador-de-modelo/core/detection.ts`
- `app/Ferramentas/fabricador-de-modelo/core/fragment-cleaner.ts`
- `app/Ferramentas/fabricador-de-modelo/core/crop.ts`
- `app/Ferramentas/fabricador-de-modelo/core/compositor.ts`
- `app/Ferramentas/fabricador-de-modelo/core/build-model.ts`
- `app/Ferramentas/fabricador-de-modelo/constants/expressions.ts`

Interface/documentação:

- `app/Ferramentas/fabricador-de-modelo/page.tsx`
- `app/Ferramentas/fabricador-de-modelo/components/CalibrationPanel.tsx`
- `app/Ferramentas/fabricador-de-modelo/components/ComparisonPlayer.tsx`
- `app/Ferramentas/fabricador-de-modelo/components/ManualAdjustmentPanel.tsx`
- `app/Ferramentas/fabricador-de-modelo/components/PreviewGrid.tsx`
- `app/Ferramentas/fabricador-de-modelo/components/QualityPanel.tsx`
- `app/Ferramentas/ferramentas.module.css`
- `app/Ferramentas/fabricador-de-modelo/README.md`
- `local-data-server.mjs`

Testes:

- `tests/fabricador-model.test.mjs`
- `scripts/e2e-check.mjs`

O HTML experimental `app/Ferramentas/fabricador-de-modelo/assets/importador-folha-rostos-v11.1 (1).html` continua apenas como referência e não foi incluído nos commits.

## Commits desta etapa

- `0097f67` — integração inicial da calibração avançada.
- `ad747dd` — correção de tipagem da calibração da extensão.
- `7305d79` — detecção determinística.
- `557089d` — revisão visual, qualidade e ajustes manuais.
- `785d659` — limpeza de avisos do núcleo.
- `247a304` — estabilização do perfil da extensão.
- `f185f06` — documentação do fluxo.
- `d870eab` — comparação entre as duas folhas.
- `9b16a6d` — teste visual da ferramenta.
- `4780c65` — controles completos, recorte e regra de revisão no salvamento.
- `e8ec385` — upload e geração real no teste de navegador.
- `b66ccae` — documentação dos controles e revisão.
- `10d7582` — correção definitiva do Flicker e da animação do trio.

## Validações já executadas

Após a retomada, a bateria foi executada novamente depois do ajuste final do comparador:

- `npm run typecheck` — passou.
- `npm run test:unit` — 125 testes passaram.
- `npm run build` — passou.
- `npm run test:e2e` — passou; o Playwright abriu a ferramenta, verificou a rolagem, enviou um PNG sintético e gerou 21 sprites.
- `npx eslint app/Ferramentas/fabricador-de-modelo --quiet` — passou.
- `node --test tests/fabricador-model.test.mjs` — 2 testes passaram, incluindo Flicker e a sequência `default → blink → default → talk → default`.

## O que falta fazer

O ajuste final foi revalidado com sucesso. O próximo passo opcional é a validação visual com uma Folha 1 e uma Folha 2 reais no Chrome.

Validações funcionais ainda não cobertas integralmente pelo Playwright:

- upload simultâneo de Folha 1 + Folha 2 real e geração de 42 sprites;
- salvamento real de um modelo pelo botão e confirmação visual no Criador;
- exportação com folhas reais do usuário;
- comparação visual de qualidade com folhas reais, pois não há uma folha real versionada de teste no repositório.

Esses pontos são validação de ambiente/dados reais, não motivo para reabrir a arquitetura. O fluxo implementado já está utilizável para testar a ferramenta.

## Estado do diretório de trabalho

Há alterações manuais do usuário que foram preservadas e não devem ser revertidas nem incluídas em commits:

- exclusões do `public/models/modelos/feminino/modelo-6/`;
- alterações manuais nos modelos `modelo-8` e `modelo-9`;
- pastas novas `modelo-10`, `modelo-11` e `modelo-12`;
- HTML experimental citado acima.

Para voltar com segurança ao estado completo desta implementação, use o commit `10d7582` como ponto de referência (ou `c37ce38` para incluir este registro). Não use `git reset --hard` sem antes preservar os assets manuais listados acima.
