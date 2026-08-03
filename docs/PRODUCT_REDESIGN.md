# Redesenho de produto — NYMI GACHA

## 1. Proposta

NYMI GACHA será uma suíte local de criação narrativa visual, mantendo três
espaços independentes, mas coerentes:

1. **Personagens** — montar e exportar personagens completos.
2. **Studio** — compor imagens e cenas manualmente.
3. **Roteiros** — planejar histórias, TikToks e reações com IA local opcional.

O redesenho não conecta automaticamente Roteiros ao Studio e não reativa o Video
Maker. Essa separação respeita o comportamento aprovado do Premium.

## 2. Princípios

- **Local primeiro**: dados e IA ficam no PC; estado de conexão sempre visível.
- **Nada se perde**: autosave explícito, histórico, backups e restauração.
- **Preview é verdade**: o que aparece deve ser o que é exportado.
- **Complexidade progressiva**: tarefas comuns primeiro; controles avançados sob demanda.
- **Consistência sem uniformidade forçada**: cada área mantém sua finalidade, mas
  compartilha navegação, linguagem visual e padrões de feedback.
- **Acessível e responsivo**: teclado, foco visível, alvos de toque adequados e
  painéis utilizáveis em 1366×768 ou maior.

## 3. Arquitetura de informação

### Shell global

```text
NYMI GACHA
├── Personagens
├── Studio
├── Roteiros
├── Arquivos e backups
└── Configurações
```

O shell mostra:

- área atual;
- estado do salvamento;
- disponibilidade do serviço local;
- atalho para arquivos/backups;
- ajuda contextual;
- comando global de desfazer/refazer somente quando a área suportar.

### Personagens

Layout de três regiões preservado:

- esquerda: biblioteca, nome, gênero/modelo e ações do personagem;
- centro: canvas e ferramentas relacionadas à composição;
- direita: catálogo e propriedades do item selecionado.

Melhorias propostas:

- separar claramente **Escolher**, **Ajustar**, **Mascarar** e **Cor**;
- barra do canvas sempre ancorada ao próprio canvas;
- jobs de importação com progresso e cancelamento;
- variantes como um grupo visual único;
- mensagens de autosave e exportação não bloqueantes;
- “modo avançado” preservado para transformações precisas.

### Studio

- biblioteca de cenas antes do editor;
- toolbar esquerda para fundo, objetos, narrador, fala e pensamento;
- elenco em painel próprio;
- canvas central sem sobreposição dos inspetores;
- inspetor contextual com ações destrutivas separadas;
- print e visualização como ações de saída, não de edição.

### Roteiros

- home com abas Roteiros, Personagens e IA/Regras;
- editor em três colunas: navegação/contexto, TikTok ativo, estrutura/resumo;
- TikTok como unidade dobrável e identificável por cor discreta;
- blocos com avatar, tipo clicável, personagem, emoção, PT e EN;
- controles de IA agrupados e sempre opcionais;
- vídeo com preview, metadados, substituir e remover.

## 4. Sistema visual

### Personalidade

Delicado, criativo e moderno, sem infantilizar o fluxo profissional. A base pode
usar lilás, rosa suave, creme e grafite, com cores semânticas independentes.

### Tokens iniciais

```text
--nymi-bg:            #f8f5fb
--nymi-surface:       #ffffff
--nymi-surface-soft:  #fff5fa
--nymi-primary:       #7c4dff
--nymi-accent:        #ec5f9b
--nymi-text:          #2c2733
--nymi-muted:         #756d7e
--nymi-success:       #2f9d72
--nymi-warning:       #c98218
--nymi-danger:        #d84862
--nymi-radius-sm:     10px
--nymi-radius-md:     16px
--nymi-radius-lg:     24px
```

Ícones fofos podem existir como detalhes, mas controles críticos precisam de
rótulos. Cor nunca deve ser o único indicador de estado.

## 5. Estados e feedback

Todo caso de uso assíncrono deve possuir:

- ocioso;
- processando, com ação desabilitada;
- sucesso temporário;
- erro recuperável e contextual;
- opção de tentar novamente;
- cancelamento quando a operação puder demorar.

O autosave usa estados `Alterado`, `Salvando`, `Salvo no PC` e `Erro ao salvar`.
O app não deve sugerir que algo foi salvo quando apenas o espelho do navegador
foi atualizado.

## 6. Decisões de escopo

### Primeira versão com paridade

- três áreas atuais;
- dados existentes;
- importações e exportações existentes;
- IA local opcional;
- novo shell e componentes compartilhados;
- melhorias internas que não mudem resultado.

### Depois da paridade

- fila de jobs de imagem em Worker;
- gerenciamento visual de backups;
- configuração de destinos locais;
- diagnósticos exportáveis;
- atalhos de teclado editáveis;
- eventual empacotamento desktop.

### Fora do escopo atual

- nuvem e contas;
- colaboração multiusuário;
- Video Maker embutido;
- conexão automática Roteiro → Studio;
- geração de assets por ComfyUI;
- alteração do formato ZIP aceito pelo Video Maker.

## 7. Métricas de sucesso

- zero perda de dados em testes de encerramento e reinício;
- 100% das capacidades `P` na matriz de paridade;
- preview/export iguais em fixtures visuais;
- importação de folha grande não bloqueia interação por mais de 100 ms após uso de Worker;
- fluxo principal executável em 1366×768 sem controles inacessíveis;
- nenhuma escrita no repositório Premium original;
- zero vulnerabilidade alta conhecida em dependências de produção antes de release.
