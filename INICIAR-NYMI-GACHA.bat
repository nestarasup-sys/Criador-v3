@echo off
setlocal
cd /d "%~dp0"
title NYMI GACHA 2.0
set "GACHA_PRINTS_ROOT=C:\PRINTS GACHA NYMI"
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
powershell -NoProfile -Command "$listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 6700,6800 -State Listen -ErrorAction SilentlyContinue); foreach ($listener in $listeners) { $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess); if ($owner.Name -eq 'node.exe' -and (($listener.LocalPort -eq 6800 -and $owner.CommandLine -match 'local-data-server\.mjs') -or ($listener.LocalPort -eq 6700 -and $owner.CommandLine -match 'production-server\.mjs'))) { Stop-Process -Id $listener.OwningProcess -Force } }; Start-Process -FilePath 'node.exe' -ArgumentList 'local-data-server.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:6700/'"
npm run start
if errorlevel 1 (
  echo.
  echo O Nymi Gacha encerrou com erro. Leia a mensagem acima.
  pause
)
