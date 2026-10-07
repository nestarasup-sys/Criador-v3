# Clone limpo — Nymi Gacha

Este é o procedimento recomendado para criar uma pasta nova sem carregar lixo estrutural do checkout antigo.

## 1. Clone a branch estabilizada

```bat
git clone -b autonomous-overhaul https://github.com/nestarasup-sys/Criador-v3.git "C:\TRABALHO 2\NYMI-GACHA-NOVO"
cd /d "C:\TRABALHO 2\NYMI-GACHA-NOVO"
```

Não copie `node_modules`, `dist`, `.next` ou caches da pasta antiga.

## 2. Copie seus dados locais, se quiser manter o trabalho antigo

O Git **não** contém personagens, vídeos, modelos fabricados, backups nem outros dados de trabalho.

Na pasta nova:

```bat
npm run migrate:local -- "C:\CAMINHO\DA\PASTA-ANTIGA"
```

Esse comando só copia:

- `dados-locais-premium/`;
- `public/models/modelos/` (sem substituir o README sentinela);
- `.env.local`, quando existir.

Ele não move nem apaga nada da pasta antiga. Arquivos que já existem na pasta nova são preservados por padrão.

Se você deliberadamente quiser sobrescrever conflitos:

```bat
npm run migrate:local -- "C:\CAMINHO\DA\PASTA-ANTIGA" --overwrite
```

## 3. Primeira abertura

Dê duplo clique em:

`INICIAR-NYMI-GACHA.bat`

O launcher:

1. verifica se Node.js 22.13+ existe;
2. instala/sincroniza dependências com `npm ci` somente quando necessário;
3. encerra instâncias antigas do servidor nas portas 6700/6800;
4. cria um build de produção atualizado;
5. inicia o servidor de dados e a interface;
6. abre `http://localhost:6700/`.

O primeiro boot pode demorar mais porque instala dependências e compila a aplicação.

## 4. Diagnóstico local

Se algo não abrir:

```bat
npm run doctor
```

Erros bloqueantes: Node/npm, dependências ou permissão de gravação.

Avisos: FFmpeg/ffprobe ou Editor V4 ausentes. Eles afetam recursos específicos, não o editor inteiro.

## 5. Pastas que não devem ir para Git

Nunca versione:

- `dados-locais-premium/`;
- `dados-locais/`;
- `public/models/modelos/*`, exceto o README;
- `node_modules/`;
- `dist/`, `.next/`, `.wrangler/`;
- `.env` ou `.env.local`;
- backups, logs, caches e resultados de teste.

O CI possui um gate que bloqueia o retorno desses arquivos ao repositório.
