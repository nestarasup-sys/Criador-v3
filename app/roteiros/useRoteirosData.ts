"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendRecoveryJournal, discardPendingRecovery, loadPremiumCharacters, loadRoteirosState, markRecoverySaved, saveRoteirosState } from "./storage";
import type { RecoveryJournalEntry } from "./recovery-types";
import type { PremiumCharacter, RoteirosState, SaveStatus } from "./types";

export function useRoteirosData() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<RoteirosState | null>(null);
  const [characters, setCharacters] = useState<PremiumCharacter[]>([]);
  const [characterLoadError, setCharacterLoadError] = useState<string | null>(null);
  const [pcAvailable, setPcAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [recoveryCandidate, setRecoveryCandidate] = useState<RecoveryJournalEntry | null>(null);
  const latestRef = useRef<RoteirosState | null>(null);
  const loadedRef = useRef(false);

  const loadPageData = useCallback(async () => {
    const loaded = await loadRoteirosState();
    let loadedCharacters: PremiumCharacter[] = [];
    let loadedCharactersError: string | null = null;
    try {
      loadedCharacters = await loadPremiumCharacters();
    } catch (error) {
      loadedCharactersError = error instanceof Error ? error.message : "Não foi possível carregar os personagens do Criador.";
    }
    return { loaded, loadedCharacters, loadedCharactersError };
  }, []);

  const applyLoadedPageData = useCallback(({ loaded, loadedCharacters, loadedCharactersError }: Awaited<ReturnType<typeof loadPageData>>) => {
    latestRef.current = loaded.state;
    setState(loaded.state);
    setCharacters(loadedCharacters);
    setCharacterLoadError(loadedCharactersError);
    setPcAvailable(loaded.pcAvailable);
    setRecoveryCandidate(loaded.recoveryCandidate ?? null);
    setSaveStatus(loaded.pcAvailable ? "saved" : "error");
    loadedRef.current = true;
    setReady(true);
  }, []);

  const reload = useCallback(async () => {
    applyLoadedPageData(await loadPageData());
  }, [applyLoadedPageData, loadPageData]);

  useEffect(() => {
    let active = true;
    loadPageData().then((pageData) => {
      if (active) applyLoadedPageData(pageData);
    }).catch(() => { if (active) { setReady(true); setSaveStatus("error"); } });
    return () => { active = false; };
  }, [applyLoadedPageData, loadPageData]);

  useEffect(() => {
    if (!state || !loadedRef.current) return;
    latestRef.current = state;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      appendRecoveryJournal(state, "pending");
      saveRoteirosState(state)
        .then(() => { markRecoverySaved(state); setPcAvailable(true); setSaveStatus("saved"); })
        .catch((error) => {
          setPcAvailable(false);
          setSaveStatus((error as { checkpointSaved?: boolean })?.checkpointSaved === false ? "unsafe" : "error");
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && latestRef.current) {
        const snapshot = latestRef.current;
        appendRecoveryJournal(snapshot, "pending");
        void saveRoteirosState(snapshot).then(() => markRecoverySaved(snapshot)).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  const updateState = useCallback((recipe: (current: RoteirosState) => RoteirosState) => {
    setState((current) => current ? recipe(current) : current);
  }, []);

  const saveSnapshot = useCallback(async (snapshot: RoteirosState) => {
    setSaveStatus("saving");
    try {
      latestRef.current = snapshot;
      appendRecoveryJournal(snapshot, "pending");
      await saveRoteirosState(snapshot);
      markRecoverySaved(snapshot);
      setPcAvailable(true);
      setSaveStatus("saved");
      return true;
    } catch (error) {
      setPcAvailable(false);
      setSaveStatus((error as { checkpointSaved?: boolean })?.checkpointSaved === false ? "unsafe" : "error");
      return false;
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (!latestRef.current) return false;
    return saveSnapshot(latestRef.current);
  }, [saveSnapshot]);

  const restoreRecovery = useCallback(() => {
    if (!recoveryCandidate) return;
    setState(structuredClone(recoveryCandidate.state));
    setRecoveryCandidate(null);
  }, [recoveryCandidate]);

  const dismissRecovery = useCallback(() => {
    discardPendingRecovery();
    setRecoveryCandidate(null);
  }, []);

  return { ready, state, characters, characterLoadError, pcAvailable, saveStatus, recoveryCandidate, restoreRecovery, dismissRecovery, updateState, saveSnapshot, saveNow, reload };
}
