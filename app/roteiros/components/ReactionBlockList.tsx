"use client";

import { useState } from "react";
import type { PremiumCharacter, ReactionBlock, ScriptProject, TikTokSection } from "../types";
import styles from "../roteiros.module.css";

type ReactionBlockListProps = {
  script: ScriptProject;
  section: TikTokSection;
  characters: PremiumCharacter[];
  loading: string;
  aiEnabled: boolean;
  onUpdateBlock: (id: string, patch: Partial<ReactionBlock>) => void;
  onMoveBlock: (index: number, direction: -1 | 1) => void;
  onBlockAction: (index: number, action: "rewrite" | "regenerate") => void;
  onTranslate: (block: ReactionBlock) => void;
  onAddBlock: () => void;
  onDuplicateBlock: (block: ReactionBlock, index: number) => void;
  onRemoveBlock: (id: string) => void;
};

function blockCharacterName(characters: PremiumCharacter[], id: string) {
  return characters.find((character) => character.id === id)?.name || "Personagem removido";
}

function BlockCharacterMark({ character, name }: { character?: PremiumCharacter; name: string }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photo = character?.photoUrl ?? character?.photoDataUrl;
  const imageFailed = Boolean(photo && failedPhoto === photo);
  return <span className={`${styles.blockAvatar} ${character?.model === "feminino" ? styles.blockAvatarFeminine : styles.blockAvatarMasculine}`}>
    {photo && !imageFailed ? <img src={photo} alt={`Foto de ${name}`} onError={() => setFailedPhoto(photo)} /> : name.trim().slice(0, 1).toUpperCase() || "?"}
  </span>;
}

export function ReactionBlockList({ script, section, characters, loading, aiEnabled, onUpdateBlock, onMoveBlock, onBlockAction, onTranslate, onAddBlock, onDuplicateBlock, onRemoveBlock }: ReactionBlockListProps) {
  const participantIds = new Set(script.participants.map((item) => item.characterId));
  return <section className={styles.blocksSection}>
    <header className={styles.blocksHeader}>
      <div className={styles.blocksHeading}><span className={styles.blocksZoneIcon}>▣</span><b>3</b><div><strong>Sequência de reações</strong><small>Organize e edite as reações dos personagens neste TikTok.</small></div></div>
      <button className={styles.secondaryButton} onClick={onAddBlock}>＋ Adicionar bloco</button>
    </header>
    <div className={styles.blockList}>{section.reactionBlocks.map((block, blockIndex) => <article className={styles.reactionBlock} data-tone={blockIndex % 4} key={block.id}>
      <div className={styles.blockIdentity}><BlockCharacterMark character={characters.find((character) => character.id === block.characterId)} name={blockCharacterName(characters, block.characterId)} /><span className={styles.blockNumber}>{String(blockIndex + 1).padStart(2, "0")}</span></div>
      <div className={styles.blockMain}>
        <div className={styles.blockControls}>
          <label><span>Personagem</span><select value={block.characterId} onChange={(event) => onUpdateBlock(block.id, { characterId: event.target.value })}><option value="">Escolher…</option>{characters.filter((character) => participantIds.has(character.id)).map((character) => <option key={character.id} value={character.id}>{character.name}{script.participants.find((item) => item.characterId === character.id)?.active ? "" : " (inativo)"}</option>)}</select></label>
          <label><span>Tipo</span><select value={block.type} onChange={(event) => onUpdateBlock(block.id, { type: event.target.value as ReactionBlock["type"], text: event.target.value === "silent" ? "" : block.text, englishText: event.target.value === "silent" ? "" : block.englishText })}><option value="speech">Fala</option><option value="thought">Pensamento</option><option value="silent">Reação</option></select></label>
          <label className={styles.emotionField}><span>Expressão ou emoção</span><input value={block.emotion} maxLength={500} onChange={(event) => onUpdateBlock(block.id, { emotion: event.target.value })} placeholder="Ex: sério, desviando o olhar" /></label>
        </div>
        <label className={styles.field}><span>{block.type === "silent" ? "Descrição da reação" : block.type === "thought" ? "Pensamento em português" : "Fala em português"}</span><textarea rows={3} value={block.type === "silent" ? block.emotion : block.text} onChange={(event) => onUpdateBlock(block.id, block.type === "silent" ? { emotion: event.target.value } : { text: event.target.value })} placeholder={block.type === "silent" ? "Descreva o gesto ou reação silenciosa…" : "Escreva o conteúdo do bloco…"} /></label>
        {block.type !== "silent" && <label className={styles.field}><span>Versão em inglês</span><textarea rows={2} value={block.englishText} onChange={(event) => onUpdateBlock(block.id, { englishText: event.target.value })} placeholder="A tradução aparecerá aqui…" /></label>}
        <div className={styles.blockActions}>
          <button disabled={blockIndex === 0} onClick={() => onMoveBlock(blockIndex, -1)}>↑ Subir</button>
          <button disabled={blockIndex === section.reactionBlocks.length - 1} onClick={() => onMoveBlock(blockIndex, 1)}>↓ Descer</button>
          <button disabled={!aiEnabled || Boolean(loading) || !block.characterId} onClick={() => onBlockAction(blockIndex, "regenerate")}>✦ {loading === `regenerate-${blockIndex}` ? "Gerando…" : "Regenerar"}</button>
          <button disabled={!aiEnabled || Boolean(loading) || !block.characterId || block.type !== "silent" && !block.text.trim()} onClick={() => onBlockAction(blockIndex, "rewrite")}>✎ Refazer frase</button>
          {block.type !== "silent" && <button disabled={!aiEnabled || Boolean(loading) || !block.text.trim()} onClick={() => onTranslate(block)}>◎ {loading === `translate-${block.id}` ? "Traduzindo…" : "Traduzir"}</button>}
          <button onClick={() => onDuplicateBlock(block, blockIndex)}>▣ Duplicar</button>
          <button className={styles.deleteButton} onClick={() => onRemoveBlock(block.id)}>▱ Excluir</button>
        </div>
      </div>
    </article>)}</div>
  </section>;
}
