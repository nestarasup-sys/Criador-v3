import type { Character } from "../../domain/character-contract";
import type { Model } from "../../domain/character-primitives";

type CreatorLibraryPanelProps = {
  characters: Character[];
  activeCharacter: string | null;
  activePhoto: string | null;
  characterName: string;
  model: Model;
  migrationAvailable: boolean;
  migrating: boolean;
  getPackName: (character: Character) => string;
  onNameChange: (value: string) => void;
  onChangeModel: (model: Model) => void;
  onMigrate: () => void;
  onOpenCharacter: (character: Character) => void;
  onRemoveCharacter: (id: string) => void;
  onNewCharacter: () => void;
};

export function CreatorLibraryPanel({ characters, activeCharacter, activePhoto, characterName, model, migrationAvailable, migrating, getPackName, onNameChange, onChangeModel, onMigrate, onOpenCharacter, onRemoveCharacter, onNewCharacter }: CreatorLibraryPanelProps) {
  return <aside className="sidebar left-panel">
    <div className="panel-heading">
      <div><span>MEUS PERSONAGENS</span><small>{characters.length} salvos</small></div>
      <button className="new-character-header-button" onClick={onNewCharacter}>＋ Novo personagem</button>
    </div>
    <details className="character-settings">
      <summary>Editar personagem atual</summary>
      <label className="field-label" htmlFor="character-name">Nome</label>
      <input id="character-name" className="name-input" value={characterName} onChange={(event) => onNameChange(event.target.value)} maxLength={40} />
      <span className="field-label">Modelo</span>
      <div className="model-switch" role="group" aria-label="Modelo do personagem">
        <button className={model === "feminino" ? "active" : ""} onClick={() => onChangeModel("feminino")}>Feminino</button>
        <button className={model === "masculino" ? "active" : ""} onClick={() => onChangeModel("masculino")}>Masculino</button>
      </div>
      {migrationAvailable && <button className="migration-button" onClick={onMigrate} disabled={migrating}>{migrating ? "Migrando…" : "Migrar dados deste navegador"}</button>}
    </details>
    <div className="saved-list">
      {characters.length === 0 ? <div className="empty-saved">Seus personagens salvos aparecerão aqui.</div> : characters.map((character) => {
        const photo = activeCharacter === character.id ? activePhoto ?? character.photoUrl ?? character.photoDataUrl : character.photoUrl ?? character.photoDataUrl;
        return <div className={`saved-card ${activeCharacter === character.id ? "selected" : ""}`} key={character.id}>
          <button className="saved-main" onClick={() => onOpenCharacter(character)}>
            <span className="saved-avatar">{photo ? <img src={photo} alt={`Foto de ${character.name}`} /> : character.model === "feminino" ? "F" : "M"}</span>
            <span><strong>{character.name}</strong><small>{character.model} · {getPackName(character)}</small></span>
          </button>
          <button className="icon-button danger" title="Excluir personagem" onClick={() => onRemoveCharacter(character.id)}>×</button>
        </div>;
      })}
    </div>
  </aside>;
}
