# Benchmark do Alinhador Profissa

Este diretório contém somente fixtures e ferramentas de diagnóstico. Ele não é
necessário para usar o Alinhador Profissa no app e não altera os PNGs originais.

## Rodar

```powershell
npm run benchmark:alinhador
```

O resultado é escrito em `tests/alinhador-profissa/reports/`. O benchmark abre a
página legada real em um servidor local, carrega cada par, detecta as cabeças,
constrói o molde atual e coleta as métricas expostas pelo modo de diagnóstico.

O baseline deve ser atualizado conscientemente, nunca automaticamente:

```powershell
npm run benchmark:alinhador -- --write-baseline
```

As fixtures são cópias dos arquivos fornecidos para teste. A ferramenta final
continua funcionando sem Python, OpenCV ou qualquer dependência de benchmark.
