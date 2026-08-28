@echo off
setlocal
cd /d "%~dp0"
title NYMI GACHA - DESENVOLVIMENTO

echo Iniciando o Nymi Gacha em modo desenvolvimento...
echo.
echo O app sera recompilado e atualizado automaticamente quando voce salvar arquivos.
echo O servidor de dados permanece aberto na porta 6800 e o app usa a porta 6700.
echo Feche esta janela para encerrar os servidores.
echo.

echo Preparando o build inicial...
call npm run build
if errorlevel 1 (
  echo.
  echo Falha no build inicial.
  pause
  exit /b 1
)

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
