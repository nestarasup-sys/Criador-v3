"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createGlobalRule, createId, createNarrativeProfile, createScriptAiContext, createScriptProject, nowIso, PROTECTED_RULES } from "../defaults";
import { profileCompletion } from "../ai-context";
import { normalizeRoteirosState } from "../../domain/document-schemas.mjs";
import { aiRequest, cleanupRoteiroOrphans, createRoteiroBackup, exportJson, listRoteiroBackups, listRoteiroOrphans, removeRoteiro, restoreRoteiroBackup, type RoteiroOrphans } from "../storage";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../../shared/NymiShell";
import type { GlobalRule, NarrativeProfile, PremiumCharacter, RoteirosState, ScriptProject } from "../types";
import { useRoteirosData } from "../useRoteirosData";
import RecoveryBanner from "./RecoveryBanner";
import styles from "../roteiros.module.css";

type HomeTab = "scripts" | "profiles" | "settings";
const LAST_FILL_EMPTY_PROMPT_KEY = "nymi-roteiros-last-fill-empty-prompt";
type SentPromptPreview = { provider: string; operation: string; instructions: string; input: string; model?: string; attempts?: number; sentAt: string };

function readSentPromptPreview() {
  try {
    const value = JSON.parse(window.localStorage.getItem(LAST_FILL_EMPTY_PROMPT_KEY) || "null");
    return value && typeof value.instructions === "string" && typeof value.input === "string" ? value as SentPromptPreview : null;
  } catch { return null; }
}

function formatSentPrompt(preview: SentPromptPreview) {
  return `=== INSTRUCTIONS / SYSTEM ===\n${preview.instructions}\n\n=== INPUT / PROMPT COMPLETO ===\n${preview.input}`;
}

const statusText = { idle: "Preparando", saving: "Salvando…", saved: "Salvo no PC", error: "Cópia de emergência" } as const;

function CharacterMark({ character, large = false }: { character: PremiumCharacter; large?: boolean }) {
  const photo = character.photoUrl ?? character.photoDataUrl;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const imageFailed = Boolean(photo && failedPhoto === photo);
  const initial = character.name.trim().slice(0, 1).toUpperCase() || (character.model === "feminino" ? "F" : "M");
  return <span className={`${styles.characterMark} ${large ? styles.characterMarkLarge : ""} ${character.model === "feminino" ? styles.feminine : styles.masculine}`}>{photo && !imageFailed ? <img src={photo} alt={`Foto de ${character.name}`} onError={() => setFailedPhoto(photo)} /> : initial}</span>;
}

function Header({ tab, setTab, saveStatus, pcAvailable, saveNow }: { tab: HomeTab; setTab: (tab: HomeTab) => void; saveStatus: keyof typeof statusText; pcAvailable: boolean; saveNow: () => void }) {
  return (
    <>
      <header className={styles.topbar}>
        <Link className={styles.backButton} href="/" aria-label="Voltar ao criador">←</Link>
        <NymiBrand />
        <div className={styles.moduleBadge}><small>MÓDULO</small><strong>ROTEIROS</strong></div>
        <div className={styles.saveCluster}>
          <NymiConnectionStatus connected={pcAvailable} detail={statusText[saveStatus]} />
          <NymiNavigation active="roteiros" compact />
          <button className={styles.ghostButton} onClick={saveNow}>Salvar agora</button>
        </div>
      </header>
      <nav className={styles.mainTabs} aria-label="Áreas de Roteiros">
        <span className={styles.navLabel}>GERENCIAMENTO</span>
        <button className={tab === "scripts" ? styles.active : ""} onClick={() => setTab("scripts")}><span>▤</span> Meus roteiros</button>
        <button className={tab === "profiles" ? styles.active : ""} onClick={() => setTab("profiles")}><span>♙</span> Fichas dos personagens</button>
        <button className={tab === "settings" ? styles.active : ""} onClick={() => setTab("settings")}><span>⚙</span> IA e regras</button>
        <div className={styles.navHint}><span>✦</span><div><strong>Nymi Gacha</strong><small>Histórias organizadas e salvas no seu PC.</small></div></div>
      </nav>
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className={styles.emptyState}><span>✦</span><h2>Seu primeiro roteiro começa aqui</h2><p>Escolha os personagens do Premium e organize cada vídeo em TikToks e blocos de reação.</p><button className={styles.primaryButton} onClick={onCreate}>＋ Criar roteiro</button></div>;
}

function ScriptList({ state, characters, updateState, saveSnapshot }: { state: RoteirosState; characters: PremiumCharacter[]; updateState: (recipe: (state: RoteirosState) => RoteirosState) => void; saveSnapshot: (snapshot: RoteirosState) => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "old" | "name">("recent");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [characterQuery, setCharacterQuery] = useState("");
  const [orphanPreview, setOrphanPreview] = useState<RoteiroOrphans | null>(null);
  const [orphanBusy, setOrphanBusy] = useState(false);

  const visibleScripts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const filtered = state.scripts.filter((script) => !normalized || script.title.toLocaleLowerCase("pt-BR").includes(normalized));
    return [...filtered].sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "pt-BR") : sort === "old" ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [query, sort, state.scripts]);

  const create = async () => {
    const script = createScriptProject(title, selectedIds);
    script.aiContext = createScriptAiContext(selectedIds, state.profiles, state.globalRules);
    const nextState = { ...state, scripts: [...state.scripts, script] };
    updateState(() => nextState);
    if (await saveSnapshot(nextState)) window.location.href = `/roteiros/${script.id}`;
    else window.alert("Não foi possível salvar o roteiro no PC. Verifique o servidor local e tente novamente.");
  };

  const duplicate = (id: string) => {
    updateState((current) => {
      const source = current.scripts.find((item) => item.id === id);
      if (!source) return current;
      const timestamp = nowIso();
      const copy = structuredClone(source);
      copy.id = createId(); copy.title = `${source.title} (cópia)`; copy.createdAt = timestamp; copy.updatedAt = timestamp;
      copy.tiktoks = copy.tiktoks.map((section) => ({ ...section, id: createId(), reactionBlocks: section.reactionBlocks.map((block) => ({ ...block, id: createId() })) }));
      return { ...current, scripts: [...current.scripts, copy] };
    });
  };

  const deleteScript = async (script: ScriptProject) => {
    if (!window.confirm(`Excluir “${script.title}” e todas as pastas dele do PC?`)) return;
    try {
      await removeRoteiro(script.id);
      const nextState = { ...state, scripts: state.scripts.filter((item) => item.id !== script.id) };
      if (!await saveSnapshot(nextState)) throw new Error("O roteiro foi removido no servidor, mas a lista local não pôde ser atualizada.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível excluir o roteiro.");
    }
  };

  const auditOrphans = async () => {
    setOrphanBusy(true);
    try { setOrphanPreview(await listRoteiroOrphans()); }
    catch (error) { window.alert(error instanceof Error ? error.message : "Não foi possível auditar as pastas."); }
    finally { setOrphanBusy(false); }
  };

  const cleanupOrphans = async () => {
    if (!orphanPreview) return;
    const count = orphanPreview.internal.videos.length + orphanPreview.internal.backgrounds.length + orphanPreview.exports.length;
    if (!count || !window.confirm(`Excluir ${count} pasta(s) órfã(s) encontradas?`)) return;
    setOrphanBusy(true);
    try { setOrphanPreview(null); await cleanupRoteiroOrphans(); await auditOrphans(); }
    catch (error) { window.alert(error instanceof Error ? error.message : "Não foi possível limpar as pastas órfãs."); }
    finally { setOrphanBusy(false); }
  };

  return (
    <main className={styles.homeContent}>
      <section className={styles.heroRow}>
        <div><span className={styles.eyebrow}>MEUS ROTEIROS</span><h1>Meus roteiros</h1><p>Organize histórias, reações e cenas em um só lugar.</p></div>
        <div className={styles.heroActions}>
          <button className={styles.secondaryButton} onClick={() => void auditOrphans()} disabled={orphanBusy}>⌕ Auditar pastas</button>
          <button className={styles.secondaryButton} onClick={() => exportJson(`gacha-premium-roteiros-${new Date().toISOString().slice(0, 10)}.json`, { app: "GACHA_PREMIUM_ROTEIROS_V1", version: 1, exportedAt: nowIso(), data: state })}>↓ Exportar todos</button>
          <button className={styles.primaryButton} onClick={() => setCreating(true)}>＋ Criar roteiro</button>
        </div>
      </section>

      <section className={styles.summaryGrid}>
        <article><span>ROTEIROS</span><strong>{state.scripts.length}</strong><small>projetos salvos</small></article>
        <article><span>TIKTOKS</span><strong>{state.scripts.reduce((total, script) => total + script.tiktoks.length, 0)}</strong><small>seções de vídeo</small></article>
        <article><span>BLOCOS</span><strong>{state.scripts.reduce((total, script) => total + script.tiktoks.reduce((sum, section) => sum + section.reactionBlocks.length, 0), 0)}</strong><small>reações organizadas</small></article>
      </section>

      {state.scripts.length > 0 && <div className={styles.listToolbar}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="⌕ Pesquisar roteiro…" /><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Mais recentes</option><option value="old">Mais antigos</option><option value="name">Nome</option></select></div>}

      {state.scripts.length === 0 ? <EmptyState onCreate={() => setCreating(true)} /> : <div className={styles.scriptGrid}>{visibleScripts.map((script) => {
        const cast = script.participants.map((entry) => characters.find((character) => character.id === entry.characterId)).filter((item): item is PremiumCharacter => Boolean(item));
        const blockCount = script.tiktoks.reduce((total, section) => total + section.reactionBlocks.length, 0);
        return <article className={styles.scriptCard} key={script.id}>
          <div className={styles.cardAccent} />
          <div className={styles.cardTop}><span>{script.tiktoks.length} TIKTOK{script.tiktoks.length === 1 ? "" : "S"}</span><div className={styles.cardMenu}><button title="Duplicar" onClick={() => duplicate(script.id)}>⧉</button><button title="Exportar" onClick={() => exportJson(`${script.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "roteiro"}.json`, { app: "GACHA_PREMIUM_ROTEIROS_V1", version: 1, exportedAt: nowIso(), script })}>↓</button><button title="Excluir roteiro e pastas" onClick={() => void deleteScript(script)}>×</button></div></div>
          <h2>{script.title}</h2><p>{script.generalContext || "Contexto geral ainda não escrito."}</p>
          <div className={styles.castRow}>{cast.slice(0, 5).map((character) => <CharacterMark key={character.id} character={character} />)}{cast.length > 5 && <span className={styles.moreCast}>+{cast.length - 5}</span>}<small>{cast.length} personagens · {blockCount} blocos</small></div>
          <div className={styles.cardFooter}><time>{new Date(script.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time><a href={`/roteiros/${script.id}`}>Abrir roteiro →</a></div>
        </article>;
      })}</div>}

      {orphanPreview && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !orphanBusy) setOrphanPreview(null); }}><section className={styles.modal}><div className={styles.modalHeader}><div><span className={styles.eyebrow}>AUDITORIA LOCAL</span><h2>Pastas órfãs</h2></div><button disabled={orphanBusy} onClick={() => setOrphanPreview(null)}>×</button></div><p>Pastas sem roteiro correspondente. Elas não são removidas automaticamente.</p><div className={styles.importIssues}><p><strong>Vídeos internos:</strong> {orphanPreview.internal.videos.length}</p><p><strong>Fundos internos:</strong> {orphanPreview.internal.backgrounds.length}</p><p><strong>Exportações rastreadas:</strong> {orphanPreview.exports.length}</p></div><div className={styles.modalFooter}><button className={styles.secondaryButton} disabled={orphanBusy} onClick={() => setOrphanPreview(null)}>Fechar</button><button className={styles.dangerButton} disabled={orphanBusy || !(orphanPreview.internal.videos.length + orphanPreview.internal.backgrounds.length + orphanPreview.exports.length)} onClick={() => void cleanupOrphans()}>{orphanBusy ? "Limpando…" : "Limpar órfãs"}</button></div></section></div>}

      {creating && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><section className={styles.modal}>
        <div className={styles.modalHeader}><div><span className={styles.eyebrow}>NOVO PROJETO</span><h2>Criar roteiro</h2></div><button onClick={() => setCreating(false)}>×</button></div>
        <label className={styles.field}><span>Nome do roteiro</span><input autoFocus value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Ex: Reagindo ao passado da FYN" /></label>
        <div className={styles.modalCastHeader}><strong>Personagens participantes</strong><input value={characterQuery} onChange={(event) => setCharacterQuery(event.target.value)} placeholder="Pesquisar…" /></div>
        <div className={styles.characterPicker}>{characters.filter((character) => character.name.toLocaleLowerCase("pt-BR").includes(characterQuery.toLocaleLowerCase("pt-BR"))).map((character) => {
          const selected = selectedIds.includes(character.id); const completion = profileCompletion(state.profiles.find((profile) => profile.characterId === character.id));
          return <button className={selected ? styles.selected : ""} key={character.id} onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== character.id) : [...current, character.id])}><CharacterMark character={character} /><span><strong>{character.name}</strong><small>Ficha {completion === 0 ? "vazia" : `${completion}%`}</small></span><i>{selected ? "✓" : "+"}</i></button>;
        })}{characters.length === 0 && <p>Salve personagens no Criador do Premium primeiro.</p>}</div>
        <div className={styles.modalFooter}><span>{selectedIds.length} selecionado(s)</span><button className={styles.secondaryButton} onClick={() => setCreating(false)}>Cancelar</button><button className={styles.primaryButton} disabled={!title.trim()} onClick={create}>Criar e abrir</button></div>
      </section></div>}
    </main>
  );
}

function ProfileEditor({ character, characters, state, updateState }: { character: PremiumCharacter; characters: PremiumCharacter[]; state: RoteirosState; updateState: (recipe: (state: RoteirosState) => RoteirosState) => void }) {
  const profile = state.profiles.find((item) => item.characterId === character.id) ?? createNarrativeProfile(character.id);
  const patchProfile = (patch: Partial<NarrativeProfile>) => updateState((current) => {
    const exists = current.profiles.some((item) => item.characterId === character.id);
    const next = { ...profile, ...patch, updatedAt: nowIso() };
    return { ...current, profiles: exists ? current.profiles.map((item) => item.characterId === character.id ? next : item) : [...current.profiles, next] };
  });
  const addRelationship = () => {
    const target = characters.find((item) => item.id !== character.id && !profile.relationships.some((relationship) => relationship.targetCharacterId === item.id));
    if (target) patchProfile({ relationships: [...profile.relationships, { id: createId(), targetCharacterId: target.id, description: "" }] });
  };
  return <section className={styles.profileEditor}>
    <div className={styles.profileHero}><CharacterMark character={character} large /><div><span className={styles.eyebrow}>{character.model}</span><h2>{character.name}</h2><p>Modelo global usado ao criar um roteiro ou ao sincronizar manualmente a ficha local dele.</p></div><div className={styles.completion}><strong>{profileCompletion(profile)}%</strong><span>preenchido</span></div></div>
    <div className={styles.singleFieldStack}>
      <label><span>Personalidade</span><small>Como pensa, reage, se defende, provoca, demonstra ou esconde emoções.</small><textarea rows={7} maxLength={12000} value={profile.personality} onChange={(event) => patchProfile({ personality: event.target.value })} placeholder="Escreva aqui tudo sobre a personalidade do personagem…" /></label>
      <label><span>História</span><small>Passado, traumas, segredos, posição social e o que ele sabe ou desconhece.</small><textarea rows={7} maxLength={12000} value={profile.backstory} onChange={(event) => patchProfile({ backstory: event.target.value })} placeholder="Escreva a história completa do personagem…" /></label>
      <label><span>Relação com FYN</span><small>Sentimentos, confiança, conflitos, conhecimentos e comportamento quando ela é mencionada.</small><textarea rows={6} maxLength={10000} value={profile.fynRelationship} onChange={(event) => patchProfile({ fynRelationship: event.target.value })} placeholder="Descreva tudo sobre a relação deste personagem com FYN…" /></label>
      <label><span>Estilo de fala</span><small>Tom, tamanho das frases, vocabulário, formalidade e coisas que nunca diria.</small><textarea rows={5} maxLength={8000} value={profile.speakingStyle} onChange={(event) => patchProfile({ speakingStyle: event.target.value })} placeholder="Explique como esse personagem fala…" /></label>
      <label><span>Regras particulares</span><small>Qualquer regra adicional que a IA sempre deve respeitar para este personagem.</small><textarea rows={5} maxLength={10000} value={profile.additionalRules} onChange={(event) => patchProfile({ additionalRules: event.target.value })} placeholder="Ex: nunca admite ciúme; não sabe que FYN esteve no palácio…" /></label>
    </div>
    <div className={styles.relationshipSection}><div><span className={styles.eyebrow}>RELAÇÕES DIRECIONAIS</span><h3>Relação com outros personagens</h3><p>Descreva em um único campo como {character.name} enxerga e trata cada pessoa.</p></div><button className={styles.secondaryButton} disabled={characters.length <= 1 || profile.relationships.length >= characters.length - 1} onClick={addRelationship}>＋ Adicionar relação</button></div>
    <div className={styles.relationshipList}>{profile.relationships.map((relationship) => <article key={relationship.id}><select value={relationship.targetCharacterId} onChange={(event) => patchProfile({ relationships: profile.relationships.map((item) => item.id === relationship.id ? { ...item, targetCharacterId: event.target.value } : item) })}>{characters.filter((item) => item.id !== character.id && (!profile.relationships.some((entry) => entry.id !== relationship.id && entry.targetCharacterId === item.id))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><textarea rows={4} value={relationship.description} maxLength={6000} onChange={(event) => patchProfile({ relationships: profile.relationships.map((item) => item.id === relationship.id ? { ...item, description: event.target.value } : item) })} placeholder={`Como ${character.name} vê e age perto desta pessoa?`} /><button title="Excluir relação" onClick={() => patchProfile({ relationships: profile.relationships.filter((item) => item.id !== relationship.id) })}>×</button></article>)}{profile.relationships.length === 0 && <p className={styles.subtleEmpty}>Nenhuma relação cadastrada.</p>}</div>
  </section>;
}

function ProfilesPage({ state, characters, updateState }: { state: RoteirosState; characters: PremiumCharacter[]; updateState: (recipe: (state: RoteirosState) => RoteirosState) => void }) {
  const [selectedId, setSelectedId] = useState(characters[0]?.id || "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "empty" | "complete">("all");
  const visible = characters.filter((character) => {
    const completion = profileCompletion(state.profiles.find((item) => item.characterId === character.id));
    return character.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")) && (filter === "all" || filter === "empty" && completion < 100 || filter === "complete" && completion === 100);
  });
  const selected = visible.find((item) => item.id === selectedId) || visible[0];
  return <main className={styles.profileLayout}>
    <aside className={styles.profileSidebar}><div><span className={styles.eyebrow}>FICHAS NARRATIVAS</span><h1>Personagens</h1><p>As fichas alimentam a IA, sem alterar a aparência no Criador.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="⌕ Pesquisar personagem…" /><div className={styles.filterChips}><button className={filter === "all" ? styles.active : ""} onClick={() => setFilter("all")}>Todos</button><button className={filter === "empty" ? styles.active : ""} onClick={() => setFilter("empty")}>Incompletos</button><button className={filter === "complete" ? styles.active : ""} onClick={() => setFilter("complete")}>Completos</button></div><div className={styles.profileCharacterList}>{visible.map((character) => { const completion = profileCompletion(state.profiles.find((item) => item.characterId === character.id)); return <button className={selected?.id === character.id ? styles.selected : ""} key={character.id} onClick={() => setSelectedId(character.id)}><CharacterMark character={character} /><span><strong>{character.name}</strong><small>{completion === 0 ? "Ficha vazia" : `${completion}% preenchido`}</small></span><i style={{ "--progress": `${completion}%` } as React.CSSProperties} /></button>; })}</div></aside>
    <div className={styles.profileMain}>{selected ? <ProfileEditor character={selected} characters={characters} state={state} updateState={updateState} /> : <div className={styles.emptyState}><span>♙</span><h2>Nenhum personagem encontrado</h2><p>Salve um personagem no Criador do Premium para preencher sua ficha narrativa.</p><Link className={styles.primaryButton} href="/">Abrir Criador</Link></div>}</div>
  </main>;
}

type RoteiroBackup = { fileName: string; createdAt: string; bytes: number };

function BackupManager({ pcAvailable, onReload }: { pcAvailable: boolean; onReload: () => Promise<void> }) {
  const [backups, setBackups] = useState<RoteiroBackup[]>([]);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    if (!pcAvailable) return;
    try {
      const result = await listRoteiroBackups();
      setBackups(result.backups); setFolder(result.folder); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível listar os backups."); }
  }, [pcAvailable]);
  useEffect(() => {
    if (!pcAvailable) return;
    let active = true;
    listRoteiroBackups().then((result) => {
      if (!active) return;
      setBackups(result.backups); setFolder(result.folder); setMessage("");
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Não foi possível listar os backups."); });
    return () => { active = false; };
  }, [pcAvailable]);
  const create = async () => {
    setBusy(true); setMessage("");
    try { await createRoteiroBackup(); await refresh(); setMessage("Backup manual criado no PC."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível criar o backup."); }
    finally { setBusy(false); }
  };
  const restore = async (backup: RoteiroBackup) => {
    if (!window.confirm(`Restaurar “${backup.fileName}”? O estado atual será preservado em um backup de segurança.`)) return;
    setBusy(true); setMessage("");
    try { await restoreRoteiroBackup(backup.fileName); await onReload(); await refresh(); setMessage("Backup restaurado. O Roteiros foi recarregado."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível restaurar o backup."); }
    finally { setBusy(false); }
  };
  return <section className={styles.backupCard}>
    <div className={styles.sectionTitle}><span>◫</span><div><h2>Backups e recuperação</h2><p>O estado principal fica no PC. Use esta lista para criar um ponto de restauração ou voltar a uma versão anterior.</p></div></div>
    {!pcAvailable ? <p className={styles.aiStatus}>O serviço local não está conectado; backups do PC ficarão disponíveis quando o servidor for iniciado.</p> : <>
      <div className={styles.backupToolbar}><button className={styles.primaryButton} disabled={busy} onClick={() => void create()}>＋ Criar backup agora</button><button className={styles.secondaryButton} disabled={busy} onClick={() => void refresh()}>Atualizar lista</button></div>
      {folder && <p className={styles.backupFolder}>Pasta: <code>{folder}</code></p>}
      <div className={styles.backupList}>{backups.map((backup) => <article key={backup.fileName}><div><strong>{backup.fileName}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(backup.createdAt))} · {Math.max(1, Math.round(backup.bytes / 1024))} KB</small></div><button className={styles.secondaryButton} disabled={busy} onClick={() => void restore(backup)}>Restaurar</button></article>)}{backups.length === 0 && <p className={styles.subtleEmpty}>Nenhum backup automático ou manual foi criado ainda.</p>}</div>
    </>}
    {message && <p className={styles.aiStatus}>{message}</p>}
  </section>;
}

function SettingsPage({ state, updateState, pcAvailable, onReload }: { state: RoteirosState; updateState: (recipe: (state: RoteirosState) => RoteirosState) => void; pcAvailable: boolean; onReload: () => Promise<void> }) {
  const [models, setModels] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState("");
  const [sentPrompt, setSentPrompt] = useState<SentPromptPreview | null>(null);
  const [promptMessage, setPromptMessage] = useState("");
  const [openAiUsage, setOpenAiUsage] = useState<{ configured: boolean; model?: string; usage?: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; errors: number; lastModel?: string | null; lastOperation?: string | null; lastDurationMs?: number | null; lastError?: string | null } } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const refresh = () => setSentPrompt(readSentPromptPreview());
    refresh();
    window.addEventListener("nymi-roteiros-prompt-updated", refresh);
    return () => window.removeEventListener("nymi-roteiros-prompt-updated", refresh);
  }, []);
  const patchSettings = (patch: Partial<RoteirosState["settings"]>) => updateState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  const selectOllama = () => patchSettings({ aiProvider: "ollama", aiBaseUrl: "http://127.0.0.1:11434", aiModel: state.settings.aiModel.trim() || "gemma4:e4b" });
  const selectOpenAi = () => patchSettings({ aiProvider: "openai", openAiModel: state.settings.openAiModel || "gpt-5.6-luna" });
  const loadModels = async () => { setLoading(true); setAiStatus(""); try { const result = await aiRequest<{ models: string[] }>("models", { settings: state.settings }); setModels(result.models); setAiStatus(`${result.models.length} modelo(s) encontrado(s).`); } catch (error) { setAiStatus(error instanceof Error ? error.message : "Não foi possível listar modelos."); } finally { setLoading(false); } };
  const refreshOpenAiStatus = useCallback(async () => { try { const result = await aiRequest<{ configured: boolean; usage?: typeof openAiUsage extends null ? never : NonNullable<typeof openAiUsage>["usage"] }>("status", { settings: state.settings }); setOpenAiUsage(result); } catch { setOpenAiUsage(null); } }, [state.settings]);
  const test = async () => { setLoading(true); setAiStatus(""); try { const result = await aiRequest<{ model: string; provider: string; response: string }>("test", { settings: state.settings }); setAiStatus(`✓ Conexão funcionando · modelo usado: ${result.model} · resposta: ${result.response || "OK"}`); if (state.settings.aiProvider === "openai") await refreshOpenAiStatus(); } catch (error) { setAiStatus(error instanceof Error ? error.message : "Falha na conexão."); } finally { setLoading(false); } };
  const updateRule = (id: string, patch: Partial<GlobalRule>) => updateState((current) => ({ ...current, globalRules: current.globalRules.map((rule) => rule.id === id ? { ...rule, ...patch, updatedAt: nowIso() } : rule) }));
  return <main className={styles.settingsPage}>
    <section className={styles.heroRow}><div><span className={styles.eyebrow}>COMPORTAMENTO DO ASSISTENTE</span><h1>IA e regras</h1><p>Configure a IA local e os modelos globais usados como base para novos roteiros.</p></div></section>
    <div className={styles.settingsGrid}><section className={styles.settingsCard}><div className={styles.sectionTitle}><span>◉</span><div><h2>IA local</h2><p>Ollama e LM Studio continuam independentes da OpenAI.</p></div></div><div className={styles.providerButtons}>{(["none", "lmstudio", "ollama"] as const).map((provider) => <button className={state.settings.aiProvider === provider ? styles.active : ""} key={provider} onClick={() => provider === "ollama" ? selectOllama() : patchSettings({ aiProvider: provider, aiBaseUrl: "http://127.0.0.1:1234/v1" })}>{provider === "none" ? "Desativada" : provider === "lmstudio" ? "LM Studio" : "Ollama"}</button>)}<button className={state.settings.aiProvider === "openai" ? styles.active : ""} onClick={selectOpenAi}>ChatGPT API</button></div>{state.settings.aiProvider !== "none" && state.settings.aiProvider !== "openai" && <><label className={styles.field}><span>Endereço local</span><input value={state.settings.aiBaseUrl} onChange={(event) => patchSettings({ aiBaseUrl: event.target.value })} /></label><label className={styles.field}><span>Modelo selecionado</span><input list="roteiros-models" value={state.settings.aiModel} onChange={(event) => patchSettings({ aiModel: event.target.value })} placeholder="Selecione ou digite o modelo" /><datalist id="roteiros-models"><option value="gemma4:e4b" />{models.map((model) => <option key={model} value={model} />)}</datalist></label><div className={styles.inlineActions}><button className={`${styles.secondaryButton} ${state.settings.aiModel === "gemma4:e4b" ? styles.active : ""}`} onClick={() => patchSettings({ aiProvider: "ollama", aiBaseUrl: "http://127.0.0.1:11434", aiModel: "gemma4:e4b" })}>Gemma 4 E4B</button><button className={styles.secondaryButton} disabled={loading} onClick={() => void loadModels()}>Atualizar modelos</button><button className={styles.primaryButton} disabled={loading || !state.settings.aiModel.trim()} onClick={() => void test()}>Testar modelo selecionado</button></div><p className={styles.aiStatus}>Selecionado agora: <strong>{state.settings.aiModel || "nenhum"}</strong></p>{aiStatus && <p className={styles.aiStatus}>{aiStatus}</p>}</>}</section><section className={styles.settingsCard}><div className={styles.sectionTitle}><span>✦</span><div><h2>ChatGPT API</h2><p>A chave fica somente no servidor local através de OPENAI_API_KEY.</p></div></div>{state.settings.aiProvider === "openai" && <><label className={styles.field}><span>Modelo OpenAI</span><input value={state.settings.openAiModel} onChange={(event) => patchSettings({ openAiModel: event.target.value })} placeholder="gpt-5.6-luna" /></label><label className={styles.field}><span>Raciocínio</span><select value={state.settings.openAiReasoningEffort} onChange={(event) => patchSettings({ openAiReasoningEffort: event.target.value as "low" | "medium" | "high" })}><option value="low">Baixo — mais rápido</option><option value="medium">Médio — recomendado</option><option value="high">Alto — mais elaborado</option></select></label><label className={styles.field}><span>Máximo de tokens de saída</span><input type="number" min={256} max={8000} value={state.settings.openAiMaxOutputTokens} onChange={(event) => patchSettings({ openAiMaxOutputTokens: Math.min(8000, Math.max(256, Number(event.target.value) || 2400)) })} /></label><div className={styles.inlineActions}><button className={styles.primaryButton} disabled={loading} onClick={() => void test()}>Testar conexão OpenAI</button><button className={styles.secondaryButton} disabled={loading} onClick={() => void loadModels()}>Atualizar modelos</button></div><label className={styles.field}><span>Modo de geração</span><select value={state.settings.generationMode} onChange={(event) => patchSettings({ generationMode: event.target.value as "faithful" | "creative" })}><option value="faithful">Fiel — prioriza contexto e personalidade</option><option value="creative">Criativo — varia mais a dinâmica</option></select></label><p className={styles.aiStatus}>A chave não é salva no roteiro nem enviada ao navegador.</p>{openAiUsage && <p className={styles.aiStatus}>{openAiUsage.configured ? "Chave configurada no servidor" : "Chave ausente no servidor"}{openAiUsage.usage ? ` · ${openAiUsage.usage.totalTokens} tokens · ${openAiUsage.usage.calls} chamadas · ${openAiUsage.usage.errors} erros` : ""}</p>}{aiStatus && <p className={styles.aiStatus}>{aiStatus}</p>}</>}</section>
      <section className={styles.settingsCard}><div className={styles.sectionTitle}><span>⌁</span><div><h2>Preferências de geração</h2><p>Valores padrão que podem ser ajustados em cada TikTok.</p></div></div><label className={styles.rangeField}><span>Criatividade <strong>{state.settings.temperature.toFixed(2)}</strong></span><input type="range" min="0" max="1.5" step="0.05" value={state.settings.temperature} onChange={(event) => patchSettings({ temperature: Number(event.target.value) })} /></label><label className={styles.field}><span>Blocos novos por TikTok</span><input type="number" min="1" max="24" value={state.settings.defaultBlockCount} onChange={(event) => patchSettings({ defaultBlockCount: Math.min(24, Math.max(1, Number(event.target.value))) })} /></label><label className={styles.field}><span>TikToks anteriores usados como contexto</span><input type="number" min="1" max="10" value={state.settings.historyLimit} onChange={(event) => patchSettings({ historyLimit: Math.min(10, Math.max(1, Number(event.target.value))) })} /></label><label className={styles.checkField}><input type="checkbox" checked={state.settings.shortLinesByDefault} onChange={(event) => patchSettings({ shortLinesByDefault: event.target.checked })} /><span>Usar falas curtas por padrão</span></label></section>
    </div>
    <section className={styles.settingsCard}><div className={styles.sectionTitle}><span>✎</span><div><h2>Prompt editável do “Preencher vazios”</h2><p>Escreva o prompt principal desta operação. O aplicativo acrescenta apenas os dados atuais do roteiro e exige o JSON válido que o app consegue importar.</p></div></div><label className={styles.field}><span>Prompt principal editável</span><textarea rows={12} maxLength={12000} value={state.settings.fillEmptyPrompt} onChange={(event) => patchSettings({ fillEmptyPrompt: event.target.value })} placeholder="Escreva aqui todas as instruções que deseja testar…" /></label><p className={styles.aiStatus}>Este prompt afeta somente “Preencher vazios”. Se ficar vazio, o comportamento padrão continua ativo. Não é necessário escrever regras de JSON: o schema obrigatório é aplicado pelo aplicativo.</p></section>
    <section className={styles.settingsCard}><div className={styles.sectionTitle}><span>⌕</span><div><h2>Prompt completo enviado</h2><p>Mostra exatamente o último prompt usado por “Preencher vazios”, já com o contexto do roteiro. A chave da API nunca entra aqui.</p></div></div>{sentPrompt ? <><p className={styles.aiStatus}>Provedor: <strong>{sentPrompt.provider}</strong>{sentPrompt.model ? ` · modelo: ${sentPrompt.model}` : ""}{sentPrompt.attempts && sentPrompt.attempts > 1 ? ` · tentativa aceita: ${sentPrompt.attempts}` : ""} · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(sentPrompt.sentAt))}</p><div className={styles.inlineActions}><button className={styles.secondaryButton} onClick={() => void navigator.clipboard.writeText(formatSentPrompt(sentPrompt)).then(() => setPromptMessage("Prompt completo copiado."))}>Copiar prompt completo</button><button className={styles.secondaryButton} onClick={() => setSentPrompt(readSentPromptPreview())}>Atualizar</button></div><pre className={styles.promptPreview}>{formatSentPrompt(sentPrompt)}</pre></> : <p className={styles.aiStatus}>Ainda não há um envio registrado. Abra um roteiro, clique em “Preencher vazios” e volte aqui para inspecionar o prompt real.</p>}{promptMessage && <p className={styles.aiStatus}>{promptMessage}</p>}</section>
    <details className={styles.promptPreview}><summary>Ver o que continua automático e protegido</summary><pre>{"AUTOMÁTICO:\n- Personagens e fichas do roteiro atual\n- Contexto geral, histórico conforme limite e descrição do TikTok atual\n- Objetivo, linha do tempo, regras específicas, blocos existentes e blocos-alvo\n\nEDITÁVEL:\n- Todo o texto do prompt principal acima, somente no Preencher vazios\n\nPROTEGIDO:\n- O aplicativo exige JSON válido no schema de reactions\n- Cada reação precisa de characterId válido, type speech/thought, emotion e text\n- A quantidade precisa corresponder aos blocos-alvo\n\nTRANSPORTE:\n- IA local: system + user, com schema JSON\n- ChatGPT API: instructions + input, com Structured Outputs JSON Schema"}</pre></details>
    <BackupManager pcAvailable={pcAvailable} onReload={onReload} />
    <section className={styles.rulesSection}><div className={styles.rulesHeader}><div><span className={styles.eyebrow}>MODELOS GLOBAIS</span><h2>Regras-base para novos roteiros</h2><p>Alterações aqui não mudam roteiros existentes. Edite o contexto isolado dentro de cada roteiro.</p></div><button className={styles.primaryButton} onClick={() => updateState((current) => ({ ...current, globalRules: [...current.globalRules, createGlobalRule()] }))}>＋ Adicionar regra</button></div><details className={styles.protectedRules}><summary>Ver {PROTECTED_RULES.length} regras estruturais protegidas</summary><ol>{PROTECTED_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ol></details><div className={styles.rulesList}>{state.globalRules.map((rule) => <article key={rule.id} className={!rule.enabled ? styles.disabledRule : ""}><input className={styles.ruleTitle} value={rule.title} maxLength={100} onChange={(event) => updateRule(rule.id, { title: event.target.value })} /><select value={rule.priority} onChange={(event) => updateRule(rule.id, { priority: event.target.value as GlobalRule["priority"] })}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select><label className={styles.ruleToggle}><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /> Ativa</label><textarea rows={4} value={rule.description} maxLength={10000} onChange={(event) => updateRule(rule.id, { description: event.target.value })} placeholder="Escreva a regra completa…" /><button className={styles.deleteButton} onClick={() => { if (window.confirm(`Excluir a regra “${rule.title}”?`)) updateState((current) => ({ ...current, globalRules: current.globalRules.filter((item) => item.id !== rule.id) })); }}>Excluir</button></article>)}{state.globalRules.length === 0 && <div className={styles.subtleEmpty}>Nenhuma regra personalizada. As regras estruturais protegidas continuam ativas.</div>}</div></section>
  </main>;
}

export default function RoteirosHome() {
  const { ready, state, characters, pcAvailable, saveStatus, recoveryCandidate, restoreRecovery, dismissRecovery, updateState, saveSnapshot, saveNow, reload } = useRoteirosData();
  const [tab, setTab] = useState<HomeTab>("scripts");
  if (!ready || !state) return <div className={styles.loadingPage}><span>✦</span><strong>Abrindo Roteiros…</strong></div>;
  return <div className={styles.roteirosShell}><Header tab={tab} setTab={setTab} saveStatus={saveStatus} pcAvailable={pcAvailable} saveNow={() => void saveNow()} /><RecoveryBanner candidate={recoveryCandidate} onRestore={restoreRecovery} onDismiss={dismissRecovery} />{tab === "scripts" && <ScriptList state={state} characters={characters} updateState={updateState} saveSnapshot={saveSnapshot} />}{tab === "profiles" && <ProfilesPage state={state} characters={characters} updateState={updateState} />}{tab === "settings" && <SettingsPage state={state} updateState={updateState} pcAvailable={pcAvailable} onReload={reload} />}</div>;
}
