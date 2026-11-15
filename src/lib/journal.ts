/* eslint-disable @typescript-eslint/no-explicit-any */

export const BUCKET = "trade-screenshots";

export interface Journal {
  tradeId: string;
  /** Legacy single free-text setup (before the setups list). */
  setup: string | null;
  setupIds: string[];
  tags: string[];
  mistakes: string[];
  emotion: number | null;
  notes: string | null;
  screenshots: string[];
}

export const MISTAKES = [
  "Moved stop",
  "No stop",
  "Revenge trade",
  "Oversized",
  "Chased entry",
  "Entered early",
  "Exited early",
  "Held a loser",
  "Overtrading",
  "Broke plan",
];

export const EMOTIONS = ["Calm", "Fine", "Uneasy", "Frustrated", "Tilted"];

export function rowToJournal(r: any): Journal {
  return {
    tradeId: r.trade_id,
    setup: r.setup ?? null,
    setupIds: r.setup_ids ?? [],
    tags: r.tags ?? [],
    mistakes: r.mistakes ?? [],
    emotion: r.emotion ?? null,
    notes: r.notes ?? null,
    screenshots: r.screenshots ?? [],
  };
}
