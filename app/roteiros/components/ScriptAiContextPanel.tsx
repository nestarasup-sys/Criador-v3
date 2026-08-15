"use client";

import { createGlobalRule, createNarrativeProfile, nowIso } from "../defaults";
import { profileCompletion } from "../ai-context";
import type { GlobalRule, NarrativeProfile, PremiumCharacter, RoteirosState, ScriptAiContext, ScriptProject } from "../types";
import styles from "../roteiros.module.css";

type ScriptAiContextPanelProps = {
  script: ScriptProject;
  characters: PremiumCharacter[];
  state: RoteirosState;
  onPatchScript: (patch: Partial<ScriptProject>) => void;
};

function contextFor(script: ScriptProject, state: RoteirosState): ScriptAiContext {
  if (script.aiContext) return script.aiContext;
  const participantIds = new Set(script.participants.map((participant) => participant.characterId));
  const profiles = state.profiles.filter((profile) => participantIds.has(profile.characterId));
  return { profiles: structuredClone(profiles), rules: structuredClone(state.globalRules) };
}

function profileFor(context: ScriptAiContext, characterId: string) {
  return context.profiles.find((profile) => profile.characterId === characterId) ?? createNarrativeProfile(characterId);
}

export default function ScriptAiContextPanel({ script, characters, state, onPatchScript }: ScriptAiContextPanelProps) {
  const context = contextFor(script, state);
  const participantIds = script.participants.map((participant) => participant.characterId);
  const participantCharacters = participantIds.map((id) => characters.find((character) => character.id === id)).filter((character): character is PremiumCharacter => Boolean(character));

  const patchContext = (patch: Partial<ScriptAiContext>) => onPatchScript({ aiContext: { ...context, ...patch } });
  const patchProfile = (characterId: string, patch: Partial<NarrativeProfile>) => {
    const current = profileFor(context, characterId);
    const next = { ...current, ...patch, updatedAt: nowIso() };
    const profiles = context.profiles.some((profile) => profile.characterId === characterId)
      ? context.profiles.map((profile) => profile.characterId === characterId ? next : profile)
      : [...context.profiles, next];
    patchContext({ profiles });
  };
  const copyGlobalProfile = (characterId: string) => {
    const globalProfile = state.profiles.find((profile) => profile.characterId === characterId) ?? createNarrativeProfile(characterId);
    patchProfile(characterId, structuredClone(globalProfile));
  };
  const copyGlobalContext = () => {
    const selected = new Set(participantIds);
    const globalProfiles = state.profiles.filter((profile) => selected.has(profile.characterId));
    const existing = new Set(globalProfiles.map((profile) => profile.characterId));
    const missing = participantIds.filter((id) => !existing.has(id)).map(createNarrativeProfile);
    patchContext({ profiles: structuredClone([...globalProfiles, ...missing]), rules: structuredClone(state.globalRules) });
  };
  const patchRule = (id: string, patch: Partial<GlobalRule>) => patchContext({ rules: context.rules.map((rule) => rule.id === id ? { ...rule, ...patch, updatedAt: nowIso() } : rule) });
  const addRule = () => patchContext({ rules: [...context.rules, createGlobalRule()] });
  const removeRule = (id: string) => patchContext({ rules: context.rules.filter((rule) => rule.id !== id) });

  return <details className={styles.aiContextPanel} open>
    <summary><span><b>CONTEXTO ISOLADO</b><small>Usado somente neste roteiro</small></span><i>{context.profiles.length} fichas · {context.rules.length} regras</i></summary>
    <div className={styles.aiContextNotice}>Este roteiro não lê alterações feitas em outros roteiros. As telas globais servem como modelos; sincronize manualmente quando quiser.</div>
    <div className={styles.aiContextActions}><button className={styles.secondaryButton} onClick={copyGlobalContext}>Sincronizar modelos globais</button><span>Isso substitui as fichas e regras locais.</span></div>
    <div className={styles.aiContextProfiles}>
      {participantCharacters.map((character) => {
        const profile = profileFor(context, character.id);
        return <details className={styles.aiContextProfile} key={character.id}>
          <summary><span>{character.name}</span><b>{profileCompletion(profile)}%</b></summary>
          <div className={styles.aiContextProfileActions}><small>Ficha exclusiva deste roteiro</small><button className={styles.textButton} onClick={() => copyGlobalProfile(character.id)}>Copiar modelo global</button></div>
          <label className={styles.field}><span>Personalidade</span><textarea rows={4} maxLength={12000} value={profile.personality} onChange={(event) => patchProfile(character.id, { personality: event.target.value })} /></label>
          <label className={styles.field}><span>História</span><textarea rows={4} maxLength={12000} value={profile.backstory} onChange={(event) => patchProfile(character.id, { backstory: event.target.value })} /></label>
          <label className={styles.field}><span>Relação com FYN</span><textarea rows={3} maxLength={10000} value={profile.fynRelationship} onChange={(event) => patchProfile(character.id, { fynRelationship: event.target.value })} /></label>
          <label className={styles.field}><span>Estilo de fala</span><textarea rows={3} maxLength={8000} value={profile.speakingStyle} onChange={(event) => patchProfile(character.id, { speakingStyle: event.target.value })} /></label>
          <label className={styles.field}><span>Regras particulares</span><textarea rows={3} maxLength={10000} value={profile.additionalRules} onChange={(event) => patchProfile(character.id, { additionalRules: event.target.value })} /></label>
        </details>;
      })}
      {participantCharacters.length === 0 && <div className={styles.subtleEmpty}>Adicione personagens ao elenco para editar fichas locais.</div>}
    </div>
    <div className={styles.aiContextRulesHeader}><div><b>Regras deste roteiro</b><small>Somente estas regras personalizadas são enviadas para a geração.</small></div><button className={styles.secondaryButton} onClick={addRule}>＋ Regra</button></div>
    <div className={styles.aiContextRules}>{context.rules.map((rule) => <article key={rule.id} className={!rule.enabled ? styles.disabledRule : ""}><input value={rule.title} maxLength={100} onChange={(event) => patchRule(rule.id, { title: event.target.value })} /><select value={rule.priority} onChange={(event) => patchRule(rule.id, { priority: event.target.value as GlobalRule["priority"] })}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select><label><input type="checkbox" checked={rule.enabled} onChange={(event) => patchRule(rule.id, { enabled: event.target.checked })} /> ativa</label><textarea rows={3} maxLength={10000} value={rule.description} onChange={(event) => patchRule(rule.id, { description: event.target.value })} placeholder="Regra válida somente neste roteiro…" /><button className={styles.deleteButton} onClick={() => removeRule(rule.id)}>Excluir</button></article>)}</div>
  </details>;
}
