import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMt5Report } from "../src/lib/import/mt5.ts";
import { filterTrades, insights, monthSummary, NO_FILTERS, totals } from "../src/lib/engine/insights.ts";
import type { Cell } from "../src/lib/types.ts";

const { trades } = parseMt5Report(JSON.parse(readFileSync(new URL("./fixtures/mt5-funded-next.json", import.meta.url), "utf8")) as Cell[][]);

test("filters narrow the list and totals add up", () => {
  assert.equal(filterTrades(trades, NO_FILTERS).length, 83);
  const longs = filterTrades(trades, { ...NO_FILTERS, side: "buy" });
  assert.equal(longs.length, 50);
  assert.equal(totals(longs).wins, 7);
  const wins = filterTrades(trades, { ...NO_FILTERS, result: "win" });
  assert.ok(wins.every((t) => t.net > 0));
  const win = filterTrades(trades, { ...NO_FILTERS, from: "2026-10-05", to: "2026-10-05" });
  assert.equal(win.length, 9);
  assert.equal(filterTrades(trades, { ...NO_FILTERS, q: "xauusd" }).length, 83);
  assert.equal(filterTrades(trades, { ...NO_FILTERS, q: "nope" }).length, 0);
});

test("month summary matches the trades in that month", () => {
  const m = monthSummary(trades, "2026-10");
  const inM = trades.filter((t) => t.closeTime.startsWith("2026-10"));
  assert.equal(m.greenDays + m.redDays <= m.tradingDays, true);
  assert.equal(Math.round(m.byWeekday.reduce((s, b) => s + b.net, 0) * 100) / 100, totals(inM).net);
  assert.equal(m.worst?.date, "2026-10-05");
});

test("insights are plain facts from real numbers, and quiet with little data", () => {
  const list = insights(trades);
  assert.ok(list.length >= 1 && list.length <= 5);
  assert.ok(list.some((i) => /Longs lost/.test(i.text) === false ? /Shorts made/.test(i.text) : true));
  assert.equal(insights(trades.slice(0, 5))[0].tone, "info");
});
