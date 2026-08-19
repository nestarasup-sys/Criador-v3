# Plano executável — Base de dados + IA externa + IA local de Roteiros

## 1. Visão do produto

A **Base de dados** será uma biblioteca local de vídeos preparados para reutilização. Cada vídeo terá ID estável, sequência visual, arquivo local, caminho absoluto, duração total calculada, descrição objetiva e o segundo em que a descrição termina.

O usuário selecionará personagens do Criador de Personagens e exportará uma base para uma IA externa. A IA externa não será responsável por escrever o roteiro final. Ela funcionará como planejadora: escolherá vídeos, definirá a ordem e indicará quais personagens devem reagir em cada um.

Depois, o Nymi Gacha importará esse plano e usará a IA local já integrada em **Roteiros** para escrever a abertura, falas e pensamentos com as regras e a qualidade atuais do app.

## 2. Divisão das responsabilidades

### Base de dados

Armazena e organiza vídeos, descrições, tempos e arquivos locais.

### IA externa

Responsável somente por analisar a biblioteca, escolher vídeos, reorganizar a ordem, selecionar personagens participantes, propor a função dramática de cada vídeo e devolver um plano JSON válido. Ela não deve escrever falas, pensamentos, abertura ou roteiro literário completo.

### Nymi Gacha / IA local de Roteiros

Responsável por criar a abertura, escrever falas e pensamentos, respeitar fichas, relações, cronologia e o fim da cena descritiva, manter continuidade e permitir a edição dentro do formato atual do app.

### Usuário

Responsável por revisar a seleção, revisar a ordem proposta, confirmar a criação e revisar o texto gerado pela IA local.

## 3. Fluxo final

```text
Cadastrar vídeos → preencher descrição e fim da cena → selecionar personagens
→ exportar base TXT → enviar TXT + guia para IA externa
→ receber plano JSON → importar no Nymi Gacha → validar e revisar prévia
→ criar roteiro novo → IA local escrever abertura, falas e pensamentos
→ revisar e exportar
```

## 4. Contratos de dados

### 4.1 Exportação da Base

O TXT usará o cabeçalho `NYMI_BASE_DATABASE_EXPORT_V2`.

Cada vídeo deverá conter:

```text
VIDEO 01
ID: video-...
SEQUÊNCIA: 01
CAMINHO ABSOLUTO: C:\...\base-de-dados\videos\01.mp4
NOME ORIGINAL: video-original.mp4
DESCRIÇÃO: descrição objetiva do que acontece
TEMPO QUE TERMINA A CENA DA DESCRIÇÃO: 8.00 segundos
TEMPO TOTAL DO VÍDEO: 20.00 segundos
```

Depois dos vídeos, o TXT conterá somente os personagens escolhidos:

```text
PERSONAGENS SELECIONADOS
ID: personagem-01
NOME: Alexander
FICHA NARRATIVA DO ROTEIROS (JSON): {...}
```

Não exportar como fonte de decisão da IA externa: ficha técnica do Criador, roupas, cabelo, fotos, ajustes de matiz ou caminhos de assets do Criador. A ficha narrativa do Roteiros é a fonte de personalidade, história, relações e estilo de fala.

### 4.2 Guia para a IA externa

O botão **Exportar guia** gerará um Markdown reutilizável, sem dados específicos de um roteiro. O guia deverá instruir:

1. A Base TXT é a única fonte de vídeos disponíveis.
2. Só podem ser usados IDs presentes no TXT.
3. Um vídeo não pode aparecer duas vezes.
4. A IA pode mudar livremente a ordem.
5. A IA deve escolher apenas personagens exportados.
6. A IA deve decidir quais personagens participam de cada vídeo.
7. O tempo final da descrição é uma restrição operacional.
8. A IA externa deve produzir planejamento, não diálogo.
9. A resposta deve conter somente JSON válido.
10. Caminhos absolutos não devem ser inventados nem usados como identificadores.

### 4.3 Plano JSON da IA externa

Formato versionado:

```json
{
  "format": "NYMI_ROTEIRO_PLAN_V1",
  "title": "Nome do novo roteiro",
  "concept": "Resumo opcional da linha dramática",
  "videos": [
    {
      "videoId": "video-01",
      "order": 1,
      "purpose": "Apresentar FYN de forma inesperada",
      "characterIds": ["personagem-01", "personagem-02"]
    }
  ]
}
```

Campos obrigatórios: `format`, `title` e `videos`. Cada vídeo deve ter `videoId`, `order` e `characterIds`. `purpose` e `concept` são opcionais.

O plano não deverá conter `speech`, `thought`, `silent`, texto de fala ou texto de pensamento. Esses campos pertencem à IA local do Roteiros.

## 5. Fases de implementação

### Fase 0 — Auditoria e contratos

- Auditar os contratos atuais da Base, Roteiros e personagens.
- Registrar os formatos V2 da Base e V1 do plano.
- Confirmar IDs estáveis dos vídeos.
- Confirmar que a exportação usa somente a ficha narrativa do Roteiros.
- Separar o guia externo do prompt interno da IA local.
- Criar checkpoint Git antes das alterações.

**Concluída quando:** formatos e responsabilidades não estiverem misturados.

### Fase 1 — Base de dados confiável

- Manter upload local dos vídeos.
- Calcular e persistir duração total.
- Persistir descrição e `sceneEndSeconds` automaticamente.
- Salvar ao sair do campo e após debounce.
- Recuperar rascunho local se a página fechar antes da requisição.
- Evitar sobrescrita por requisições antigas.
- Preservar dados ao recarregar a página.
- Impedir que vídeo excluído reapareça ao adicionar outro.
- Detectar arquivo removido manualmente.

**Concluída quando:** descrição e tempo permanecerem depois de reload, reinício do servidor e exportação.

### Fase 2 — Seleção de personagens

- Adicionar o seletor de personagens na Base.
- Carregar personagens do Criador.
- Mostrar nome, ID, modelo e miniatura.
- Adicionar pesquisa, seleção individual, seleção de visíveis e limpeza.
- Persistir a seleção localmente.
- Invalidar IDs de personagens apagados.
- Exportar somente os personagens selecionados.

**Concluída quando:** a IA externa receber exatamente os personagens escolhidos, sem dados extras do Criador.

### Fase 3 — Exportação da Base

- Exportar todos os vídeos cadastrados.
- Exportar a descrição mais recente, inclusive alterações ainda em debounce.
- Exportar duração calculada e fim da cena.
- Exportar caminhos absolutos e IDs estáveis.
- Exportar fichas narrativas e relacionamentos.
- Preservar acentos, quebras de linha e campos vazios.
- Nunca exportar blocos antigos de outros roteiros.
- Gerar mensagens de erro para dados inválidos.

**Concluída quando:** o TXT for suficiente para escolher vídeos e entender os personagens.

### Fase 4 — Guia da IA externa

- Reescrever o guia com foco em planejamento.
- Proibir geração de falas e pensamentos.
- Explicar ordem livre e proibição de duplicidade.
- Explicar seleção por IDs.
- Explicar que duração e fim da descrição serão resolvidos pelo app.
- Fornecer JSON válido completo e exemplos inválidos.
- Instruir retorno somente em JSON compatível com `NYMI_ROTEIRO_PLAN_V1`.

**Concluída quando:** uma IA externa conseguir devolver um plano pequeno e importável sem escrever o roteiro final.

### Fase 5 — Importação do plano

- Renomear o fluxo para **Importar plano da IA** ou **Importar roteiro planejado**.
- Aceitar somente formatos e versões suportados.
- Validar JSON antes de alterar o estado.
- Validar título, IDs, ordem e lista de vídeos.
- Rejeitar vídeo duplicado, ordem duplicada ou personagem inexistente.
- Ignorar caminhos enviados pela IA.
- Resolver os arquivos usando a Base local.

**Concluída quando:** nenhum plano inválido criar roteiro parcial.

### Fase 6 — Prévia e revisão

- Mostrar título e conceito.
- Mostrar ordem dos vídeos.
- Mostrar descrição, duração e fim da cena.
- Mostrar personagens por vídeo.
- Avisar vídeos ausentes ou arquivos indisponíveis.
- Permitir cancelar.
- Permitir alterar ordem antes da confirmação.
- Permitir remover vídeos e trocar personagens participantes.
- Não editar falas nesta etapa, pois elas ainda não existem.

**Concluída quando:** o usuário revisar a estrutura antes de criar o roteiro.

### Fase 7 — Criação e IA local

- Criar roteiro novo com ID novo.
- Criar TikToks na ordem confirmada.
- Copiar descrição, duração e `sceneEndSeconds` da Base.
- Copiar vídeos para a pasta local do roteiro.
- Resolver personagens por ID.
- Criar participantes ativos.
- Usar `concept` como contexto geral opcional.
- Manter a IA local responsável pela escrita.
- Gerar abertura separadamente.
- Gerar falas e pensamentos usando o prompt atual de Roteiros.
- Impedir reações antes do fim da descrição.
- Permitir regenerar somente bloco ou seção.

**Concluída quando:** o roteiro importado funcionar como um roteiro criado manualmente, já com vídeos e personagens preparados.

### Fase 8 — Segurança e rollback

- Criar backup antes de confirmar a importação.
- Copiar vídeos de forma rastreável.
- Remover cópias se a criação falhar.
- Não alterar a Base original.
- Não alterar roteiros existentes.
- Preservar TXT e JSON originais.
- Mostrar erro acionável em falhas parciais.
- Impedir acesso a caminhos arbitrários por IDs desconhecidos.

**Concluída quando:** falhas não deixarem roteiro parcialmente criado nem arquivos órfãos.

### Fase 9 — Testes e entrega

Testar:

- base vazia, um vídeo e vários vídeos;
- descrição com acentos e várias linhas;
- tempo zero, decimal e maior que a duração;
- upload, reload e reinício do servidor;
- vídeo excluído e novo upload;
- arquivo removido manualmente;
- nenhum, um e vários personagens;
- personagem removido após a seleção;
- IA externa escolhendo ordem diferente;
- vídeo repetido, personagem inexistente e caminho inventado;
- plano vazio ou JSON inválido;
- prévia cancelada e confirmação;
- falha ao copiar vídeo;
- preservação de roteiros existentes e da Base original;
- IA local recebendo somente o contexto do roteiro importado;
- falas começando somente após `sceneEndSeconds`.

Comandos finais:

```text
npm run test:unit
npm run typecheck
npm run build
npm run lint
git diff --check
```

## 6. Critério de conclusão do produto

O fluxo estará completo quando o usuário conseguir:

1. Cadastrar muitos vídeos uma única vez.
2. Descrever cada vídeo e informar quando a descrição termina.
3. Selecionar os personagens desejados.
4. Exportar a Base e o guia.
5. Enviar esses arquivos para uma IA externa.
6. Receber um plano JSON pequeno e estruturado.
7. Importar o plano no Nymi Gacha.
8. Revisar vídeos, ordem e personagens antes de confirmar.
9. Criar um roteiro novo automaticamente.
10. Usar a IA local do Roteiros para escrever a parte criativa.
11. Revisar e ajustar o roteiro normalmente.
12. Reutilizar os mesmos vídeos em outros roteiros sem duplicar ou perder a Base.

## 7. Decisão arquitetural principal

Não fazer a IA externa competir com a IA local na escrita das reações. A IA externa organiza a matéria-prima, o app valida e monta a estrutura, a IA local escreve o conteúdo narrativo e o usuário revisa antes e depois da geração.

Essa divisão reduz respostas genéricas, diminui o tamanho do prompt externo e aproveita a especialização que já funciona dentro do Nymi Gacha.
