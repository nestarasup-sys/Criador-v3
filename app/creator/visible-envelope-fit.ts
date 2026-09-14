import type { ItemTransform } from "../domain/character-primitives";

/** Limites do conteúdo visível no espaço nativo da imagem ou da cena. */
export type VisibleEnvelope = {
  top: number;
  bottom: number;
};

type EnvelopeItem = {
  width: number;
  height: number;
  defaultY?: number;
};

const MIN_ENVELOPE_SCALE = 0.35;
const MAX_ENVELOPE_SCALE = 2.4;

/**
 * Projeta somente as linhas superior e inferior de uma imagem no espaço da
 * cena. O renderer usa exatamente esta equação quando desenha um item.
 */
export function projectVisibleEnvelope(
  source: VisibleEnvelope,
  item: EnvelopeItem,
  transform: Pick<ItemTransform, "scale" | "scaleY" | "y">,
): VisibleEnvelope {
  const effectiveScaleY = transform.scale * transform.scaleY;
  const centerY = item.defaultY ?? item.height / 2;
  const project = (value: number) => centerY + transform.y + (value - item.height / 2) * effectiveScaleY;
  const projectedTop = project(source.top);
  const projectedBottom = project(source.bottom);
  return {
    top: Math.min(projectedTop, projectedBottom),
    bottom: Math.max(projectedTop, projectedBottom),
  };
}

/**
 * Ajusta a escala vertical e o deslocamento para que o envelope visível de
 * uma variante coincida com o envelope de uma roupa-mestre.
 *
 * A operação é deliberadamente limitada ao eixo Y. Escala horizontal,
 * centro cervical, rotação e correções locais continuam vindo do ajuste de
 * cabeça/pescoço. Assim o corpo não é redimensionado de forma cega para
 * corrigir um erro que pertence ao eixo X.
 */
export function fitVisibleEnvelope(
  source: VisibleEnvelope,
  target: VisibleEnvelope,
  item: EnvelopeItem,
  transform: ItemTransform,
): ItemTransform {
  // Com rotação, o topo e a base deixam de ser linhas horizontais no espaço
  // da cena. Não aplicar uma aproximação enganosa é mais seguro que deformar
  // a variante; o usuário ainda pode ajustar esse caso manualmente.
  if (Math.abs(transform.rotation) > 0.25) return transform;

  const sourceSpan = Math.max(1, Math.abs(source.bottom - source.top));
  const targetSpan = Math.max(1, Math.abs(target.bottom - target.top));
  const effectiveScaleY = Math.min(
    MAX_ENVELOPE_SCALE,
    Math.max(MIN_ENVELOPE_SCALE, targetSpan / sourceSpan),
  );
  const baseScale = Math.max(0.001, Math.abs(transform.scale));
  const centerY = item.defaultY ?? item.height / 2;
  const nextY = target.top - centerY - (source.top - item.height / 2) * effectiveScaleY;

  return {
    ...transform,
    scaleY: +(effectiveScaleY / baseScale).toFixed(5),
    y: +nextY.toFixed(2),
  };
}
