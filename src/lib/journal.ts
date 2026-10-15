/* eslint-disable @typescript-eslint/no-explicit-any */

export const BUCKET = "trade-screenshots";

export interface Journal {
  tradeId: string;
  setup: string | null;
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
    tags: r.tags ?? [],
    mistakes: r.mistakes ?? [],
    emotion: r.emotion ?? null,
    notes: r.notes ?? null,
    screenshots: r.screenshots ?? [],
  };
}
