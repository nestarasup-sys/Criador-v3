@echo off
cd /d "%~dp0"
title NYMI GACHA 2.0
powershell -NoProfile -Command "$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 6800 -State Listen -ErrorAction SilentlyContinue; if ($listener) { $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess); if ($owner.Name -eq 'node.exe' -and $owner.CommandLine -match 'local-data-server\.mjs') { Stop-Process -Id $listener.OwningProcess -Force } }; Start-Process -FilePath 'node.exe' -ArgumentList 'local-data-server.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:6700/'"
npm run dev
if errorlevel 1 (
  echo.
  echo O Nymi Gacha encerrou com erro. Leia a mensagem acima.
  pause
)
