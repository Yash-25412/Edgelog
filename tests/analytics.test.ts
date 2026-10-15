import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMt5Report } from "../src/lib/import/mt5.ts";
import {
  bucketBy, byExitReason, byHour, byStopDiscipline, byWeekday, confidence, dailyPnL, weekdayOf, NO_STOP, STOP_SET,
} from "../src/lib/engine/analytics.ts";
import type { Cell } from "../src/lib/types.ts";

const rows: Cell[][] = JSON.parse(readFileSync(new URL("./fixtures/mt5-funded-next.json", import.meta.url), "utf8"));
const { trades } = parseMt5Report(rows);
const total = Math.round(trades.reduce((s, t) => s + t.net, 0) * 100) / 100;
const sum = (xs: { net: number }[]) => Math.round(xs.reduce((s, b) => s + b.net, 0) * 100) / 100;
const count = (xs: { n: number }[]) => xs.reduce((s, b) => s + b.n, 0);

test("every single-key view adds up to the same trades and the same P&L", () => {
  assert.equal(total, 107.56);
  for (const view of [byHour(trades), byWeekday(trades), byExitReason(trades), byStopDiscipline(trades)]) {
    assert.equal(count(view), 83);
    assert.equal(sum(view), total);
  }
});

test("daily P&L adds up and matches the first and last trading days", () => {
  const days = dailyPnL(trades);
  assert.equal(sum(days), total);
  assert.equal(days.reduce((s, d) => s + d.trades, 0), 83);
  assert.equal(days[0].date, "2026-09-14");
  assert.equal(days.at(-1)!.date, "2026-10-14");
  assert.equal(new Set(days.map((d) => d.date)).size, days.length);
});

test("weekday maths: 14 Sep 2026 was a Monday, and Sunday sorts last", () => {
  assert.equal(weekdayOf("2026-09-14T09:42:03"), "Mon");
  assert.equal(weekdayOf("2026-09-20T00:00:00"), "Sun");
  assert.equal(weekdayOf("2026-10-15T12:00:00"), "Thu");
  const names = byWeekday(trades).map((b) => b.key);
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  assert.deepEqual(names, [...names].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
});

test("hours are zero-padded broker hours in ascending order", () => {
  const hours = byHour(trades).map((b) => b.key);
  assert.ok(hours.every((h) => /^\d{2}$/.test(h)));
  assert.deepEqual(hours, [...hours].sort());
});

test("stop discipline split matches the earlier finding: 45 with a stop, 38 without", () => {
  const [withStop, noStop] = byStopDiscipline(trades);
  assert.equal(withStop.key, STOP_SET);
  assert.equal(noStop.key, NO_STOP);
  assert.equal(withStop.n, 45);
  assert.equal(noStop.n, 38);
  assert.equal(noStop.avgR, null);
});

test("exit reasons reproduce the parser counts", () => {
  const m = Object.fromEntries(byExitReason(trades).map((b) => [b.key, b.n]));
  assert.deepEqual(m, { "Stop loss": 63, "Take profit": 12, "Manual close": 8 });
});

test("multi-key buckets count a trade once per key, and only once per key", () => {
  const tagged = bucketBy(trades.slice(0, 3), () => ["a", "b", "a"]);
  assert.deepEqual(tagged.map((b) => [b.key, b.n]), [["a", 3], ["b", 3]]);
  assert.deepEqual(bucketBy([], () => ["x"]), []);
});

test("small samples are flagged, not celebrated", () => {
  assert.equal(confidence(9), "very low");
  assert.equal(confidence(10), "low");
  assert.equal(confidence(29), "low");
  assert.equal(confidence(30), "ok");
});

import { withFinalStopR } from "../src/lib/engine/rfallback.ts";
test("trades without a stop-at-entry get R from the final stop when it is on the risk side", () => {
  const adj = withFinalStopR(trades);
  const missing = adj.filter((t) => t.rMultiple === null);
  // only stops moved to/past break-even (and none missing) stay without R
  assert.ok(missing.length <= 3, `still missing ${missing.length}`);
  assert.ok(missing.every((t) => (t.side === "buy" ? t.openPrice - t.sl! <= 0 : t.sl! - t.openPrice <= 0)));
  const t = adj.find((x) => x.externalId === "203251190")!; // sell 4120.52, stop 4130.20, net +61.33
  assert.equal(t.rBasis, "final");
  assert.equal(t.riskMoney, 19.36);
  assert.equal(t.rMultiple, 3.17);
  // originals untouched
  assert.equal(adj.find((x) => x.externalId === "199399232")!.rBasis, "initial");
});
