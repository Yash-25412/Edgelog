import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksLikeM1, parseMt5Bars, symbolFromFilename, type Bar } from "../src/lib/import/bars.ts";
import { chartWindow } from "../src/lib/engine/chartwindow.ts";
import { chartToRow, packCandles, rowToChart, unpackCandles } from "../src/lib/charts.ts";

const { bars: m1 } = parseMt5Bars(readFileSync(new URL("./fixtures/xauusd-m1-2026-09-25.csv", import.meta.url), "utf8"));
const trade = { openTime: "2026-09-25T14:10:13", closeTime: "2026-09-25T16:18:32" };

test("symbol and timeframe come from the MT5 export file name", () => {
  assert.deepEqual(symbolFromFilename("XAUUSD_M1_202609150100_202610151113.csv"), { symbol: "XAUUSD", timeframe: "M1" });
  assert.deepEqual(symbolFromFilename("b2263499-XAUUSD_M1_202609150100_202610151113.csv"), { symbol: "XAUUSD", timeframe: "M1" });
  assert.deepEqual(symbolFromFilename("EURUSD.r_M5_202601010000_202601311200.csv"), { symbol: "EURUSD.r", timeframe: "M5" });
  assert.equal(symbolFromFilename("my bars.csv"), null);
});

test("one-minute data is recognised, other timeframes are not", () => {
  assert.equal(looksLikeM1(m1), true);
  const every5 = m1.filter((_, i) => i % 5 === 0);
  assert.equal(looksLikeM1(every5), false);
  assert.equal(looksLikeM1([]), false);
});

test("candles survive packing and the database row round trip", () => {
  assert.deepEqual(unpackCandles(packCandles(m1)), m1);
  const w = chartWindow(trade, m1)!;
  const row = JSON.parse(JSON.stringify(chartToRow(w, "trade-id", "user-id"))); // as the database would return it
  assert.equal(row.trade_id, "trade-id");
  assert.equal(row.candles.length, 100);
  assert.deepEqual(rowToChart(row), w);
});

test("the window does not change when the file holds months of other data", () => {
  const shift = (b: Bar, day: string): Bar => ({ ...b, time: day + b.time.slice(10) });
  const before = m1.map((b) => shift(b, "2026-09-10"));
  const after = m1.map((b) => shift(b, "2026-10-12"));
  const big = [...before, ...m1, ...after];
  assert.deepEqual(chartWindow(trade, big), chartWindow(trade, m1));
});

test("a Monday-morning trade reaches back across the weekend to fill 100 candles", () => {
  const friday = m1.map((b) => ({ ...b, time: "2026-09-25" + b.time.slice(10) })); // Fri 01:00-23:59
  const monday = m1.slice(0, 600).map((b) => ({ ...b, time: "2026-09-28" + b.time.slice(10) })); // Mon 01:00-10:59
  const w = chartWindow({ openTime: "2026-09-28T01:30:00", closeTime: "2026-09-28T02:30:00" }, [...friday, ...monday])!;
  assert.equal(w.candles.length, 100);
  assert.equal(w.truncated, false);
  assert.ok(w.candles[0].time.startsWith("2026-09-25"), "run-up starts on Friday");
  assert.ok(w.entryIndex > 70);
});
