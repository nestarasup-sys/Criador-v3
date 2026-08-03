# GACHA MAKER

Editor local de personagens com modelos feminino e masculino, catálogo de roupas e cabelos, ajuste visual, máscara de corpo e exportação em PNG/ZIP.

## Como abrir

Execute `INICIAR-GACHA-MAKER.bat`. O arquivo inicia:

- o aplicativo em `http://localhost:9099`;
- o serviço de dados locais em `http://127.0.0.1:4318`.

Os dados compartilhados entre navegadores ficam em `dados-locais-premium/`. Essa pasta contém os personagens, metadados, imagens importadas, packs e backups automáticos.

## Primeira migração

Abra uma vez o navegador que contém os personagens antigos. No painel esquerdo, clique em **Migrar dados deste navegador**. Depois da migração, Chrome, Edge ou outro navegador carregará os mesmos dados do PC.

## Comandos úteis

- `npm run dev`: inicia apenas a interface web.
- `npm run data-server`: inicia apenas o armazenamento do PC.
- `npm run build`: valida a aplicação.
- `npm run typecheck`: valida TypeScript sem gerar arquivos.
- `npm run lint`: executa o lint (avisos de `<img>` são conhecidos e não bloqueiam o build).
- `npm run test:unit`: executa os testes sem repetir o build.
- `npm test`: executa o build e os testes completos.
