import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar } from "./import/bars.ts";
import { groupByDay, mergeBars, packDay, unpackDay, type DayRow } from "./engine/series.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Saves 1-minute candles one row per broker day. The first and last day of a file are usually
 * partial, so those are merged with whatever was saved before instead of replacing it.
 */
export async function saveCandleDays(
  sb: SupabaseClient, userId: string, symbol: string, bars: Bar[], onProgress?: (done: number, total: number) => void,
): Promise<{ days: number; bars: number }> {
  const byDay = groupByDay(bars);
  const days = [...byDay.keys()].sort();
  if (!days.length) return { days: 0, bars: 0 };

  const edges = [...new Set([days[0], days[days.length - 1]])];
  const { data: existing, error: e0 } = await sb.from("candles").select("day, bars").eq("user_id", userId).eq("symbol", symbol).in("day", edges);
  if (e0) throw new Error(/candles/.test(e0.message) ? "The candles table does not exist yet. Run 0004_candles_setups.sql in Supabase first." : e0.message);
  for (const row of existing ?? []) {
    const d = (row as any).day as string;
    byDay.set(d, mergeBars(unpackDay(d, (row as any).bars as DayRow[]), byDay.get(d) ?? []));
  }

  const rows = days.map((d) => ({ user_id: userId, symbol, day: d, bars: packDay(byDay.get(d)!), updated_at: new Date().toISOString() }));
  let done = 0;
  for (let i = 0; i < rows.length; i += 4) {
    const { error } = await sb.from("candles").upsert(rows.slice(i, i + 4), { onConflict: "user_id,symbol,day" });
    if (error) throw new Error(error.message);
    done = Math.min(i + 4, rows.length);
    onProgress?.(done, rows.length);
  }
  return { days: rows.length, bars: bars.length };
}
