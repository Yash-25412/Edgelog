"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Calendar } from "@/components/Calendar";
import { EdgeTab } from "@/components/EdgeTab";
import { rowToJournal, type Journal } from "@/lib/journal";
import { looksLikeM1, parseMt5Bars, symbolFromFilename } from "@/lib/import/bars";
import { alignment, chartWindow } from "@/lib/engine/chartwindow";
import { chartToRow } from "@/lib/charts";
import { rowToTrade, tradeToRow } from "@/lib/db";
import { withFinalStopR } from "@/lib/engine/rfallback";
import { buildManualTrade } from "@/lib/manual";
import { summarize, drawdown, equityCurve, type CurvePoint } from "@/lib/engine/stats";
import type { Trade } from "@/lib/types";
import { duration, money, num2, pct, shortStamp } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Account {
  id: string;
  name: string;
  platform: string;
  firm: string | null;
  starting_balance: number | null;
}

interface ImportResult {
  found: number;
  added: number;
  skipped: number;
  warnings: string[];
}

type Tab = "overview" | "calendar" | "edge" | "trades";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "calendar", label: "Calendar" },
  { id: "edge", label: "Edge" },
  { id: "trades", label: "Trades" },
];

function remember(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable; the dashboard works without it */
  }
}
function recall(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const cls = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "pos" : "neg");

function EquityChart({ start, points }: { start: number; points: CurvePoint[] }) {
  const W = 800, H = 220, PADL = 8, PADR = 8, PADT = 12, PADB = 12;
  const values = [start, ...points.map((p) => p.balance)];
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => PADL + (i / Math.max(values.length - 1, 1)) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - (v - lo) / span) * (H - PADT - PADB);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${H - PADB} L${x(0).toFixed(1)},${H - PADB} Z`;
  const end = values[values.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Equity curve">
        <path d={area} className="chart-area" />
        <line x1={PADL} x2={W - PADR} y1={y(start)} y2={y(start)} className="chart-base" />
        <path d={line} className="chart-line" />
      </svg>
      <div className="chart-axis">
        <span>Start {money(start)}</span>
        <span>Low {money(lo)}</span>
        <span>High {money(hi)}</span>
        <span>Now {money(end)}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string>("all");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [journal, setJournal] = useState<Map<string, Journal> | null>(null);
  const candleRef = useRef<HTMLInputElement>(null);
  const [candleSymbol, setCandleSymbol] = useState("");
  const [candleBusy, setCandleBusy] = useState(false);
  const [candleResult, setCandleResult] = useState<{ symbol: string; saved: number; notCovered: number; mismatch: number; skippedRows: number } | null>(null);
  const [chartIds, setChartIds] = useState<Set<string> | null>(null);
  const [chartTick, setChartTick] = useState(0);

  const [showManual, setShowManual] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [mf, setMf] = useState<Record<string, string>>({ account: "new", accName: "", side: "buy", reason: "manual" });
  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setMf((o) => ({ ...o, [k]: e.target.value }));

  const [showImport, setShowImport] = useState(false);
  const [target, setTarget] = useState<string>("new");
  const [newName, setNewName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const loadAccounts = useCallback(async () => {
    const sb = getSupabase();
    const { data: s } = await sb.auth.getSession();
    if (!s.session) {
      router.replace("/login");
      return null;
    }
    setEmail(s.session.user.email ?? "");
    const { data, error } = await sb
      .from("accounts")
      .select("id, name, platform, firm, starting_balance")
      .order("created_at", { ascending: true });
    if (error) {
      setError(error.message);
      return null;
    }
    const list: Account[] = (data ?? []).map((a: any) => ({
      ...a,
      starting_balance: a.starting_balance === null ? null : Number(a.starting_balance),
    }));
    setAccounts(list);
    setReady(true);
    if (!list.length) setShowImport(true);
    return list;
  }, [router]);

  useEffect(() => {
    const savedTab = recall("edgelog.tab");
    if (savedTab && TABS.some((t) => t.id === savedTab)) setTab(savedTab as Tab);
    loadAccounts().then((list) => {
      if (!list) return;
      const saved = recall("edgelog.account");
      if (saved && (saved === "all" || list.some((a) => a.id === saved))) {
        setSelected(saved);
        if (saved !== "all") setTarget(saved);
      } else if (list.length === 1) {
        setSelected(list[0].id);
        setTarget(list[0].id);
      }
    });
  }, [loadAccounts]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const sb = getSupabase();
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        let q = sb
          .from("trades")
          .select("*")
          .order("close_time", { ascending: true })
          .order("external_id", { ascending: true })
          .range(from, from + 999);
        if (selected !== "all") q = q.eq("account_id", selected);
        const { data, error } = await q;
        if (error) {
          if (!cancelled) setError(error.message);
          break;
        }
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      if (!cancelled) {
        setTrades(withFinalStopR(all.map(rowToTrade)));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, selected]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      const map = new Map<string, Journal>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("trade_journal").select("*").range(from, from + 999);
        if (error) {
          if (!cancelled) setJournal(null); // table not created yet
          return;
        }
        (data ?? []).forEach((r: any) => map.set(r.trade_id, rowToJournal(r)));
        if (!data || data.length < 1000) break;
      }
      if (!cancelled) setJournal(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, trades]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      const ids = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("trade_charts").select("trade_id").range(from, from + 999);
        if (error) {
          if (!cancelled) setChartIds(null); // table not created yet
          return;
        }
        (data ?? []).forEach((r: any) => ids.add(r.trade_id));
        if (!data || data.length < 1000) break;
      }
      if (!cancelled) setChartIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, chartTick]);

  const start = useMemo(() => {
    const pick = selected === "all" ? accounts : accounts.filter((a) => a.id === selected);
    return pick.reduce((s, a) => s + (a.starting_balance ?? 0), 0);
  }, [accounts, selected]);

  const summary = useMemo(() => summarize(trades), [trades]);
  const curve = useMemo(() => equityCurve(start, trades), [start, trades]);
  const dd = useMemo(() => drawdown([start, ...curve.map((c) => c.balance)]), [start, curve]);
  const recent = useMemo(() => [...trades].reverse().slice(0, 200), [trades]);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace("/login");
  }

  async function doManual(e: React.FormEvent) {
    e.preventDefault();
    setManualBusy(true);
    setError(null);
    setManualMsg(null);
    try {
      const numOrNull = (v?: string) => (v && v.trim() !== "" ? Number(v) : null);
      const sb = getSupabase();
      const { data: s } = await sb.auth.getSession();
      if (!s.session) throw new Error("Your session has expired. Sign in again.");
      const uid = s.session.user.id;
      const trade = buildManualTrade(
        {
          symbol: mf.symbol ?? "",
          side: mf.side === "sell" ? "sell" : "buy",
          volume: Number(mf.volume),
          openTime: mf.openTime ?? "",
          openPrice: Number(mf.openPrice),
          closeTime: mf.closeTime ?? "",
          closePrice: Number(mf.closePrice),
          profit: Number(mf.profit),
          commission: numOrNull(mf.commission) ?? 0,
          swap: numOrNull(mf.swap) ?? 0,
          sl: numOrNull(mf.sl),
          tp: numOrNull(mf.tp),
          exitReason: (mf.reason as any) || null,
        },
        `manual-${crypto.randomUUID()}`
      );
      let accountId = mf.account;
      if (accountId === "new") {
        const { data, error } = await sb
          .from("accounts")
          .insert({ user_id: uid, name: mf.accName?.trim() || "Manual trades", platform: "manual" })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        accountId = data.id;
      }
      const { error } = await sb.from("trades").insert(tradeToRow(trade, uid, accountId));
      if (error) throw new Error(error.message);
      await loadAccounts();
      setSelected(accountId);
      remember("edgelog.account", accountId);
      setMf((o) => ({ ...o, account: accountId, symbol: "", volume: "", openPrice: "", closePrice: "", profit: "", commission: "", swap: "", sl: "", tp: "" }));
      setManualMsg(`Saved ${trade.symbol} ${trade.side} (${trade.net >= 0 ? "+" : ""}${trade.net.toFixed(2)}). Open it from the Trades tab to journal it.`);
      setTab("trades");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the trade.");
    } finally {
      setManualBusy(false);
    }
  }

  async function doImport(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose the .xlsx report first.");
      return;
    }
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const sb = getSupabase();
      const { data: s } = await sb.auth.getSession();
      if (!s.session) throw new Error("Your session has expired. Sign in again.");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("accountId", target);
      fd.append("accountName", newName);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${s.session.access_token}` },
        body: fd,
      });
      const json = await res.json().catch(() => ({ error: "The server sent an unexpected reply." }));
      if (!res.ok) throw new Error(json.error ?? "Import failed.");
      setImportResult(json as ImportResult);
      await loadAccounts();
      setSelected(json.accountId);
      setTarget(json.accountId);
      if (fileRef.current) fileRef.current.value = "";
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function doCandles(e: React.FormEvent) {
    e.preventDefault();
    const file = candleRef.current?.files?.[0];
    const symbol = candleSymbol.trim();
    if (!file) return setError("Choose the bars file first.");
    if (!symbol) return setError("Type the symbol exactly as it appears in your trades, for example XAUUSD.");
    setCandleBusy(true);
    setError(null);
    setCandleResult(null);
    try {
      const meta = symbolFromFilename(file.name);
      if (meta && meta.timeframe !== "M1") throw new Error(`This file has ${meta.timeframe} bars. Export 1 Minute (M1) bars instead.`);
      const { bars, skipped } = parseMt5Bars(await file.text());
      if (!bars.length) throw new Error("No candles could be read from that file.");
      if (!looksLikeM1(bars)) throw new Error("These do not look like 1-minute bars. In MT5, set the timeframe to 1 Minute before exporting.");
      const sb = getSupabase();
      const { data: s } = await sb.auth.getSession();
      if (!s.session) throw new Error("Your session has expired. Sign in again.");
      const userId = s.session.user.id;

      const mine = trades.filter((t) => t.dbId && t.symbol.toLowerCase() === symbol.toLowerCase());
      if (!mine.length) throw new Error(`No imported trades for ${symbol} in this view. Import your trade report first, and check the symbol spelling.`);

      let notCovered = 0, mismatch = 0;
      const rows: ReturnType<typeof chartToRow>[] = [];
      for (const t of mine) {
        const w = chartWindow(t, bars);
        if (!w) { notCovered++; continue; }
        const a = alignment(t, bars);
        if (!a.entryFits || !a.exitFits) { mismatch++; continue; }
        rows.push(chartToRow(w, t.dbId!, userId));
      }
      for (let i = 0; i < rows.length; i += 20) {
        const { error } = await sb.from("trade_charts").upsert(rows.slice(i, i + 20), { onConflict: "trade_id" });
        if (error) {
          throw new Error(/trade_charts/.test(error.message) ? "The charts table does not exist yet. Run 0003_charts.sql in Supabase first." : error.message);
        }
      }
      setCandleResult({ symbol, saved: rows.length, notCovered, mismatch, skippedRows: skipped });
      setChartTick((n) => n + 1);
      if (candleRef.current) candleRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the charts.");
    } finally {
      setCandleBusy(false);
    }
  }

  if (!ready && !error) return <main className="center muted">Loading…</main>;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">Edge<span>Log</span></div>
        <div className="top-right">
          <select value={selected} onChange={(e) => { setSelected(e.target.value); remember("edgelog.account", e.target.value); }} aria-label="Account">
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button className="primary" onClick={() => setShowManual((v) => !v)}>{showManual ? "Close" : "+ Log a trade"}</button>
          <button onClick={() => setShowImport((v) => !v)}>{showImport ? "Close import" : "Import trades"}</button>
          <span className="muted small hide-sm">{email}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      {showManual && (
        <form className="card import" onSubmit={doManual}>
          <h2>Log a trade by hand</h2>
          <p className="muted small">For trades that are not in an MT5 report. Use the same clock as your platform for the times. Profit is the gross result in money (negative for a loss), before commission and swap.</p>
          <div className="row">
            <label>Account
              <select value={mf.account} onChange={setF("account")}>
                <option value="new">A new manual account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {mf.account === "new" && <label>Account name (optional)<input value={mf.accName ?? ""} onChange={setF("accName")} placeholder="e.g. Personal manual" /></label>}
            <label>Symbol<input required value={mf.symbol ?? ""} onChange={setF("symbol")} placeholder="XAUUSD" /></label>
            <label>Side
              <select value={mf.side} onChange={setF("side")}><option value="buy">Buy / Long</option><option value="sell">Sell / Short</option></select>
            </label>
            <label>Volume (lots)<input required type="number" step="any" min="0" value={mf.volume ?? ""} onChange={setF("volume")} /></label>
          </div>
          <div className="row">
            <label>Entry time<input required type="datetime-local" value={mf.openTime ?? ""} onChange={setF("openTime")} /></label>
            <label>Entry price<input required type="number" step="any" value={mf.openPrice ?? ""} onChange={setF("openPrice")} /></label>
            <label>Exit time<input required type="datetime-local" value={mf.closeTime ?? ""} onChange={setF("closeTime")} /></label>
            <label>Exit price<input required type="number" step="any" value={mf.closePrice ?? ""} onChange={setF("closePrice")} /></label>
          </div>
          <div className="row">
            <label>Profit / loss (money)<input required type="number" step="any" value={mf.profit ?? ""} onChange={setF("profit")} /></label>
            <label>Commission (optional, negative)<input type="number" step="any" value={mf.commission ?? ""} onChange={setF("commission")} /></label>
            <label>Swap (optional)<input type="number" step="any" value={mf.swap ?? ""} onChange={setF("swap")} /></label>
            <label>Stop at entry (optional, gives R)<input type="number" step="any" value={mf.sl ?? ""} onChange={setF("sl")} /></label>
            <label>Target (optional)<input type="number" step="any" value={mf.tp ?? ""} onChange={setF("tp")} /></label>
            <label>How it ended
              <select value={mf.reason} onChange={setF("reason")}><option value="manual">Closed by me</option><option value="sl">Stop hit</option><option value="tp">Target hit</option></select>
            </label>
          </div>
          <button className="primary" disabled={manualBusy}>{manualBusy ? "Saving…" : "Save trade"}</button>
          {manualMsg && <div className="notice">{manualMsg}</div>}
        </form>
      )}

      {showImport && (
        <>
        <form className="card import" onSubmit={doImport}>
          <h2>Import an MT5 report</h2>
          <p className="muted small">
            In MetaTrader 5: open the <b>Toolbox → History</b> tab, right-click, choose <b>Report → Open XML (MS Excel 2007)</b>, or
            save the broker&apos;s <b>ReportHistory-….xlsx</b>. Importing the same report twice is safe: trades already saved are skipped.
          </p>
          <div className="row">
            <label>
              Import into
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">A new account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            {target === "new" && (
              <label>
                Account name (optional)
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. FundedNext 6K Eva" />
              </label>
            )}
            <label>
              MT5 report (.xlsx)
              <input ref={fileRef} type="file" accept=".xlsx" />
            </label>
          </div>
          <button className="primary" disabled={importing}>{importing ? "Importing…" : "Import"}</button>
          {importResult && (
            <div className="notice">
              Found {importResult.found} trades: {importResult.added} added, {importResult.skipped} already saved.
              {importResult.warnings.length > 0 && (
                <ul>{importResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              )}
            </div>
          )}
        </form>

        <form className="card import" onSubmit={doCandles}>
          <h2>Add price candles (optional)</h2>
          <p className="muted small">
            Gives each trade a chart. In MetaTrader 5 press <b>Ctrl+U</b>, open the <b>Bars</b> tab, pick the symbol and <b>1 Minute</b>, set the
            dates, click <b>Request</b>, then <b>Export Bars</b>. Import your trade report first. The file stays in your browser; only the
            roughly 100 candles around each trade are saved.
          </p>
          <div className="row">
            <label>
              Bars file (.csv)
              <input
                ref={candleRef}
                type="file"
                accept=".csv,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  const m = f ? symbolFromFilename(f.name) : null;
                  if (m) setCandleSymbol(m.symbol);
                }}
              />
            </label>
            <label>
              Symbol in your trades
              <input value={candleSymbol} onChange={(e) => setCandleSymbol(e.target.value)} placeholder="e.g. XAUUSD" />
            </label>
          </div>
          <button className="primary" disabled={candleBusy}>{candleBusy ? "Building charts…" : "Build charts"}</button>
          {candleResult && (
            <div className="notice">
              {candleResult.symbol}: {candleResult.saved} charts saved.
              {candleResult.notCovered > 0 && ` ${candleResult.notCovered} trades fall outside the dates in your file.`}
              {candleResult.mismatch > 0 && ` ${candleResult.mismatch} trades were skipped because their prices do not fit these candles (a different price feed or clock).`}
              {candleResult.skippedRows > 0 && ` ${candleResult.skippedRows} unreadable rows in the file were ignored.`}
            </div>
          )}
        </form>
        </>
      )}

      {!loading && trades.length === 0 && !showImport && (
        <div className="card empty">No trades yet. Use <b>Import trades</b> to add your first MT5 report.</div>
      )}

      {trades.length > 0 && (
        <>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={"tab" + (tab === t.id ? " on" : "")}
                onClick={() => { setTab(t.id); remember("edgelog.tab", t.id); }}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "overview" && (
            <>
              <section className="kpis">
                <div className="kpi"><span>Net P&amp;L</span><b className={cls(summary.net)}>{money(summary.net, true)}</b><small>{summary.trades} trades</small></div>
                <div className="kpi"><span>Win rate</span><b>{pct(summary.winRate)}</b><small>{summary.wins} won / {summary.losses} lost</small></div>
                <div className="kpi"><span>Profit factor</span><b>{num2(summary.profitFactor)}</b><small>gross +{money(summary.grossProfit)} / {money(summary.grossLoss)}</small></div>
                <div className="kpi"><span>Expectancy</span><b className={cls(summary.expectancy)}>{money(summary.expectancy, true)}</b><small>per trade, after costs</small></div>
                <div className="kpi"><span>Avg R</span><b className={cls(summary.avgR)}>{num2(summary.avgR)}</b><small>{summary.rTrades} of {summary.trades} trades have a stop to measure risk from</small></div>
                <div className="kpi"><span>Max drawdown</span><b className="neg">{money(dd.maximal.amount)}</b><small>{dd.maximal.percent.toFixed(2)}% of peak (closed trades)</small></div>
                <div className="kpi"><span>Payoff ratio</span><b>{num2(summary.payoff)}</b><small>avg win {money(summary.avgWin)} / avg loss {money(summary.avgLoss)}</small></div>
                <div className="kpi"><span>Longest losing streak</span><b>{summary.maxConsecutiveLosses}</b><small>best winning streak {summary.maxConsecutiveWins}</small></div>
              </section>

              <section className="card">
                <h2>Equity curve</h2>
                <EquityChart start={start} points={curve} />
              </section>

              <section className="grid2">
                <div className="card">
                  <h2>Long vs short</h2>
                  <table>
                    <thead><tr><th>Side</th><th className="r">Trades</th><th className="r">Win rate</th><th className="r">Net</th></tr></thead>
                    <tbody>
                      <tr><td>Long (buy)</td><td className="r">{summary.long.count}</td><td className="r">{pct(summary.long.winRate)}</td><td className={"r " + cls(summary.long.net)}>{money(summary.long.net, true)}</td></tr>
                      <tr><td>Short (sell)</td><td className="r">{summary.short.count}</td><td className="r">{pct(summary.short.winRate)}</td><td className={"r " + cls(summary.short.net)}>{money(summary.short.net, true)}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div className="card">
                  <h2>Costs and timing</h2>
                  <table>
                    <tbody>
                      <tr><td>Commission</td><td className="r neg">{money(summary.commission)}</td></tr>
                      <tr><td>Swap</td><td className="r neg">{money(summary.swap)}</td></tr>
                      <tr><td>Average hold time</td><td className="r">{duration(summary.avgHoldSeconds)}</td></tr>
                      <tr><td>Largest win / loss</td><td className="r">{money(summary.largestWin)} / {money(summary.largestLoss)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {tab === "calendar" && <Calendar trades={trades} />}

          {tab === "edge" && <EdgeTab trades={trades} journal={journal} />}

          {tab === "trades" && (
            <section className="card">
              <h2>Trades {trades.length > recent.length && <span className="muted small">(latest {recent.length})</span>}</h2>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Closed</th><th>Symbol</th><th>Side</th><th className="r">Lots</th>
                      <th className="r">Entry</th><th className="r">Exit</th><th>Exit by</th>
                      <th className="r">R</th><th className="r">Net</th><th>Chart</th><th>Journal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((t) => {
                      const j = t.dbId && journal ? journal.get(t.dbId) : undefined;
                      const hasEntry = !!j && (j.notes || j.setup || j.tags.length || j.mistakes.length || j.emotion || j.screenshots.length);
                      return (
                        <tr key={t.externalId}>
                          <td>{shortStamp(t.closeTime)}</td>
                          <td>{t.symbol}</td>
                          <td>{t.side === "buy" ? "Long" : "Short"}</td>
                          <td className="r">{t.volume}</td>
                          <td className="r">{t.openPrice}</td>
                          <td className="r">{t.closePrice}{t.exits.length > 1 ? " ·avg" : ""}</td>
                          <td>{t.exitReason === "sl" ? "Stop" : t.exitReason === "tp" ? "Target" : t.exitReason === "stop_out" ? "Stop-out" : "Manual"}</td>
                          <td className={"r " + cls(t.rMultiple)}>{t.rMultiple === null ? "–" : t.rMultiple.toFixed(2)}</td>
                          <td className={"r " + cls(t.net)}>{money(t.net, true)}</td>
                          <td className="muted">{t.dbId && chartIds?.has(t.dbId) ? "✓" : "–"}</td>
                          <td>{t.dbId && <Link href={`/trades/${t.dbId}`}>{hasEntry ? "Edit ✓" : "Add"}</Link>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
