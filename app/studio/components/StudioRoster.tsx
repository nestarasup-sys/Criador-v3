import styles from "../studio.module.css";
import type { Character, SceneCharacter, Selection } from "../types";

type StudioRosterProps = {
  rosterIds: string[];
  charactersById: Map<string, Character>;
  rendered: Record<string, string>;
  renderCacheKey: (character: Character, emotion: string, state: string) => string;
  selection: Selection;
  onSelectCharacter: (characterId: string) => void;
  onEditRoster: () => void;
  findInstance: (characterId: string) => SceneCharacter | undefined;
  positionsLocked: boolean;
  onTogglePositionsLock: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  compact: boolean;
  onToggleCompact: () => void;
};

export function StudioRoster({ rosterIds, charactersById, rendered, renderCacheKey, selection, onSelectCharacter, onEditRoster, findInstance, positionsLocked, onTogglePositionsLock, collapsed, onToggleCollapsed, compact, onToggleCompact }: StudioRosterProps) {
  return <section className={`${styles.roster} ${compact ? styles.rosterCompact : ""}`}>
    <div className={styles.rosterHeading}><span>ELENCO</span><div className={styles.rosterActions}><button title={positionsLocked ? "Desbloquear posições dos personagens" : "Bloquear posições dos personagens"} aria-label={positionsLocked ? "Desbloquear posições" : "Bloquear posições"} className={positionsLocked ? styles.rosterControlActive : ""} onClick={onTogglePositionsLock}>{positionsLocked ? "🔒" : "🔓"}</button><button title={compact ? "Voltar ao tamanho normal" : "Recolher nomes e compactar elenco"} aria-label={compact ? "Voltar ao tamanho normal" : "Compactar elenco"} onClick={onToggleCompact}>{compact ? "↔" : "⇔"}</button><button title={collapsed ? "Expandir elenco" : "Recolher elenco"} aria-label={collapsed ? "Expandir elenco" : "Recolher elenco"} onClick={onToggleCollapsed}>{collapsed ? "▸" : "▾"}</button><button title="Editar participantes" aria-label="Editar participantes" onClick={onEditRoster}>＋</button></div></div>
    {!collapsed && <div className={styles.rosterList}>{rosterIds.map((id) => {
      const character = charactersById.get(id);
      if (!character) return null;
      const instance = findInstance(id);
      const active = selection?.kind === "character" && selection.id === instance?.id;
      const rosterSource = rendered[renderCacheKey(character, character.expressionEmotion ?? "normal", character.expressionState ?? "default")] ?? character.photoUrl ?? character.photoDataUrl;
      return <button key={id} className={`${styles.rosterCard} ${active ? styles.activeRoster : ""}`} onClick={() => onSelectCharacter(id)}>{rosterSource ? <img src={rosterSource} alt="" /> : <span>{character.model === "feminino" ? "F" : "M"}</span>}<strong>{character.name}</strong><i className={instance ? styles.onStage : ""}>{instance ? "●" : "+"}</i></button>;
    })}</div>}
  </section>;
}
