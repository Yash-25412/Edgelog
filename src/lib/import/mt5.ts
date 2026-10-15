import type {
  Cell,
  ExitReason,
  Fill,
  LedgerKind,
  LedgerRow,
  Mt5Report,
  Side,
  Stamp,
  Trade,
} from "../types.ts";

/**
 * Parser for the MetaTrader 5 "Trade History Report" (the xlsx/html export from
 * File > Save As Report). Works on already-read rows so it has no file-format
 * dependency: the caller turns the workbook into Cell[][] (see readXlsxRows).
 *
 * Source of truth for trades is the "Positions" table (already round trips).
 * The "Deals" table is used to recover partial closes, exit reasons and the
 * balance ledger. The "Orders" table gives the stop loss set at order placement.
 */

const STAMP_RE = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

export function toStamp(v: Cell | undefined): Stamp | null {
  if (typeof v !== "string") return null;
  const m = STAMP_RE.exec(v.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
}

export function num(v: Cell | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s ]/g, "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function text(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

const norm = (s: Cell | undefined) => String(s ?? "").toLowerCase().replace(/\s+/g, "");

type Cols = Record<string, number[]>;

function readHeader(row: Cell[] | undefined): Cols {
  if (!row) throw new Error("MT5 report is truncated: a section has no header row.");
  const cols: Cols = {};
  row.forEach((cell, i) => {
    const k = norm(cell);
    if (k) (cols[k] ??= []).push(i);
  });
  return cols;
}

function need(cols: Cols, name: string, nth: number, section: string): number {
  const idx = cols[name]?.[nth];
  if (idx === undefined) {
    throw new Error(`MT5 report: "${section}" table has no "${name}" column (occurrence ${nth + 1}).`);
  }
  return idx;
}

function findSection(rows: Cell[][], name: string): number {
  return rows.findIndex((r) => norm(r[0]) === name.toLowerCase());
}

/** Rows after the header of a section, while column 0 is a timestamp. */
function sectionRows(rows: Cell[][], start: number): Cell[][] {
  const out: Cell[][] = [];
  for (let i = start + 2; i < rows.length; i++) {
    if (toStamp(rows[i][0]) === null) break;
    out.push(rows[i]);
  }
  return out;
}

function decimals(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function exitReasonFrom(comment: string | null): ExitReason {
  if (!comment) return "manual";
  const c = comment.toLowerCase();
  if (c.startsWith("[sl")) return "sl";
  if (c.startsWith("[tp")) return "tp";
  if (c.startsWith("so:")) return "stop_out";
  return "manual";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function parseMt5Report(rows: Cell[][]): Mt5Report {
  const warnings: string[] = [];

  const posAt = findSection(rows, "positions");
  const dealsAt = findSection(rows, "deals");
  if (posAt === -1) throw new Error('Not an MT5 trade history report: no "Positions" section found.');
  if (dealsAt === -1) throw new Error('MT5 report has no "Deals" section. Export the full "Trade History Report".');
  const ordersAt = findSection(rows, "orders");

  // ---- meta -------------------------------------------------------------
  const meta = (label: string, col: number) => {
    const r = rows.slice(0, posAt).find((x) => norm(x[0]) === label);
    return r ? text(r[col]) : null;
  };
  const accountName = meta("name:", 3);
  const company = meta("company:", 3);
  const generatedAt = toStamp(meta("date:", 3));

  // ---- ledger (deals) ---------------------------------------------------
  const dc = readHeader(rows[dealsAt + 1]);
  const D = {
    time: need(dc, "time", 0, "Deals"),
    deal: need(dc, "deal", 0, "Deals"),
    symbol: need(dc, "symbol", 0, "Deals"),
    type: need(dc, "type", 0, "Deals"),
    dir: need(dc, "direction", 0, "Deals"),
    volume: need(dc, "volume", 0, "Deals"),
    price: need(dc, "price", 0, "Deals"),
    commission: need(dc, "commission", 0, "Deals"),
    fee: dc["fee"]?.[0],
    swap: need(dc, "swap", 0, "Deals"),
    profit: need(dc, "profit", 0, "Deals"),
    balance: need(dc, "balance", 0, "Deals"),
    comment: dc["comment"]?.[0],
  };

  const ledger: LedgerRow[] = sectionRows(rows, dealsAt).map((r) => {
    const type = norm(r[D.type]);
    const dir = norm(r[D.dir]);
    const side: Side | null = type === "buy" || type === "sell" ? type : null;
    let kind: LedgerKind;
    const profit = num(r[D.profit]) ?? 0;
    if (side) {
      kind = dir === "in" ? "entry" : dir === "out" ? "exit" : "other";
      if (kind === "other") warnings.push(`Deal ${r[D.deal]} has direction "${r[D.dir]}"; reversals are not supported yet.`);
    } else if (type === "balance") kind = profit >= 0 ? "deposit" : "withdrawal";
    else if (type === "credit") kind = "credit";
    else kind = "other";
    return {
      time: toStamp(r[D.time])!,
      dealId: String(r[D.deal]),
      kind,
      symbol: text(r[D.symbol]),
      side,
      volume: num(r[D.volume]) ?? 0,
      price: num(r[D.price]) ?? 0,
      commission: num(r[D.commission]) ?? 0,
      fee: D.fee === undefined ? 0 : num(r[D.fee]) ?? 0,
      swap: num(r[D.swap]) ?? 0,
      profit,
      balance: num(r[D.balance]) ?? NaN,
      comment: D.comment === undefined ? null : text(r[D.comment]),
    };
  });

  const first = ledger[0];
  const last = ledger[ledger.length - 1];
  const startingBalance = first ? r2(first.balance - (first.commission + first.fee + first.swap + first.profit)) : null;
  const endingBalance = last ? last.balance : null;

  // ---- initial stops from the orders table ------------------------------
  const initialStops = new Map<string, { sl: number | null; tp: number | null }>();
  if (ordersAt !== -1) {
    const oc = readHeader(rows[ordersAt + 1]);
    const oOrder = need(oc, "order", 0, "Orders");
    const oSl = need(oc, "s/l", 0, "Orders");
    const oTp = need(oc, "t/p", 0, "Orders");
    for (const r of sectionRows(rows, ordersAt)) {
      initialStops.set(String(r[oOrder]), { sl: num(r[oSl]), tp: num(r[oTp]) });
    }
  } else {
    warnings.push('No "Orders" section: initial stop loss unknown, R-multiples unavailable.');
  }

  // ---- positions --------------------------------------------------------
  const pc = readHeader(rows[posAt + 1]);
  const P = {
    openTime: need(pc, "time", 0, "Positions"),
    id: need(pc, "position", 0, "Positions"),
    symbol: need(pc, "symbol", 0, "Positions"),
    type: need(pc, "type", 0, "Positions"),
    volume: need(pc, "volume", 0, "Positions"),
    openPrice: need(pc, "price", 0, "Positions"),
    sl: need(pc, "s/l", 0, "Positions"),
    tp: need(pc, "t/p", 0, "Positions"),
    closeTime: need(pc, "time", 1, "Positions"),
    closePrice: need(pc, "price", 1, "Positions"),
    commission: need(pc, "commission", 0, "Positions"),
    swap: need(pc, "swap", 0, "Positions"),
    profit: need(pc, "profit", 0, "Positions"),
  };

  const positionRows = sectionRows(rows, posAt);
  const exitDeals = ledger.filter((l) => l.kind === "exit");
  const used = new Set<LedgerRow>();

  type Draft = Omit<Trade, "initialSl" | "initialTp" | "exits" | "exitReason" | "riskMoney" | "rMultiple">;
  const drafts: Draft[] = positionRows.map((r) => {
    const type = norm(r[P.type]);
    if (type !== "buy" && type !== "sell") throw new Error(`Position ${r[P.id]}: unknown type "${r[P.type]}".`);
    const commission = num(r[P.commission]) ?? 0;
    const swap = num(r[P.swap]) ?? 0;
    const profit = num(r[P.profit]) ?? 0;
    return {
      externalId: String(r[P.id]),
      symbol: String(r[P.symbol]),
      side: type,
      volume: num(r[P.volume])!,
      openTime: toStamp(r[P.openTime])!,
      openPrice: num(r[P.openPrice])!,
      sl: num(r[P.sl]),
      tp: num(r[P.tp]),
      closeTime: toStamp(r[P.closeTime])!,
      closePrice: num(r[P.closePrice])!,
      commission,
      swap,
      profit,
      net: r2(profit + commission + swap),
    };
  });

  // Match each position to its exit fills. Processing in close order keeps shared-timestamp closes stable.
  const byClose = [...drafts].sort((a, b) => (a.closeTime < b.closeTime ? -1 : a.closeTime > b.closeTime ? 1 : 0));
  const exitsById = new Map<string, Fill[]>();
  const EPS = 1e-9;
  for (const t of byClose) {
    const opposite: Side = t.side === "buy" ? "sell" : "buy";
    const pool = exitDeals.filter(
      (d) => !used.has(d) && d.symbol === t.symbol && d.side === opposite && d.time >= t.openTime && d.time <= t.closeTime,
    );
    const picked: LedgerRow[] = [];
    let filled = 0;
    // 1) fills exactly at the reported close
    for (const d of pool) {
      if (d.time === t.closeTime && Math.abs(d.price - t.closePrice) < EPS && filled + d.volume <= t.volume + EPS) {
        picked.push(d);
        filled += d.volume;
      }
    }
    // 2) earlier partial closes, latest first
    for (const d of [...pool].sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))) {
      if (filled >= t.volume - EPS) break;
      if (picked.includes(d)) continue;
      if (filled + d.volume <= t.volume + EPS) {
        picked.push(d);
        filled += d.volume;
      }
    }
    const avg = picked.length ? picked.reduce((s, d) => s + d.price * d.volume, 0) / filled : NaN;
    const tol = 0.5 * Math.pow(10, -decimals(t.closePrice)) + EPS;
    if (picked.length && Math.abs(filled - t.volume) < EPS && Math.abs(avg - t.closePrice) <= tol) {
      picked.forEach((d) => used.add(d));
      picked.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      exitsById.set(
        t.externalId,
        picked.map((d) => ({ time: d.time, price: d.price, volume: d.volume, comment: d.comment })),
      );
    } else {
      warnings.push(`Position ${t.externalId}: could not match exit deals to the reported close; using the position row only.`);
      exitsById.set(t.externalId, [{ time: t.closeTime, price: t.closePrice, volume: t.volume, comment: null }]);
    }
  }
  const stray = exitDeals.filter((d) => !used.has(d));
  if (stray.length && !warnings.some((w) => w.includes("could not match"))) {
    warnings.push(`${stray.length} exit deal(s) were not attached to any position.`);
  }

  // ---- contract size per symbol (money per 1.0 price move per lot) -------
  const samples = new Map<string, number[]>();
  for (const t of drafts) {
    const move = (t.closePrice - t.openPrice) * (t.side === "buy" ? 1 : -1);
    if (Math.abs(move) < 1e-9 || t.profit === 0) continue;
    const cs = t.profit / (move * t.volume);
    if (cs > 0) (samples.get(t.symbol) ?? samples.set(t.symbol, []).get(t.symbol)!).push(cs);
  }
  const contractSizes: Record<string, number> = {};
  for (const [sym, xs] of samples) contractSizes[sym] = Math.round(median(xs) * 10000) / 10000;

  // ---- finish trades ----------------------------------------------------
  const trades: Trade[] = drafts.map((t) => {
    const stops = initialStops.get(t.externalId) ?? { sl: null, tp: null };
    const exits = exitsById.get(t.externalId)!;
    const lastExit = exits[exits.length - 1];
    const stopDistance = stops.sl === null ? null : t.side === "buy" ? t.openPrice - stops.sl : stops.sl - t.openPrice;
    const cs = contractSizes[t.symbol];
    const riskMoney =
      stopDistance !== null && stopDistance > 0 && cs ? r2(stopDistance * t.volume * cs) : null;
    return {
      ...t,
      initialSl: stops.sl,
      initialTp: stops.tp,
      exits,
      exitReason: exitReasonFrom(lastExit.comment),
      riskMoney,
      rMultiple: riskMoney ? Math.round((t.net / riskMoney) * 100) / 100 : null,
    };
  });
  trades.sort((a, b) => (a.openTime < b.openTime ? -1 : a.openTime > b.openTime ? 1 : 0));

  // ---- reconciliation ---------------------------------------------------
  const tradeNet = trades.reduce((s, t) => s + t.net, 0);
  const ledgerNet = ledger
    .filter((l) => l.kind === "entry" || l.kind === "exit")
    .reduce((s, l) => s + l.commission + l.fee + l.swap + l.profit, 0);
  if (Math.abs(tradeNet - ledgerNet) > 0.005) {
    warnings.push(`Positions net ${r2(tradeNet)} does not match deals net ${r2(ledgerNet)}.`);
  }
  const summaryBalance = rows.map((r) => (norm(r[0]) === "balance:" ? num(r[1]) : null)).find((x) => x !== null);
  if (summaryBalance !== undefined && endingBalance !== null && Math.abs(summaryBalance! - endingBalance) > 0.005) {
    warnings.push(`Report balance ${summaryBalance} does not match last deal balance ${endingBalance}.`);
  }

  return {
    platform: "mt5",
    accountName,
    company,
    generatedAt,
    trades,
    ledger,
    startingBalance,
    endingBalance,
    contractSizes,
    warnings,
  };
}
