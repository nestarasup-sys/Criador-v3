"use client";

/* eslint-disable @next/next/no-img-element -- character thumbnails can be dynamic local data URLs. */

import { useState } from "react";
import type { GeneratedReaction, PremiumCharacter, ReactionBlock, ScriptProject, TikTokSection } from "../types";
import styles from "../roteiros.module.css";

type ReactionBlockListProps = {
  script: ScriptProject;
  section: TikTokSection;
  characters: PremiumCharacter[];
  loading: string;
  aiEnabled: boolean;
  onUpdateBlock: (id: string, patch: Partial<ReactionBlock>) => void;
  onMoveBlock: (index: number, direction: -1 | 1) => void;
  onBlockAction: (index: number, action: "variations" | "improve") => void;
  phraseVariations: { blockId: string; items: GeneratedReaction[]; model: string } | null;
  onSelectVariation: (blockId: string, variation: GeneratedReaction) => void;
  onDismissVariations: () => void;
  onTranslate: (block: ReactionBlock) => void;
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

export function ReactionBlockList({ script, section, characters, loading, aiEnabled, onUpdateBlock, onMoveBlock, onBlockAction, phraseVariations, onSelectVariation, onDismissVariations, onTranslate, onDuplicateBlock, onRemoveBlock }: ReactionBlockListProps) {
  const participantIds = new Set(script.participants.map((item) => item.characterId));
  return <section className={styles.blocksSection}>
    <header className={styles.blocksHeader}>
      <div className={styles.blocksHeading}><span className={styles.blocksZoneIcon}>▣</span><b>3</b><div><strong>Sequência de reações</strong></div></div>
    </header>
    <div className={styles.blockList}>{section.reactionBlocks.map((block, blockIndex) => <article className={styles.reactionBlock} data-tone={blockIndex % 4} key={block.id}>
      <div className={styles.blockIdentity}><BlockCharacterMark character={characters.find((character) => character.id === block.characterId)} name={blockCharacterName(characters, block.characterId)} /><span className={styles.blockNumber}>{String(blockIndex + 1).padStart(2, "0")}</span></div>
      <div className={styles.blockMain}>
        <div className={styles.blockControls}>
          <label><span>Personagem</span><select value={block.characterId} onChange={(event) => onUpdateBlock(block.id, { characterId: event.target.value })}><option value="">Escolher…</option>{characters.filter((character) => participantIds.has(character.id)).map((character) => <option key={character.id} value={character.id}>{character.name}{script.participants.find((item) => item.characterId === character.id)?.active ? "" : " (inativo)"}</option>)}</select></label>
          <label><span>Tipo</span><select value={block.type} onChange={(event) => onUpdateBlock(block.id, { type: event.target.value as ReactionBlock["type"] })}><option value="auto">Automático (IA decide)</option><option value="speech">Fala</option><option value="thought">Pensamento</option></select></label>
          <label className={styles.emotionField}><span>Expressão ou emoção</span><input value={block.emotion} maxLength={500} onChange={(event) => onUpdateBlock(block.id, { emotion: event.target.value })} placeholder="Ex: sério, desviando o olhar" /></label>
        </div>
        <label className={styles.field}><span>{block.type === "thought" ? "Pensamento em português" : block.type === "auto" ? "Conteúdo em português (a IA define o tipo)" : "Fala em português"}</span><textarea rows={3} value={block.text} onChange={(event) => onUpdateBlock(block.id, { text: event.target.value })} placeholder="Escreva o conteúdo do bloco…" /></label>
        <label className={styles.field}><span>Versão em inglês</span><textarea rows={2} value={block.englishText} onChange={(event) => onUpdateBlock(block.id, { englishText: event.target.value })} placeholder="A tradução aparecerá aqui…" /></label>
        <div className={styles.blockActions}>
          <button disabled={blockIndex === 0} onClick={() => onMoveBlock(blockIndex, -1)}>↑ Subir</button>
          <button disabled={blockIndex === section.reactionBlocks.length - 1} onClick={() => onMoveBlock(blockIndex, 1)}>↓ Descer</button>
          <button disabled={!aiEnabled || Boolean(loading) || !block.characterId || !block.text.trim()} onClick={() => onBlockAction(blockIndex, "improve")}>✦ {loading === `improve-${blockIndex}` ? "Melhorando…" : "Melhorar frase"}</button>
          <button title="Gerar 3 variações da frase atual" disabled={!aiEnabled || Boolean(loading) || !block.characterId || !block.text.trim()} onClick={() => onBlockAction(blockIndex, "variations")}>✎ {loading === `variations-${blockIndex}` ? "Gerando 3…" : "Refazer frase"}</button>
          <button disabled={!aiEnabled || Boolean(loading) || !block.text.trim()} onClick={() => onTranslate(block)}>◎ {loading === `translate-${block.id}` ? "Traduzindo…" : "Traduzir"}</button>
          <button onClick={() => onDuplicateBlock(block, blockIndex)}>▣ Duplicar</button>
          <button className={styles.deleteButton} onClick={() => onRemoveBlock(block.id)}>▱ Excluir</button>
        </div>
        {phraseVariations?.blockId === block.id && <div className={styles.phraseVariations} role="region" aria-label="Variações da frase"><div className={styles.phraseVariationsHeader}><strong>3 variações da frase atual</strong><button onClick={onDismissVariations} aria-label="Fechar variações">×</button></div><small>Escolha uma opção para substituir a frase do bloco. A frase atual permanece até você escolher.</small><div className={styles.phraseVariationList}>{phraseVariations.items.map((variation, variationIndex) => <button className={styles.phraseVariation} key={`${block.id}-variation-${variationIndex}`} onClick={() => onSelectVariation(block.id, variation)}><span>OPÇÃO {variationIndex + 1}</span><strong>{variation.text}</strong><small>{variation.emotion || "Emoção preservada"}</small></button>)}</div><small className={styles.phraseVariationModel}>Gerado por {phraseVariations.model}</small></div>}
      </div>
    </article>)}</div>
  </section>;
}
