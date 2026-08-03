"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadPremiumCharacters, loadRoteirosState, mirrorRoteirosState, saveRoteirosState } from "./storage";
import type { PremiumCharacter, RoteirosState, SaveStatus } from "./types";

export function useRoteirosData() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<RoteirosState | null>(null);
  const [characters, setCharacters] = useState<PremiumCharacter[]>([]);
  const [pcAvailable, setPcAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const latestRef = useRef<RoteirosState | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadRoteirosState(), loadPremiumCharacters().catch(() => [])]).then(([loaded, loadedCharacters]) => {
      if (!active) return;
      latestRef.current = loaded.state;
      setState(loaded.state);
      setCharacters(loadedCharacters);
      setPcAvailable(loaded.pcAvailable);
      setSaveStatus(loaded.pcAvailable ? "saved" : "error");
      loadedRef.current = true;
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!state || !loadedRef.current) return;
    latestRef.current = state;
    mirrorRoteirosState(state);
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveRoteirosState(state)
        .then(() => { setPcAvailable(true); setSaveStatus("saved"); })
        .catch(() => { setPcAvailable(false); setSaveStatus("error"); });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && latestRef.current) void saveRoteirosState(latestRef.current).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  const updateState = useCallback((recipe: (current: RoteirosState) => RoteirosState) => {
    setState((current) => current ? recipe(current) : current);
  }, []);

  const saveNow = useCallback(async () => {
    if (!latestRef.current) return;
    setSaveStatus("saving");
    try {
      await saveRoteirosState(latestRef.current);
      setPcAvailable(true);
      setSaveStatus("saved");
    } catch {
      setPcAvailable(false);
      setSaveStatus("error");
    }
  }, []);

  return { ready, state, characters, pcAvailable, saveStatus, updateState, saveNow };
}
