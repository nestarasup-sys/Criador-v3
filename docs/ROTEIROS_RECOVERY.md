# Persistência e recuperação dos Roteiros

## Fonte canônica

O arquivo `dados-locais-premium/roteiros/estado.json` é a fonte canônica do
módulo Roteiros. O navegador não é mais um segundo banco: ele mantém somente
um journal curto e versionado para recuperar uma alteração que ainda não
chegou ao serviço local.

O serviço grava o estado com `writeJsonAtomic`: o JSON é escrito em um arquivo
temporário na mesma pasta e substituído por rename. Assim, uma interrupção no
meio da gravação não deixa um `estado.json` parcialmente escrito.

## Journal do navegador

- Chave: `gacha-premium-roteiros-recovery-v1`.
- Versão atual: `1`.
- Limite: 24 entradas.
- Entradas `pending` representam alterações ainda não confirmadas no PC.
- Entradas `pc-saved` registram o último snapshot confirmado e impedem avisos
  repetidos.

Quando o serviço volta a responder, uma entrada pendente mais nova e diferente
do PC aparece como **Recuperação local encontrada**. **Usar recuperação** coloca
o snapshot no estado React e deixa o autosave enviá-lo ao PC; **Descartar** remove
as entradas pendentes sem tocar no estado canônico.

O journal pode desaparecer quando a quota do navegador é excedida; isso nunca
impede o salvamento no PC. A cópia antiga
`gacha-premium-roteiros-emergency-v1` continua sendo lida somente como fallback
de compatibilidade quando o serviço está indisponível. Ela não recebe novas
gravações.

## Backups no PC

Backups ficam em:

```text
dados-locais-premium/roteiros/backups/
```

O serviço cria um backup automático antes da primeira gravação após cinco
minutos sem backup e mantém no máximo 20 arquivos. A aba **IA e regras** lista
os backups e oferece **Criar backup agora** e **Restaurar**. Antes de restaurar,
o estado atual é salvo como `roteiros-antes-restauracao-*.json`.

Rotas internas:

- `GET /roteiros/backups` lista nome, data e tamanho;
- `POST /roteiros/backups/create` cria um backup manual;
- `POST /roteiros/backups/restore` recebe `{ "fileName": "...json" }`.

Os nomes são validados e o caminho final precisa permanecer dentro da pasta de
backups. Um backup com JSON inválido é rejeitado sem substituir o estado atual.

## Corrupção e encerramento abrupto

Na inicialização, se `estado.json` não puder ser lido ou parseado, o serviço
procura o backup válido mais recente. O arquivo suspeito é movido para
`estado.corrompido-<timestamp>.json` e o backup recuperado é escrito
atomicamente. Se nenhum backup válido existir, é criado um estado vazio, sem
apagar o arquivo suspeito.

Falhas de disco, quota ou rename propagam erro para a interface; o arquivo
anterior permanece preservado. Os testes simulam falha de escrita e verificam
que arquivos temporários não ficam órfãos. O teste de concorrência confirma que
gravações simultâneas são serializadas.

## Migração histórica

1. Inicie o servidor local e abra Roteiros: o `estado.json` será criado.
2. Para dados do antigo IndexedDB (`gacha-maker`, versão 2) ou
   `localStorage`, use as ferramentas de migração existentes do Criador. O
   módulo Roteiros não importa automaticamente roteiros antigos do RAMIFICADO
   V2, de acordo com a decisão de isolamento.
3. Se ainda houver a chave
   `gacha-premium-roteiros-emergency-v1`, ela será usada apenas quando o PC
   estiver indisponível; assim que o serviço voltar, salve explicitamente o
   estado para torná-lo canônico.
4. Faça um backup manual antes de qualquer limpeza do navegador.

Não há migração automática de bancos ou roteiros externos porque isso poderia
misturar IDs e substituir dados sem confirmação. A importação JSON do módulo
continua sendo o caminho explícito para documentos compatíveis.
