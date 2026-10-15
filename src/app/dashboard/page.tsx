"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Calendar } from "@/components/Calendar";
import { EdgeTab } from "@/components/EdgeTab";
import { rowToJournal, type Journal } from "@/lib/journal";
import { rowToTrade } from "@/lib/db";
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
        setTrades(all.map(rowToTrade));
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
          <button onClick={() => setShowImport((v) => !v)}>{showImport ? "Close import" : "Import trades"}</button>
          <span className="muted small hide-sm">{email}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      {showImport && (
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
                <div className="kpi"><span>Avg R</span><b className={cls(summary.avgR)}>{num2(summary.avgR)}</b><small>{summary.rTrades} of {summary.trades} trades had an initial stop</small></div>
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
                      <th className="r">R</th><th className="r">Net</th><th>Journal</th>
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
