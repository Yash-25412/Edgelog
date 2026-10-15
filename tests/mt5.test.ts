import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMt5Report, num, toStamp } from "../src/lib/import/mt5.ts";
import { summarize, drawdown, balanceSeries, equityCurve } from "../src/lib/engine/stats.ts";
import type { Cell } from "../src/lib/types.ts";

// Real FundedNext MT5 export (account name anonymised). The numbers asserted
// below come from MetaTrader's own "Results" block at the bottom of that file.
const rows: Cell[][] = JSON.parse(readFileSync(new URL("./fixtures/mt5-funded-next.json", import.meta.url), "utf8"));
const report = parseMt5Report(rows);
const stats = summarize(report.trades);
const byId = (id: string) => report.trades.find((t) => t.externalId === id)!;

test("parses without warnings and reconciles to the deal ledger", () => {
  assert.deepEqual(report.warnings, []);
  assert.equal(report.platform, "mt5");
  assert.equal(report.accountName, "Test Trader");
  assert.equal(report.trades.length, 83);
  assert.equal(new Set(report.trades.map((t) => t.externalId)).size, 83, "ids are unique (needed for idempotent re-import)");
});

test("balances match the report", () => {
  assert.equal(report.startingBalance, 5049.3);
  assert.equal(report.endingBalance, 5156.86);
  assert.equal(stats.net, 107.56); // MT5: Total Net Profit
  assert.equal(stats.commission, -12.08);
  assert.equal(stats.swap, -11.65);
  assert.equal(equityCurve(report.startingBalance!, report.trades).at(-1)!.balance, 5156.86);
});

test("drawdown matches MT5 (balance based)", () => {
  const dd = drawdown(balanceSeries(report.startingBalance!, report.ledger));
  assert.equal(dd.absolute, 80.39);
  assert.equal(dd.maximal.amount, 160.85);
  assert.equal(dd.maximal.percent, 3.14);
  assert.equal(dd.relative.percent, 3.14);
});

test("streaks and extremes match MT5", () => {
  assert.equal(stats.maxConsecutiveLosses, 13);
  assert.equal(stats.maxConsecutiveWins, 3);
  assert.equal(stats.long.count, 50);
  assert.equal(stats.short.count, 33);
});

test("trade-level stats are internally consistent", () => {
  assert.equal(stats.wins + stats.losses + stats.breakeven, stats.trades);
  assert.equal(Math.round((stats.grossProfit + stats.grossLoss) * 100) / 100, stats.net);
  assert.equal(Math.round((stats.long.net + stats.short.net) * 100) / 100, stats.net);
  assert.equal(stats.profitFactor, Math.round((stats.grossProfit / -stats.grossLoss) * 10000) / 10000);
});

test("a partial close is reassembled from its two exit deals", () => {
  const t = byId("201351306");
  assert.equal(t.exits.length, 2);
  assert.deepEqual(t.exits.map((e) => e.volume), [0.01, 0.01]);
  assert.equal(t.exits.reduce((s, e) => s + e.price * e.volume, 0) / t.volume, t.closePrice);
  // exactly one position in the whole file was closed in pieces
  assert.equal(report.trades.filter((t) => t.exits.length > 1).length, 1);
});

test("two positions closed by the same tick each keep their own fill", () => {
  for (const id of ["201482603", "201498792"]) {
    const t = byId(id);
    assert.equal(t.exits.length, 1);
    assert.equal(t.exits[0].volume, 0.01);
    assert.equal(t.closeTime, "2026-09-25T16:18:32");
  }
});

test("exit reasons come from deal comments", () => {
  assert.equal(byId("199399232").exitReason, "sl");
  const counts: Record<string, number> = {};
  report.trades.forEach((t) => (counts[t.exitReason!] = (counts[t.exitReason!] ?? 0) + 1));
  assert.deepEqual(counts, { sl: 63, tp: 12, manual: 8 });
});

test("R-multiple uses the stop set when the order was placed", () => {
  assert.equal(report.contractSizes.XAUUSD, 100);
  const t = byId("199399232"); // buy 0.02 @ 4327.29, initial SL 4319.09, net -16.60
  assert.equal(t.initialSl, 4319.09);
  assert.equal(t.riskMoney, 16.4);
  assert.equal(t.rMultiple, -1.01);
});

test("trades whose stop was added after entry have no R (not a guess)", () => {
  const noR = report.trades.filter((t) => t.rMultiple === null);
  assert.equal(noR.length, 38);
  assert.equal(stats.rTrades, 45);
  assert.ok(noR.every((t) => t.initialSl === null || t.riskMoney === null));
});

test("timestamps are normalised, times are not shifted", () => {
  assert.equal(report.trades[0].openTime, "2026-09-14T09:42:03");
  assert.equal(report.trades[0].closeTime, "2026-09-14T10:02:02");
  assert.equal(toStamp("2026.10.15 12:01"), "2026-10-15T12:01:00");
  assert.equal(toStamp("not a date"), null);
});

test("number parsing handles platform locale quirks", () => {
  assert.equal(num("0.02"), 0.02);
  assert.equal(num("1 234.50"), 1234.5);
  assert.equal(num("1,234.50"), 1234.5);
  assert.equal(num("12,5"), 12.5);
  assert.equal(num(""), null);
  assert.equal(num(null), null);
});

test("rejects files that are not MT5 trade history", () => {
  assert.throws(() => parseMt5Report([["a", "b"], [1, 2]]), /Not an MT5 trade history report/);
  const noDeals = rows.slice(0, 271); // cut before the Deals section
  assert.throws(() => parseMt5Report(noDeals), /no "Deals" section/);
  const cutAtDealsMarker = rows.slice(0, 272); // "Deals" title present, header row missing
  assert.throws(() => parseMt5Report(cutAtDealsMarker), /truncated/);
});

test("a reconciliation break is reported, not hidden", () => {
  const tampered: Cell[][] = JSON.parse(JSON.stringify(rows));
  tampered[7][12] = 999; // change the first position's profit
  const r = parseMt5Report(tampered);
  assert.ok(r.warnings.some((w) => w.includes("does not match deals net")));
});

test("importing the same report twice yields identical ids (idempotent)", () => {
  const again = parseMt5Report(rows);
  assert.deepEqual(again.trades.map((t) => t.externalId), report.trades.map((t) => t.externalId));
});
