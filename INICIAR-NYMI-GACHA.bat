@echo off
setlocal
cd /d "%~dp0"
title NYMI GACHA 2.0
set "GACHA_PRINTS_ROOT=C:\PRINTS GACHA NYMI"
rem O supervisor inicia local-data-server.mjs e substitui o antigo npm run start.
rem Contratos: LocalPort 6800, localhost:6700 e WindowStyle Hidden para processos auxiliares.
if not exist "%~dp0dist\server\index.js" (
  echo Build de producao nao encontrado. Preparando o Nymi Gacha...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Falha ao preparar o build do Nymi Gacha.
    pause
    exit /b 1
  )
)
powershell -NoProfile -Command "$listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 6700,6800 -State Listen -ErrorAction SilentlyContinue); foreach ($listener in $listeners) { $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess); if ($owner.Name -eq 'node.exe' -and (($listener.LocalPort -eq 6800 -and $owner.CommandLine -match 'local-data-server\.mjs') -or ($listener.LocalPort -eq 6700 -and $owner.CommandLine -match 'production-server\.mjs'))) { Stop-Process -Id $listener.OwningProcess -Force } }"
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
