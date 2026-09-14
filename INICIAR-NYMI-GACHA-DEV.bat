@echo off
setlocal
cd /d "%~dp0"
title NYMI GACHA - DESENVOLVIMENTO

echo Iniciando o Nymi Gacha em modo desenvolvimento...
echo.
echo A interface sera atualizada ao vivo quando voce salvar arquivos.
echo O servidor de dados reinicia sozinho somente quando o backend mudar.
echo O app usa a porta 6700 e o servidor de dados usa a porta 6800.
echo Feche esta janela para encerrar os servidores.
echo.

node scripts/live-runner.mjs
set "SERVER_EXIT=%errorlevel%"

echo.
echo Os servidores de desenvolvimento foram encerrados.
if not "%SERVER_EXIT%"=="0" (
  echo O Nymi Gacha encerrou com erro.
  pause
  exit /b 1
)
pause
exit /b 0
