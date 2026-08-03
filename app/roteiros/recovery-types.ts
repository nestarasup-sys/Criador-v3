import type { RoteirosState } from "./types";

export type RecoveryJournalEntry = {
  version: 1;
  id: string;
  savedAt: string;
  reason: "pending" | "pc-saved";
  state: RoteirosState;
};
