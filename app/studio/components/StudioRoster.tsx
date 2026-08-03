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
};

export function StudioRoster({ rosterIds, charactersById, rendered, renderCacheKey, selection, onSelectCharacter, onEditRoster, findInstance }: StudioRosterProps) {
  return <section className={styles.roster}>
    <div className={styles.rosterHeading}><span>ELENCO</span><button title="Editar participantes" onClick={onEditRoster}>＋</button></div>
    <div className={styles.rosterList}>{rosterIds.map((id) => {
      const character = charactersById.get(id);
      if (!character) return null;
      const instance = findInstance(id);
      const active = selection?.kind === "character" && selection.id === instance?.id;
      const rosterSource = rendered[renderCacheKey(character, character.expressionEmotion ?? "normal", character.expressionState ?? "default")] ?? character.photoUrl ?? character.photoDataUrl;
      return <button key={id} className={`${styles.rosterCard} ${active ? styles.activeRoster : ""}`} onClick={() => onSelectCharacter(id)}>{rosterSource ? <img src={rosterSource} alt="" /> : <span>{character.model === "feminino" ? "F" : "M"}</span>}<strong>{character.name}</strong><i className={instance ? styles.onStage : ""}>{instance ? "●" : "+"}</i></button>;
    })}</div>
  </section>;
}
