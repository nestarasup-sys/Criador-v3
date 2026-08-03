# Contratos de domínio — Fase 1

## Fonte única

Os contratos canônicos ficam em `app/domain`. Os arquivos antigos
`app/studio/types.ts` e `app/roteiros/types.ts` são barris temporários para
preservar a API pública enquanto os consumidores são migrados gradualmente.

| Módulo | Responsabilidade |
|---|---|
| `versions.*` | versões atuais dos documentos e contratos. |
| `ids.ts` | IDs nominalmente tipados e convenção `[a-zA-Z0-9_-]{1,120}`. |
| `base-model.*` | compatibilidade `padrao`/`pack-N`/`modelo-N`. |
| `character-values.*` | valores runtime de gênero, categoria e modo de rosto. |
| `character-primitives.ts` | gênero, categorias, transformações e máscaras. |
| `expression-contract.ts` | emoções, estados e chaves de expressão. |
| `character-contract.ts` | documento completo de personagem e visão narrativa. |
| `catalog-contract.ts` | catálogo browser/PC, geometria, grupos e packs. |
| `studio-contract.ts` | cena, itens, documento Studio e estado principal v2. |
| `roteiro-contract.ts` | fichas, scripts, TikToks, blocos, IA e estado v1. |
| `roteiro-defaults.*` | configuração inicial única de IA e geração de Roteiros. |
| `document-schemas.mjs` | validação e normalização executável no browser e Node. |
| `adapters.ts` | conversões explícitas entre documento persistido e visões da aplicação. |

## Versões

- estado principal: `version: 2`;
- Roteiros: `version: 1`;
- contrato de personagem: versão lógica 1;
- contrato de Studio: versão lógica 1.

As versões persistidas existentes não foram alteradas nesta fase.

## Compatibilidade

- campos desconhecidos são preservados pelos normalizadores;
- arrays ausentes ou inválidos recebem lista vazia para recuperação;
- configurações ausentes de Roteiros recebem os defaults atuais;
- `padrao` vira `modelo-1`;
- `pack-0` vira `modelo-1`, `pack-1` vira `modelo-2` e assim por diante;
- máscaras antigas em `hair` continuam representadas no contrato;
- metadados antigos de roupa permanecem opcionais durante a migração.

## Política de IDs

Documentos antigos continuam usando `string` para compatibilidade. Casos de uso
novos podem promover uma string validada para `EntityId<TKind>`, impedindo a
troca acidental de IDs de personagem, Studio, roteiro e bloco na tipagem.

## Política de schemas

`parseAppState` e `parseRoteirosState` devolvem:

```ts
{ success: boolean; data: DocumentoNormalizado; issues: string[] }
```

Isso permite recuperar documentos incompletos sem esconder problemas. A adoção
é progressiva: o serviço local e o storage de Roteiros já utilizam a mesma
normalização, mas nenhuma escrita incompatível foi introduzida.

## Round-trip

Fixtures cobrem:

- documento moderno principal v2 sem perda;
- documento legado com migração de modelo e preservação de extensões;
- documento moderno de Roteiros v1 sem perda;
- documento inválido com diagnóstico e recuperação segura.

## Segurança operacional da Etapa 2

- a interface usa `http://localhost:6700` e o serviço de dados usa
  `http://127.0.0.1:6800`;
- cada processo do serviço cria um token aleatório em memória, entregue uma
  única vez por `/session` e enviado pela UI em `X-Gacha-Session`;
- mutações e leituras de estado exigem o token; somente health, sessão e
  arquivos de mídia para `<img>`/`<video>` ficam públicos no loopback;
- limites, MIME e códigos de erro são centralizados em
  `services/security/local-security.mjs`.
