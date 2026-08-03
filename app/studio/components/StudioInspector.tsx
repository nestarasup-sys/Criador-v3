import styles from "../studio.module.css";
import { EXPRESSION_STATES, type Character, type Emotion, type SceneBubble, type SceneCharacter, type SceneNarrator, type SceneObject, type Selection, type Studio } from "../types";

type InspectorProps<T> = { item: T; onUpdate: (patch: Partial<T>) => void; onLayer: (direction: -1 | 1) => void; onRemove: () => void; onDuplicate?: () => void };

function LayerButtons({ onLayer }: { onLayer: (direction: -1 | 1) => void }) {
  return <div className={styles.inlineButtons}><button onClick={() => onLayer(-1)}>Para trás</button><button onClick={() => onLayer(1)}>Para frente</button></div>;
}

function ScaleControl({ value, onChange, min = .25, max = 2.5 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <label className={styles.rangeField}><span>Scale <b>{Math.round(value * 100)}%</b></span><input type="range" min={min} max={max} step=".05" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function CharacterInspector({ item, source, emotions, onUpdate, onLayer, onRemove }: InspectorProps<SceneCharacter> & { source: Character; emotions: ReadonlyArray<readonly [Emotion, string]> }) {
  return <><div className={styles.inspectorTitle}><div><span>PERSONAGEM</span><h3>{source.name}</h3></div><button onClick={onRemove}>×</button></div><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} /><div className={styles.inspectorSection}><div className={styles.expressionHeading}><span>Expressão</span><div className={`${styles.stateSwitch} ${styles.expressionStates}`}>{EXPRESSION_STATES.map(([value, label]) => <button key={value} className={item.expressionState === value ? styles.activeOption : ""} onClick={() => onUpdate({ expressionState: value })}>{label}</button>)}</div></div><div className={styles.expressionGrid}>{emotions.map(([value, label]) => <button key={value} className={item.expressionEmotion === value ? styles.activeOption : ""} onClick={() => onUpdate({ expressionEmotion: value })}>{label}</button>)}</div></div><button className={styles.wideButton} onClick={() => onUpdate({ flipX: !item.flipX })}>↔ Espelhar personagem</button><LayerButtons onLayer={onLayer} /><button className={styles.dangerButton} onClick={onRemove}>Remover da cena</button></>;
}

function ObjectInspector({ item, onUpdate, onLayer, onRemove, onDuplicate }: InspectorProps<SceneObject>) {
  return <><div className={styles.inspectorTitle}><div><span>OBJETO</span><h3>{item.name}</h3></div><button onClick={onRemove}>×</button></div><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.1} max={4} /><button className={styles.wideButton} onClick={() => onUpdate({ flipX: !item.flipX })}>↔ Espelhar objeto</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar objeto</button><button className={styles.dangerButton} onClick={onRemove}>Remover objeto</button></>;
}

function BubbleInspector({ item, onUpdate, onCopy, onPaste, onGenerateEnglish, isTranslating, onLayer, onRemove, onDuplicate }: InspectorProps<SceneBubble> & { onCopy: () => void; onPaste: () => void; onGenerateEnglish: () => void; isTranslating: boolean }) {
  return <><div className={styles.inspectorTitle}><div><span>CHAT</span><h3>{item.bubbleType === "fala" ? "Balão de fala" : "Pensamento"}</h3></div><button onClick={onRemove}>×</button></div><label className={styles.textField}><span className={styles.textFieldHeading}><span>Texto</span><span className={styles.textFieldActions}><button type="button" disabled={!item.text.trim()} onClick={onCopy}>Copiar</button><button type="button" onClick={onPaste}>Colar</button><button type="button" className={styles.aiTextButton} disabled={!item.text.trim() || item.language === "en" || isTranslating} onClick={onGenerateEnglish}>{isTranslating ? "Gerando…" : "Gerar Inglês"}</button></span></span><textarea value={item.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.5} max={2.5} /><label className={styles.rangeField}><span>Largura <b>{item.width}px</b></span><input type="range" min="180" max="560" value={item.width} onChange={(event) => onUpdate({ width: Number(event.target.value) })} /></label><label className={styles.rangeField}><span>Texto <b>{item.fontSize}px</b></span><input type="range" min="14" max="48" value={item.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label><button className={styles.wideButton} onClick={() => onUpdate({ tailSide: item.tailSide === "left" ? "right" : "left" })}>↔ Mudar direção da ponta</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar balão</button><button className={styles.dangerButton} onClick={onRemove}>Excluir balão</button></>;
}

function NarratorInspector({ item, onUpdate, onLayer, onRemove, onDuplicate }: InspectorProps<SceneNarrator>) {
  return <><div className={styles.inspectorTitle}><div><span>NARRADOR</span><h3>Caixa de texto</h3></div><button onClick={onRemove}>×</button></div><label className={styles.textField}>Texto<textarea value={item.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.5} max={2.5} /><label className={styles.rangeField}><span>Largura <b>{item.width}px</b></span><input type="range" min="220" max="800" value={item.width} onChange={(event) => onUpdate({ width: Number(event.target.value) })} /></label><label className={styles.rangeField}><span>Fonte <b>{item.fontSize}px</b></span><input type="range" min="14" max="54" value={item.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label><div className={styles.stateSwitch}>{(["left", "center", "right"] as const).map((align) => <button key={align} className={item.align === align ? styles.activeOption : ""} onClick={() => onUpdate({ align })}>{align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}</button>)}</div><button className={styles.wideButton} onClick={() => onUpdate({ boxed: !item.boxed })}>{item.boxed ? "Usar somente texto" : "Adicionar caixa de fundo"}</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar narração</button><button className={styles.dangerButton} onClick={onRemove}>Excluir narração</button></>;
}

type StudioInspectorProps = {
  studio: Studio;
  selection: Selection;
  selectedCharacter: SceneCharacter | null;
  selectedCharacterSource: Character | null;
  selectedObject: SceneObject | null;
  selectedBubble: SceneBubble | null;
  selectedNarrator: SceneNarrator | null;
  emotions: ReadonlyArray<readonly [Emotion, string]>;
  translatingBubbleId: string | null;
  onToggleBackgroundFit: () => void;
  backgroundCollapsed: boolean;
  onToggleBackgroundCollapsed: () => void;
  onRemoveBackground: () => void;
  onUpdate: (kind: NonNullable<Selection>["kind"], id: string, patch: Record<string, unknown>) => void;
  onCopyBubble: () => void;
  onPasteBubble: (onUpdate: (patch: Partial<SceneBubble>) => void) => void;
  onGenerateEnglish: () => void;
  onLayer: (direction: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
};

export function StudioInspector({ studio, selection, selectedCharacter, selectedCharacterSource, selectedObject, selectedBubble, selectedNarrator, emotions, translatingBubbleId, onToggleBackgroundFit, backgroundCollapsed, onToggleBackgroundCollapsed, onRemoveBackground, onUpdate, onCopyBubble, onPasteBubble, onGenerateEnglish, onLayer, onRemove, onDuplicate }: StudioInspectorProps) {
  const update = <T extends object>(kind: NonNullable<Selection>["kind"], id: string, patch: Partial<T>) => onUpdate(kind, id, patch as Record<string, unknown>);
  return <section className={styles.inspector}>
    {studio.background && !selection && <>{backgroundCollapsed ? <div className={styles.backgroundCollapsed}><strong>Fundo</strong><button onClick={onToggleBackgroundCollapsed}>Mostrar controles</button></div> : <><div className={styles.backgroundPanelHeading}><h3>Fundo</h3><button aria-label="Recolher painel Fundo" title="Recolher painel Fundo" onClick={onToggleBackgroundCollapsed}>▴</button></div><button onClick={onToggleBackgroundFit}>{studio.background.fit === "cover" ? "Mostrar inteiro" : "Preencher tela"}</button><button className={styles.dangerButton} onClick={onRemoveBackground}>Remover fundo</button></>}</>}
    {selectedCharacter && selectedCharacterSource && <CharacterInspector item={selectedCharacter} source={selectedCharacterSource} emotions={emotions} onUpdate={(patch) => update("character", selectedCharacter.id, patch)} onLayer={onLayer} onRemove={onRemove} />}
    {selectedObject && <ObjectInspector item={selectedObject} onUpdate={(patch) => update("object", selectedObject.id, patch)} onLayer={onLayer} onRemove={onRemove} onDuplicate={onDuplicate} />}
    {selectedBubble && <BubbleInspector item={selectedBubble} onUpdate={(patch) => update("bubble", selectedBubble.id, patch)} onCopy={onCopyBubble} onPaste={() => onPasteBubble((patch) => update("bubble", selectedBubble.id, patch))} onGenerateEnglish={onGenerateEnglish} isTranslating={translatingBubbleId === selectedBubble.id} onLayer={onLayer} onRemove={onRemove} onDuplicate={onDuplicate} />}
    {selectedNarrator && <NarratorInspector item={selectedNarrator} onUpdate={(patch) => update("narrator", selectedNarrator.id, patch)} onLayer={onLayer} onRemove={onRemove} onDuplicate={onDuplicate} />}
    {!selection && !studio.background && <div className={styles.inspectorEmpty}><span>✦</span><strong>Selecione algo</strong><p>Clique em um personagem ou adicione um elemento à cena.</p></div>}
  </section>;
}
