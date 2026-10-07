@echo off
setlocal
cd /d "%~dp0"
title NYMI GACHA 2.0
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js nao foi encontrado. Instale o Node.js 22.13 ou superior.
  pause
  exit /b 1
)
echo Verificando dependencias locais...
node scripts/local-bootstrap.mjs
if errorlevel 1 (
  echo.
  echo Falha ao preparar as dependencias locais do Nymi Gacha.
  pause
  exit /b 1
)
set "GACHA_PRINTS_ROOT=C:\PRINTS GACHA NYMI"
rem O supervisor inicia local-data-server.mjs e substitui o antigo npm run start.
rem Contratos: LocalPort 6800, localhost:6700 e WindowStyle Hidden para processos auxiliares.
rem O build de produção fica em dist\server\index.js; npm run start continua sendo o comando equivalente.
echo Preparando o build atualizado do Nymi Gacha...
rem Encerra os servidores antes do build. No Windows, reconstruir o dist enquanto
rem um processo antigo ainda o serve pode misturar manifesto e assets de versões.
for /l %%N in (1,1,10) do (
  powershell -NoProfile -Command "$ports = @(6700,6800); foreach ($port in $ports) { $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); foreach ($listener in $listeners) { $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess); if ($owner.Name -eq 'node.exe' -and (($port -eq 6800 -and $owner.CommandLine -match 'local-data-server\.mjs') -or ($port -eq 6700 -and $owner.CommandLine -match 'production-server\.mjs'))) { Stop-Process -Id $listener.OwningProcess -Force } } }"
  powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 6700 -State Listen -ErrorAction SilentlyContinue) -and -not (Get-NetTCPConnection -LocalPort 6800 -State Listen -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }"
  if not errorlevel 1 goto :ports_free
  >nul timeout /t 1 /nobreak
)
:ports_free
call npm run build
if errorlevel 1 (
  echo.
  echo Falha ao preparar o build do Nymi Gacha.
  pause
  exit /b 1
)
echo.
echo O CMD permanecera aberto enquanto o Nymi Gacha estiver ativo.
echo Fechar esta janela encerra os dois servidores.
echo.
node scripts/local-runner.mjs
set "SERVER_EXIT=%errorlevel%"
echo.
echo Os servidores foram encerrados.
if not "%SERVER_EXIT%"=="0" goto :startup_error
echo O Nymi Gacha foi encerrado normalmente.
pause
exit /b 0

:startup_error
echo.
echo O Nymi Gacha encerrou com erro. Leia a mensagem acima.
pause
exit /b 1
