import styles from "../studio.module.css";
import type { Character, SceneCharacter, Selection } from "../types";
import { StudioGlyph } from "./StudioGlyph";

type StudioRosterProps = {
  rosterIds: string[];
  charactersById: Map<string, Character>;
  rendered: Record<string, string>;
  renderedFallback: Record<string, string>;
  renderCacheKey: (character: Character, emotion: string, state: string, instance?: SceneCharacter) => string;
  selection: Selection;
  onSelectCharacter: (characterId: string) => void;
  onEditRoster: () => void;
  findInstance: (characterId: string) => SceneCharacter | undefined;
  positionsLocked: boolean;
  onTogglePositionsLock: () => void;
  backgroundCollapsed: boolean;
  onToggleBackgroundCollapsed: () => void;
  compact: boolean;
  onToggleCompact: () => void;
};

export function StudioRoster({ rosterIds, charactersById, rendered, renderedFallback, renderCacheKey, selection, onSelectCharacter, onEditRoster, findInstance, positionsLocked, onTogglePositionsLock, backgroundCollapsed, onToggleBackgroundCollapsed, compact, onToggleCompact }: StudioRosterProps) {
  return <section className={`${styles.roster} ${compact ? styles.rosterCompact : ""}`}>
    <div className={styles.rosterHeading}><span>ELENCO</span><div className={styles.rosterActions}><button title={positionsLocked ? "Desbloquear posições dos personagens" : "Bloquear posições dos personagens"} aria-label={positionsLocked ? "Desbloquear posições" : "Bloquear posições"} className={positionsLocked ? styles.rosterControlActive : ""} onClick={onTogglePositionsLock}><StudioGlyph name="lock" /></button><button title={compact ? "Voltar ao tamanho normal" : "Recolher nomes e compactar elenco"} aria-label={compact ? "Voltar ao tamanho normal" : "Compactar elenco"} onClick={onToggleCompact}><StudioGlyph name="compact" /></button><button title={backgroundCollapsed ? "Expandir painel Fundo" : "Recolher painel Fundo"} aria-label={backgroundCollapsed ? "Expandir painel Fundo" : "Recolher painel Fundo"} onClick={onToggleBackgroundCollapsed}><StudioGlyph name="expand" /></button><button title="Editar participantes" aria-label="Editar participantes" onClick={onEditRoster}><StudioGlyph name="add" /></button></div></div>
    <div className={styles.rosterList}>{rosterIds.map((id) => {
      const character = charactersById.get(id);
      if (!character) return null;
      const instance = findInstance(id);
      const active = selection?.kind === "character" && selection.id === instance?.id;
      const rosterSource = rendered[renderCacheKey(character, instance?.expressionEmotion ?? character.expressionEmotion ?? "normal", instance?.expressionState ?? character.expressionState ?? "default", instance)]
        ?? (instance ? renderedFallback[instance.id] : undefined)
        ?? renderedFallback[character.id]
        ?? character.photoUrl
        ?? character.photoDataUrl;
      return <button key={id} type="button" aria-label={`Selecionar ${character.name} no elenco`} className={`${styles.rosterCard} ${active ? styles.activeRoster : ""}`} onClick={() => onSelectCharacter(id)}>{rosterSource ? <img src={rosterSource} alt="" /> : <span>{character.model === "feminino" ? "F" : "M"}</span>}<strong>{character.name}</strong><i className={instance ? styles.onStage : ""}>{instance ? "●" : "+"}</i></button>;
    })}</div>
  </section>;
}
