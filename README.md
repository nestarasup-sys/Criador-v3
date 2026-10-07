# Nymi Gacha

Aplicação local para criação de personagens, Fabricador de modelos, Studio, Roteiros, Base de dados e fluxos de vídeo.

A arquitetura atual é **local-first**: o código fica no Git; seus dados reais de trabalho ficam somente no PC.

## Requisitos

- Windows;
- Node.js **22.13.0 ou superior** (inclui npm);
- Git, para clonar/atualizar;
- FFmpeg + ffprobe são recomendados para normalização e leitura de vídeos, mas não são necessários para abrir o editor.

## Abrir o aplicativo

Na pasta do projeto, execute:

`INICIAR-NYMI-GACHA.bat`

No primeiro uso ou quando `package-lock.json`/Node mudarem, o launcher executa `npm ci` automaticamente. Depois ele cria o build e sobe:

- interface: `http://localhost:6700`;
- dados locais: `http://127.0.0.1:6800`.

## Criando uma pasta nova

O procedimento completo está em [docs/FRESH_CLONE.md](docs/FRESH_CLONE.md).

Resumo:

```bat
git clone -b autonomous-overhaul https://github.com/nestarasup-sys/Criador-v3.git "C:\TRABALHO 2\NYMI-GACHA-NOVO"
cd /d "C:\TRABALHO 2\NYMI-GACHA-NOVO"
npm run migrate:local -- "C:\CAMINHO\DA\PASTA-ANTIGA"
```

A migração **copia**, não move, os dados ignorados pelo Git. Se quiser começar vazio, simplesmente pule o comando de migração.

## Onde ficam os dados

Por padrão:

- dados do app: `dados-locais-premium/`;
- modelos fabricados: `public/models/modelos/`;
- prints: `C:\PRINTS GACHA NYMI`;
- exportação Editor V4: configurável por `GACHA_EDITOR_V4_PROJECTS_ROOT`.

`dados-locais-premium/` e modelos gerados são deliberadamente ignorados pelo Git. Isso evita repositório gigantesco, exposição de dados e clones frágeis.

Veja `.env.example` para sobrescrever caminhos/portas com `.env.local`.

## Diagnóstico

```bat
npm run doctor
```

O diagnóstico verifica Node/npm, dependências, permissões de gravação, FFmpeg/ffprobe e o caminho do Editor V4.

## Desenvolvimento e qualidade

- `npm run bootstrap:local`: sincroniza `node_modules` com o lockfile.
- `npm run dev`: interface em modo desenvolvimento.
- `npm run data-server`: serviço de dados local.
- `npm run build`: build de produção.
- `npm run typecheck`: TypeScript.
- `npm run lint`: ESLint.
- `npm run test:unit`: testes unitários e de contrato.
- `npm run check:quality`: higiene + budgets + sintaxe + typecheck + lint + build + testes.
- `npm run test:e2e:fabricador`: smoke E2E do Fabricador.
- `npm run migrate:local -- "PASTA-ANTIGA"`: copia dados locais para um checkout novo.

## Regra do repositório

O Git representa uma instalação reproduzível do produto, não uma cópia do computador do autor. O CI falha se dados locais, modelos gerados, caches ou arquivos grandes proibidos voltarem a ser rastreados.
