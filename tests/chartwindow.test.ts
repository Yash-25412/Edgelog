import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMt5Bars } from "../src/lib/import/bars.ts";
import { aggregate, alignment, BARS_AFTER, bucketStart, chartWindow, chooseTimeframe } from "../src/lib/engine/chartwindow.ts";

// All of 25 Sep 2026 from a real MT5 "Export Bars" file (XAUUSD, M1, broker time).
const { bars: m1, skipped } = parseMt5Bars(readFileSync(new URL("./fixtures/xauusd-m1-2026-09-25.csv", import.meta.url), "utf8"));

// Real trade from the FundedNext report: short 0.01 lots, position 201482603.
const trade = { openTime: "2026-09-25T14:10:13", closeTime: "2026-09-25T16:18:32", openPrice: 4314.99, closePrice: 4292.78 };

test("parses the MT5 bars export as written by MetaTrader", () => {
  assert.equal(skipped, 0);
  assert.equal(m1.length, 1380);
  assert.deepEqual(m1[0], { time: "2026-09-25T01:00:00", open: 4267.78, high: m1[0].high, low: m1[0].low, close: m1[0].close, tickVolume: m1[0].tickVolume });
  assert.ok(m1.every((b) => b.low <= b.open && b.open <= b.high && b.low <= b.close && b.close <= b.high));
  assert.ok(m1.every((b, i) => i === 0 || b.time > m1[i - 1].time), "oldest first, no duplicates");
});

test("bad rows are counted, wrong files are rejected, comma files work", () => {
  const csv = "<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<TICKVOL>\n2026.09.25,01:00:00,1,3,1,2,10\n2026.09.25,01:01:00,x,3,1,2,10\n";
  const r = parseMt5Bars(csv);
  assert.equal(r.bars.length, 1);
  assert.equal(r.skipped, 1);
  assert.throws(() => parseMt5Bars("a,b,c\n1,2,3"), /does not look like an MT5 bars export/);
  assert.throws(() => parseMt5Bars(""), /empty/);
});

test("timeframe rule: smallest timeframe where the trade spans at most 40 bars", () => {
  assert.equal(chooseTimeframe("2026-09-25T10:00:00", "2026-09-25T10:00:40"), 1);
  assert.equal(chooseTimeframe("2026-09-25T10:00:00", "2026-09-25T10:39:00"), 1); // 40 bars
  assert.equal(chooseTimeframe("2026-09-25T10:00:00", "2026-09-25T10:40:00"), 5); // 41 bars at 1m
  assert.equal(chooseTimeframe(trade.openTime, trade.closeTime), 5); // 2h08m
  assert.equal(chooseTimeframe("2026-09-15T03:05:31", "2026-09-15T10:51:32"), 15); // 7h46m
  assert.equal(chooseTimeframe("2026-09-17T18:59:20", "2026-09-18T08:07:56"), 30); // overnight
  assert.equal(chooseTimeframe("2026-09-01T00:00:00", "2026-12-01T00:00:00"), 1440); // very long: daily
});

test("candles start on clock boundaries", () => {
  assert.equal(bucketStart("2026-09-25T14:10:13", 5), "2026-09-25T14:10:00");
  assert.equal(bucketStart("2026-09-25T16:18:32", 5), "2026-09-25T16:15:00");
  assert.equal(bucketStart("2026-09-25T18:59:59", 60), "2026-09-25T18:00:00");
  assert.equal(bucketStart("2026-09-25T18:59:59", 240), "2026-09-25T16:00:00");
});

test("5-minute candles are exact roll-ups of the 1-minute bars", () => {
  const c5 = aggregate(m1, 5);
  for (const c of c5) {
    const parts = m1.filter((b) => bucketStart(b.time, 5) === c.time);
    assert.equal(c.open, parts[0].open);
    assert.equal(c.close, parts.at(-1)!.close);
    assert.equal(c.high, Math.max(...parts.map((b) => b.high)));
    assert.equal(c.low, Math.min(...parts.map((b) => b.low)));
    assert.equal(c.tickVolume, parts.reduce((s, b) => s + b.tickVolume, 0));
  }
  assert.equal(c5.reduce((s, c) => s + c.tickVolume, 0), m1.reduce((s, b) => s + b.tickVolume, 0));
  assert.equal(m1.length === 1380 && c5.length, 276); // 23h of 5-minute candles
});

test("the 25 Sep trade gets 100 five-minute candles: long run-up, 8 candles after the exit", () => {
  const w = chartWindow(trade, m1)!;
  assert.equal(w.tfMinutes, 5);
  assert.equal(w.candles.length, 100);
  assert.equal(w.truncated, false);
  assert.equal(w.candles[w.entryIndex].time, "2026-09-25T14:10:00");
  assert.equal(w.candles[w.exitIndex].time, "2026-09-25T16:15:00");
  assert.equal(w.exitIndex - w.entryIndex, 25); // 26 candles contain the trade
  assert.equal(w.candles.length - 1 - w.exitIndex, BARS_AFTER); // 8 candles after the exit candle
  assert.equal(w.entryIndex, 66); // 66 candles of run-up
  assert.equal(w.candles[0].time, "2026-09-25T08:40:00");
  assert.equal(w.candles.at(-1)!.time, "2026-09-25T16:55:00");
  assert.ok(BARS_AFTER >= 5 && BARS_AFTER <= 10);
});

test("after-exit candles never exceed the limit, and the window is shorter rather than padded when data is short", () => {
  // trade early in the data: only 4 candles exist before entry, so the chart is short, not stretched forward
  const early = chartWindow({ openTime: "2026-09-25T01:20:00", closeTime: "2026-09-25T03:20:00" }, m1)!;
  assert.equal(early.candles[0].time, "2026-09-25T01:00:00");
  assert.equal(early.entryIndex, 4);
  assert.equal(early.candles.length - 1 - early.exitIndex, BARS_AFTER);
  assert.equal(early.candles.length, 4 + 25 + BARS_AFTER); // run-up + trade candles + after
  assert.equal(early.truncated, true);
  // trade right at the end of the data: fewer than 8 candles after, still 100 candles in total
  const late = chartWindow({ openTime: "2026-09-25T22:00:00", closeTime: "2026-09-25T23:50:00" }, m1)!;
  assert.equal(late.candles.length, 100);
  assert.equal(late.candles.at(-1)!.time, "2026-09-25T23:55:00");
  assert.ok(late.candles.length - 1 - late.exitIndex < BARS_AFTER);
});

test("no data for the trade means no chart, not a wrong chart", () => {
  assert.equal(chartWindow({ openTime: "2026-09-26T10:00:00", closeTime: "2026-09-26T10:30:00" }, m1), null);
  assert.equal(chartWindow(trade, []), null);
});

test("price data that stops before the exit (or starts after the entry) gives no chart", () => {
  const endsEarly = m1.filter((b) => b.time < "2026-09-25T16:00:00");
  assert.equal(chartWindow(trade, endsEarly), null);
  const startsLate = m1.filter((b) => b.time >= "2026-09-25T14:30:00");
  assert.equal(chartWindow(trade, startsLate), null);
});

test("entry and exit prices sit inside the real candles, and a shifted clock is caught", () => {
  assert.deepEqual(alignment(trade, m1), { entryFits: true, exitFits: true });
  const shifted = { ...trade, openTime: "2026-09-25T17:10:13", closeTime: "2026-09-25T19:18:32" }; // clock off by 3h
  const a = alignment(shifted, m1);
  assert.ok(!(a.entryFits && a.exitFits));
});
