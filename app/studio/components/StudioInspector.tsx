import { useState } from "react";
import styles from "../studio.module.css";
import { groupStudioPtExpressions } from "../expression-groups.mjs";
import { StudioGlyph } from "./StudioGlyph";
import { EXPRESSION_STATES, type Character, type Emotion, type SceneBubble, type SceneCharacter, type SceneNarrator, type SceneObject, type Selection, type Studio } from "../types";

type InspectorProps<T> = { item: T; onUpdate: (patch: Partial<T>) => void; onLayer: (direction: -1 | 1) => void; onRemove: () => void; onDuplicate?: () => void };

function LayerButtons({ onLayer }: { onLayer: (direction: -1 | 1) => void }) {
  return <div className={styles.inlineButtons}><button onClick={() => onLayer(-1)}>Para trás</button><button onClick={() => onLayer(1)}>Para frente</button></div>;
}

function ScaleControl({ value, onChange, min = .25, max = 2.5 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <label className={styles.rangeField}><span>Scale <b>{Math.round(value * 100)}%</b></span><input type="range" min={min} max={max} step=".05" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function CharacterInspector({ item, emotions, expanded, dockSide, onToggleWidth, onUpdate, onLayer, onRemove, onClose, onPrint, isPrinting, onPose, poseLabel, poseDisabled, onAddBubblePair, characterHasBubbles, onGoToCharacterBubble, onClearCharacterBubbles, onNudgeOutfit, outfitAdjustDisabled }: InspectorProps<SceneCharacter> & { emotions: ReadonlyArray<readonly [Emotion, string]>; expanded: boolean; dockSide: "left" | "right"; onToggleWidth: () => void; onClose: () => void; onPrint: () => void; isPrinting: boolean; onPose: () => void; poseLabel: string; poseDisabled: boolean; onAddBubblePair: (type: SceneBubble["bubbleType"]) => void; characterHasBubbles: boolean; onGoToCharacterBubble: () => void; onClearCharacterBubbles: () => void; onNudgeOutfit: (dx: number, dy: number) => void; outfitAdjustDisabled: boolean }) {
  const [editorMode, setEditorMode] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const expressionGroups = groupStudioPtExpressions(emotions);
  const widthArrow = expanded ? dockSide : dockSide === "left" ? "right" : "left";
  return <>
    <div className={styles.characterInspectorHeader}><button type="button" className={styles.characterInspectorRemove} aria-label="Remover personagem da cena" title="Remover personagem da cena" onClick={onRemove}><StudioGlyph name="close" /></button><div className={styles.characterInspectorHeaderActions}><button type="button" className={`${styles.editorModeButton} ${editorMode ? styles.editorModeButtonActive : ""}`} aria-pressed={editorMode} onClick={() => setEditorMode((active) => !active)}>Editor</button>{editorMode && <button type="button" className={styles.inspectorWidthToggle} aria-label={expanded ? "Diminuir inspetor" : "Aumentar inspetor"} title={expanded ? "Diminuir inspetor" : "Aumentar inspetor"} onClick={onToggleWidth}><StudioGlyph name={widthArrow} /></button>}<button type="button" className={styles.characterInspectorClose} aria-label="Fechar inspetor" title="Fechar inspetor" onClick={onClose}><StudioGlyph name="right" /></button></div></div>
    {editorMode && <ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} />}
    <div className={styles.inspectorActionRow}><button type="button" className={styles.inspectorPrintButton} onClick={onPrint} disabled={isPrinting}><StudioGlyph name="print" /> {isPrinting ? "Salvando…" : "Print"}</button><button type="button" className={styles.inspectorPoseButton} onClick={onPose} disabled={poseDisabled} title={poseDisabled ? "Esta roupa não possui variantes" : "Trocar variante da roupa"}><StudioGlyph name="outfit" /> {poseLabel}</button></div>
    <div className={styles.characterBubbleActions}><button type="button" onClick={() => onAddBubblePair("fala")}><StudioGlyph name="speech" /> Fala</button><button type="button" onClick={() => onAddBubblePair("pensamento")}><StudioGlyph name="thought" /> Pensamento</button></div>
    <div className={styles.characterBubbleManageActions}><button type="button" className={styles.characterBubbleGoButton} disabled={!characterHasBubbles} onClick={onGoToCharacterBubble}>Ir para...</button><button type="button" className={styles.characterBubbleClearButton} disabled={!characterHasBubbles} onClick={onClearCharacterBubbles}>Limpar</button></div>
    <div className={styles.inspectorSection}><div className={styles.expressionHeading}><div className={`${styles.stateSwitch} ${styles.expressionStates}`}>{EXPRESSION_STATES.map(([value, label]) => <button key={value} className={item.expressionState === value ? styles.activeOption : ""} onClick={() => onUpdate({ expressionState: value })}>{label}</button>)}</div></div><div className={styles.expressionGrid}>{expressionGroups.map(({ baseKey, baseLabel, ptKey }) => ptKey ? <div className={styles.expressionPair} role="group" aria-label={`${baseLabel}, direção da pupila`} key={baseKey}><button className={`${styles.expressionBaseOption} ${item.expressionEmotion === baseKey ? styles.activeOption : ""}`} onClick={() => onUpdate({ expressionEmotion: baseKey })}>{baseLabel}</button><button className={`${styles.expressionPtOption} ${item.expressionEmotion === ptKey ? styles.activePtOption : ""}`} aria-label={`${baseLabel} para trás`} title={`${baseLabel} para trás`} onClick={() => onUpdate({ expressionEmotion: ptKey })}>PT</button></div> : <button key={baseKey} className={item.expressionEmotion === baseKey ? styles.activeOption : ""} onClick={() => onUpdate({ expressionEmotion: baseKey })}>{baseLabel}</button>)}</div></div>
    {editorMode && <><button type="button" className={styles.outfitAdjustToggle} onClick={() => setAdjustOpen((open) => !open)} aria-expanded={adjustOpen}>Ajustar <StudioGlyph name={adjustOpen ? "up" : "down"} /></button>{adjustOpen && <div className={styles.outfitNudge}><span>Ajustar</span><div className={styles.outfitNudgeGrid}><button type="button" aria-label="Mover roupa para cima" onClick={() => onNudgeOutfit(0, -8)} disabled={outfitAdjustDisabled}><StudioGlyph name="up" /></button><button type="button" aria-label="Mover roupa para a esquerda" onClick={() => onNudgeOutfit(-8, 0)} disabled={outfitAdjustDisabled}><StudioGlyph name="left" /></button><button type="button" aria-label="Mover roupa para a direita" onClick={() => onNudgeOutfit(8, 0)} disabled={outfitAdjustDisabled}><StudioGlyph name="right" /></button><button type="button" aria-label="Mover roupa para baixo" onClick={() => onNudgeOutfit(0, 8)} disabled={outfitAdjustDisabled}><StudioGlyph name="down" /></button></div></div>}<button className={styles.wideButton} onClick={() => onUpdate({ flipX: !item.flipX })}><StudioGlyph name="flip" /> Espelhar personagem</button><LayerButtons onLayer={onLayer} /><button className={styles.dangerButton} onClick={onRemove}>Remover da cena</button></>}
  </>;
}

function ObjectInspector({ item, onUpdate, onLayer, onRemove, onDuplicate }: InspectorProps<SceneObject>) {
  return <><div className={styles.inspectorTitle}><div><span>OBJETO</span><h3>{item.name}</h3></div><button onClick={onRemove}><StudioGlyph name="close" /></button></div><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.1} max={4} /><button className={styles.wideButton} onClick={() => onUpdate({ flipX: !item.flipX })}><StudioGlyph name="flip" /> Espelhar objeto</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar objeto</button><button className={styles.dangerButton} onClick={onRemove}>Remover objeto</button></>;
}

function BubbleInspector({ item, characterName, onBackToCharacter, onUpdate, onCopy, onPaste, onGenerateEnglish, isTranslating, onLayer, onRemove, onDuplicate }: InspectorProps<SceneBubble> & { characterName: string | null; onBackToCharacter: () => void; onCopy: () => void; onPaste: () => void; onGenerateEnglish: () => void; isTranslating: boolean }) {
  const fallbackTitle = item.bubbleType === "fala" ? "Balão de fala" : "Pensamento";
  return <>
    <div className={`${styles.inspectorTitle} ${styles.bubbleInspectorTitle}`}><div><span>CHAT <b className={styles.bubbleLanguageBadge}>{item.language === "en" ? "EN" : "PT"}</b></span><h3>{characterName ?? fallbackTitle}</h3></div><div className={styles.bubbleInspectorHeaderActions}><button type="button" className={styles.bubbleInspectorClose} aria-label="Excluir balão" title="Excluir balão" onClick={onRemove}><StudioGlyph name="close" /></button></div></div>
    <div className={styles.bubbleTextCard}><label className={styles.textField}><span className={styles.textFieldHeading}><span>Texto do balão</span><span className={styles.textFieldActions}><button type="button" disabled={!item.text.trim()} onClick={onCopy}>Copiar</button><button type="button" onClick={onPaste}>Colar</button></span></span><textarea value={item.text} onChange={(event) => onUpdate({ text: event.target.value })} />{item.language !== "en" && <button type="button" className={styles.aiTextButton} disabled={!item.text.trim() || isTranslating} onClick={onGenerateEnglish}>{isTranslating ? "Gerando inglês…" : "Gerar Inglês"}</button>}{characterName && <button type="button" className={styles.bubbleBackButton} onClick={onBackToCharacter}>Voltar</button>}</label></div>
    <div className={styles.bubbleControlsCard}><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.5} max={2.5} /><label className={styles.rangeField}><span>Largura <b>{item.width}px</b></span><input type="range" min="180" max="560" value={item.width} onChange={(event) => onUpdate({ width: Number(event.target.value) })} /></label><label className={styles.rangeField}><span>Tamanho do texto <b>{item.fontSize}px</b></span><input type="range" min="14" max="48" value={item.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label></div>
    <div className={styles.bubbleActionStack}><button type="button" onClick={() => onUpdate({ tailSide: item.tailSide === "left" ? "right" : "left" })}><StudioGlyph name="flip" /> Mudar direção da ponta</button><LayerButtons onLayer={onLayer} /><button type="button" onClick={onDuplicate}>Duplicar balão</button><button type="button" className={styles.bubbleDeleteButton} onClick={onRemove}>Excluir balão</button></div>
  </>;
}

function NarratorInspector({ item, onUpdate, onLayer, onRemove, onDuplicate }: InspectorProps<SceneNarrator>) {
  return <><div className={styles.inspectorTitle}><div><span>NARRADOR</span><h3>Caixa de texto</h3></div><button onClick={onRemove}><StudioGlyph name="close" /></button></div><label className={styles.textField}>Texto<textarea value={item.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label><ScaleControl value={item.scale} onChange={(scale) => onUpdate({ scale })} min={.5} max={2.5} /><label className={styles.rangeField}><span>Largura <b>{item.width}px</b></span><input type="range" min="220" max="800" value={item.width} onChange={(event) => onUpdate({ width: Number(event.target.value) })} /></label><label className={styles.rangeField}><span>Fonte <b>{item.fontSize}px</b></span><input type="range" min="14" max="54" value={item.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label><div className={styles.stateSwitch}>{(["left", "center", "right"] as const).map((align) => <button key={align} className={item.align === align ? styles.activeOption : ""} onClick={() => onUpdate({ align })}>{align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}</button>)}</div><button className={styles.wideButton} onClick={() => onUpdate({ boxed: !item.boxed })}>{item.boxed ? "Usar somente texto" : "Adicionar caixa de fundo"}</button><LayerButtons onLayer={onLayer} /><button className={styles.wideButton} onClick={onDuplicate}>Duplicar narração</button><button className={styles.dangerButton} onClick={onRemove}>Excluir narração</button></>;
}

type StudioInspectorProps = {
  studio: Studio;
  selection: Selection;
  selectedCharacter: SceneCharacter | null;
  selectedCharacterSource: Character | null;
  selectedObject: SceneObject | null;
  selectedBubble: SceneBubble | null;
  selectedBubbleCharacterName: string | null;
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
  onPrint: () => void;
  isPrinting: boolean;
  onCloseCharacterInspector: () => void;
  onBackToBubbleCharacter: () => void;
  characterInspectorExpanded: boolean;
  inspectorDockSide: "left" | "right";
  onToggleCharacterInspectorWidth: () => void;
  onAddBubblePair: (type: SceneBubble["bubbleType"]) => void;
  characterHasBubbles: boolean;
  onGoToCharacterBubble: () => void;
  onClearCharacterBubbles: () => void;
  onPose: () => void;
  poseLabel: string;
  poseDisabled: boolean;
  onNudgeOutfit: (dx: number, dy: number) => void;
  outfitAdjustDisabled: boolean;
};

export function StudioInspector({ studio, selection, selectedCharacter, selectedCharacterSource, selectedObject, selectedBubble, selectedBubbleCharacterName, selectedNarrator, emotions, translatingBubbleId, onToggleBackgroundFit, backgroundCollapsed, onToggleBackgroundCollapsed, onRemoveBackground, onUpdate, onCopyBubble, onPasteBubble, onGenerateEnglish, onLayer, onRemove, onDuplicate, onPrint, isPrinting, onCloseCharacterInspector, onBackToBubbleCharacter, characterInspectorExpanded, inspectorDockSide, onToggleCharacterInspectorWidth, onAddBubblePair, characterHasBubbles, onGoToCharacterBubble, onClearCharacterBubbles, onPose, poseLabel, poseDisabled, onNudgeOutfit, outfitAdjustDisabled }: StudioInspectorProps) {
  const update = <T extends object>(kind: NonNullable<Selection>["kind"], id: string, patch: Partial<T>) => onUpdate(kind, id, patch as Record<string, unknown>);
  if (!selection && !studio.background) return null;
  if (studio.background && !selection && backgroundCollapsed) return null;
  return <section className={`${styles.inspector} ${selectedCharacter && selectedCharacterSource ? `${styles.characterInspector} ${characterInspectorExpanded ? styles.characterInspectorExpanded : ""}` : ""} ${selectedBubble ? styles.bubbleInspector : ""}`}>
    {studio.background && !selection && <>{backgroundCollapsed ? <div className={styles.backgroundCollapsed}><strong>Fundo</strong><button onClick={onToggleBackgroundCollapsed}>Mostrar controles</button></div> : <><div className={styles.backgroundPanelHeading}><h3>Fundo</h3><button aria-label="Recolher painel Fundo" title="Recolher painel Fundo" onClick={onToggleBackgroundCollapsed}>▴</button></div><button onClick={onToggleBackgroundFit}>{studio.background.fit === "cover" ? "Mostrar inteiro" : "Preencher tela"}</button><button className={styles.dangerButton} onClick={onRemoveBackground}>Remover fundo</button></>}</>}
    {selectedCharacter && selectedCharacterSource && <CharacterInspector item={selectedCharacter} emotions={emotions} expanded={characterInspectorExpanded} dockSide={inspectorDockSide} onToggleWidth={onToggleCharacterInspectorWidth} onUpdate={(patch) => update("character", selectedCharacter.id, patch)} onLayer={onLayer} onRemove={onRemove} onClose={onCloseCharacterInspector} onPrint={onPrint} isPrinting={isPrinting} onAddBubblePair={onAddBubblePair} characterHasBubbles={characterHasBubbles} onGoToCharacterBubble={onGoToCharacterBubble} onClearCharacterBubbles={onClearCharacterBubbles} onPose={onPose} poseLabel={poseLabel} poseDisabled={poseDisabled} onNudgeOutfit={onNudgeOutfit} outfitAdjustDisabled={outfitAdjustDisabled} />}
    {selectedObject && <ObjectInspector item={selectedObject} onUpdate={(patch) => update("object", selectedObject.id, patch)} onLayer={onLayer} onRemove={onRemove} onDuplicate={onDuplicate} />}
    {selectedBubble && <BubbleInspector item={selectedBubble} characterName={selectedBubbleCharacterName} onBackToCharacter={onBackToBubbleCharacter} onUpdate={(patch) => update("bubble", selectedBubble.id, patch)} onCopy={onCopyBubble} onPaste={() => onPasteBubble((patch) => update("bubble", selectedBubble.id, patch))} onGenerateEnglish={onGenerateEnglish} isTranslating={translatingBubbleId === selectedBubble.id} onLayer={onLayer} onRemove={onRemove} onDuplicate={onDuplicate} />}
    {selectedNarrator && <NarratorInspector item={selectedNarrator} onUpdate={(patch) => update("narrator", selectedNarrator.id, patch)} onLayer={onLayer} onRemove={onRemove} onDuplicate={onDuplicate} />}
  </section>;
}
