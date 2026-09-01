# Fabricador de Modelo

Ferramenta nativa para transformar uma folha de rostos em um modelo `head-only` compatível com o Criador e o Studio.

## Fluxo

1. Carregue a Folha 1, com 21 células em 7 colunas por 3 linhas.
2. Opcionalmente carregue a Folha 2. Ela adiciona sete expressões e seus estados `blink` e `talk` ao mesmo modelo.
3. Clique em **Gerar prévias**.
4. Revise a grade, selecione um rosto, compare o trio de estados e faça ajustes manuais quando necessário.
5. Clique em **Salvar modelo no catálogo**.

O painel de calibração permite ajustar a intensidade e os limites da Folha 1, os limites global/micro da Folha 2, tolerância, suavidade, feather, despill, limpeza de borda, padding, recorte justo, recorte quadrado e a âncora final. Os valores seguros já vêm preenchidos; alterar as opções exige gerar as prévias novamente.

O modelo é salvo em `public/models/modelos/{gênero}/{pasta}` pelo servidor local. A operação nunca sobrescreve uma pasta existente.

## Regras de processamento

- A saída é sempre um PNG transparente de 1920×1080.
- A posição é calculada pela âncora `neck-base`, inicialmente em `960,346`.
- O processamento usa chroma key conectado às bordas, feather, despill e limpeza de resíduos.
- A detecção adaptativa procura 3 linhas × 7 colunas e usa uma grade segura como fallback.
- A máscara visual preserva todos os detalhes exportados; a máscara estrutural é usada somente para calibração.
- A Folha 1 constrói um Head Master robusto com mediana, MAD, outliers, perfil estrutural e pescoço.
- A Folha 2 é comparada com esse Head Master, com correção global máxima de 8% e microajuste por rosto de 2%. Não há warp regional.
- Qualidade é calculada por escala, posição, proporção, silhueta, mandíbula, pescoço e estabilidade do trio.
- Estados críticos não revisados bloqueiam o salvamento; um crítico revisado pode ser salvo conscientemente e avisos apenas indicam revisão.

## Organização do código

- `core/`: detecção, chroma, recorte, anatomia, máscara, Head Master, calibração, qualidade e composição.
- `components/`: upload, configurações, grade, comparador, qualidade e ajuste manual.
- `constants/expressions.ts`: expressões das duas folhas, dimensões e valores padrão.
- `types/face-model.ts`: contrato interno da ferramenta.
- `utils/statistics.ts`: mediana, MAD, desvio padrão e pontuação robusta.

O HTML experimental V11.1 permanece apenas em `assets/` como referência de comportamento. Ele não é carregado pela aplicação.
