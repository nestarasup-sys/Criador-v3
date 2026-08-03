"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendRecoveryJournal, discardPendingRecovery, loadPremiumCharacters, loadRoteirosState, markRecoverySaved, saveRoteirosState } from "./storage";
import type { RecoveryJournalEntry } from "./recovery-types";
import type { PremiumCharacter, RoteirosState, SaveStatus } from "./types";

export function useRoteirosData() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<RoteirosState | null>(null);
  const [characters, setCharacters] = useState<PremiumCharacter[]>([]);
  const [pcAvailable, setPcAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [recoveryCandidate, setRecoveryCandidate] = useState<RecoveryJournalEntry | null>(null);
  const latestRef = useRef<RoteirosState | null>(null);
  const loadedRef = useRef(false);

  const reload = useCallback(async () => {
    const [loaded, loadedCharacters] = await Promise.all([loadRoteirosState(), loadPremiumCharacters().catch(() => [])]);
    latestRef.current = loaded.state;
    setState(loaded.state);
    setCharacters(loadedCharacters);
    setPcAvailable(loaded.pcAvailable);
    setRecoveryCandidate(loaded.recoveryCandidate ?? null);
    setSaveStatus(loaded.pcAvailable ? "saved" : "error");
    loadedRef.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadRoteirosState(), loadPremiumCharacters().catch(() => [])]).then(([loaded, loadedCharacters]) => {
      if (!active) return;
      latestRef.current = loaded.state;
      setState(loaded.state);
      setCharacters(loadedCharacters);
      setPcAvailable(loaded.pcAvailable);
      setRecoveryCandidate(loaded.recoveryCandidate ?? null);
      setSaveStatus(loaded.pcAvailable ? "saved" : "error");
      loadedRef.current = true;
      setReady(true);
    }).catch(() => { if (active) { setReady(true); setSaveStatus("error"); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!state || !loadedRef.current) return;
    latestRef.current = state;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      appendRecoveryJournal(state, "pending");
      saveRoteirosState(state)
        .then(() => { markRecoverySaved(state); setPcAvailable(true); setSaveStatus("saved"); })
        .catch(() => { setPcAvailable(false); setSaveStatus("error"); });
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
    } catch {
      setPcAvailable(false);
      setSaveStatus("error");
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

  return { ready, state, characters, pcAvailable, saveStatus, recoveryCandidate, restoreRecovery, dismissRecovery, updateState, saveSnapshot, saveNow, reload };
}
