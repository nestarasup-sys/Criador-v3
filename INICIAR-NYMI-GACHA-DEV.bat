@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0" || goto :root_error
title NYMI GACHA - DESENVOLVIMENTO

echo ================================================================
echo   NYMI GACHA - DESENVOLVIMENTO AO VIVO
echo ================================================================
echo.
echo A interface sera reconstruida quando voce salvar arquivos.
echo O servidor de dados reinicia sozinho quando o backend mudar.
echo UI: http://localhost:6700   DADOS: http://localhost:6800
echo.

if not exist "package.json" goto :project_error
if not exist "scripts\live-runner.mjs" goto :project_error
if not exist "node_modules\vinext\dist\cli.js" goto :dependencies_error
where node >nul 2>&1 || goto :node_error

for /f "delims=" %%V in ('node --version 2^>nul') do set "NODE_VERSION=%%V"
if not defined NODE_VERSION goto :node_error
echo Node detectado: !NODE_VERSION!

rem Libera somente servidores Node do proprio Nymi Gacha que tenham deixado as portas presas.
rem O teste de /health confirma a pasta de dados quando o processo foi iniciado com caminho relativo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path '.').Path.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar); $dataRoot=[IO.Path]::GetFullPath((Join-Path $root 'dados-locais-premium')).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar); $ports=@(6700,6800); foreach($port in $ports){ $listeners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); foreach($listener in $listeners){ $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess); $scriptMatch=($owner.Name -eq 'node.exe' -and $owner.CommandLine -match '(production-server|local-data-server)\.mjs'); $sameProject=($owner.CommandLine -match [regex]::Escape($root)); $healthMatch=$false; if($port -eq 6800){ try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:6800/health' -TimeoutSec 2; $healthRoot=[IO.Path]::GetFullPath([string]$health.folder).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar); $healthMatch=($health.ok -eq $true -and $healthRoot -ieq $dataRoot) } catch {} }; if($scriptMatch -and ($sameProject -or $healthMatch)){ Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue } } }; Start-Sleep -Milliseconds 350"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$busy=@(6700,6800 | ForEach-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue }); if($busy.Count -gt 0){ foreach($item in $busy){ $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$item.OwningProcess); Write-Host ('Porta '+$item.LocalPort+' ocupada por PID '+$item.OwningProcess+' ('+$owner.Name+').') -ForegroundColor Yellow }; exit 3 }"
if errorlevel 1 goto :port_error

echo.
echo Iniciando os servidores. Feche esta janela ou pressione Ctrl+C para encerrar.
echo.
node "scripts\live-runner.mjs"
set "SERVER_EXIT=!errorlevel!"

echo.
if "!SERVER_EXIT!"=="0" (
  echo Desenvolvimento encerrado normalmente.
  pause
  exit /b 0
)
echo O Nymi Gacha encerrou com erro ^(codigo !SERVER_EXIT!^).
echo Leia a mensagem acima e corrija o problema antes de tentar novamente.
pause
exit /b !SERVER_EXIT!

:root_error
echo Nao foi possivel acessar a pasta do projeto: %~dp0
pause
exit /b 1

:project_error
echo Esta pasta nao parece ser a raiz do projeto Nymi Gacha.
echo Verifique se o arquivo package.json e scripts\live-runner.mjs existem.
pause
exit /b 1

:dependencies_error
echo Dependencias incompletas: node_modules\vinext\dist\cli.js nao existe.
echo Execute npm install na raiz do projeto e tente novamente.
pause
exit /b 1

:node_error
echo Node.js nao foi encontrado ou nao respondeu corretamente.
echo Instale o Node.js 22 ou superior e abra este BAT novamente.
pause
exit /b 1

:port_error
echo Uma porta necessaria esta ocupada por outro processo.
echo Feche o processo indicado acima ou altere as portas do ambiente.
pause
exit /b 3
