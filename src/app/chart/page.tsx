"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { rowToTrade } from "@/lib/db";
import { withFinalStopR } from "@/lib/engine/rfallback";
import { seriesFromBars, unpackDay, type DayRow, type Series } from "@/lib/engine/series";
import type { Bar } from "@/lib/import/bars";
import { LiveChart, type Jump } from "@/components/LiveChart";
import type { Trade } from "@/lib/types";
import { duration, money, shortStamp } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

const cls = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "pos" : "neg");
const idOf = (t: Trade) => t.dbId ?? t.externalId;
const recall = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const remember = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* fine */ } };

// The trade to open comes from the URL (?trade=<id>). It is read with useSearchParams, not window.location:
// on a client-side navigation Next renders this page before the address bar updates, so window.location
// still shows the previous page and the link would silently fall back to the latest trade.
export default function ChartPage() {
  return (
    <Suspense fallback={<div className="shell muted">Loading…</div>}>
      <ChartInner />
    </Suspense>
  );
}

function ChartInner() {
  const router = useRouter();
  const want = useSearchParams().get("trade");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [account, setAccount] = useState<string>("");
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("");
  const [m1, setM1] = useState<Series | null>(null);
  const [progress, setProgress] = useState<string | null>("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [setupNames, setSetupNames] = useState<Map<string, string>>(new Map());
  const [setupsOf, setSetupsOf] = useState<Map<string, string[]>>(new Map());

  // accounts + trades
  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabase();
        const { data: s } = await sb.auth.getSession();
        if (!s.session) return router.replace("/login");
        const { data: accs, error: e1 } = await sb.from("accounts").select("id, name").order("created_at", { ascending: true });
        if (e1) throw new Error(e1.message);
        setAccounts(accs ?? []);
        let acc = recall("edgelog.account") ?? "all";
        if (want) {
          const { data: tr } = await sb.from("trades").select("account_id").eq("id", want).maybeSingle();
          if (tr?.account_id) acc = tr.account_id;
        }
        if (acc !== "all" && !(accs ?? []).some((a: any) => a.id === acc)) acc = "all";
        setAccount(acc);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load."); setProgress(null); }
    })();
  }, [router, want]);

  const loadTrades = useCallback(async (acc: string) => {
    const sb = getSupabase();
    let q = sb.from("trades").select("*").order("open_time", { ascending: true }).limit(5000);
    if (acc !== "all") q = q.eq("account_id", acc);
    const { data, error: e } = await q;
    if (e) throw new Error(e.message);
    const list = withFinalStopR((data ?? []).map(rowToTrade));
    setAllTrades(list);
    const { data: jr } = await sb.from("trade_journal").select("trade_id, setup_ids").limit(5000);
    setSetupsOf(new Map((jr ?? []).map((r: any) => [r.trade_id, r.setup_ids ?? []])));
    const { data: st } = await sb.from("setups").select("id, name");
    setSetupNames(new Map((st ?? []).map((r: any) => [r.id, r.name])));
    return list;
  }, []);

  // which symbols have candles, then pick one
  useEffect(() => {
    if (!account) return;
    (async () => {
      try {
        setProgress("Loading trades…");
        const list = await loadTrades(account);
        const sb = getSupabase();
        const { data, error: e } = await sb.from("candles").select("symbol").limit(5000);
        if (e) throw new Error(/candles/.test(e.message) ? "The candles table does not exist yet. Run 0004_candles_setups.sql in Supabase, then add your price candles." : e.message);
        const have = [...new Set((data ?? []).map((r: any) => r.symbol as string))];
        setSymbols(have);
        if (!have.length) { setProgress(null); setM1(null); return; }
        const wanted = want ? list.find((t) => idOf(t) === want) : null;
        const counts = new Map<string, number>();
        list.forEach((t) => counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1));
        const pick = (wanted && have.find((h) => h.toLowerCase() === wanted.symbol.toLowerCase()))
          ?? [...have].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
        setSymbol((cur) => (cur && have.includes(cur) && !wanted ? cur : pick));
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load."); setProgress(null); }
    })();
  }, [account, loadTrades, want]);

  // candles for the symbol
  useEffect(() => {
    if (!symbol) return;
    let dead = false;
    (async () => {
      try {
        const sb = getSupabase();
        setProgress("Loading candles…");
        const { data: days, error: e } = await sb.from("candles").select("day").eq("symbol", symbol).order("day", { ascending: true }).limit(5000);
        if (e) throw new Error(e.message);
        const list = (days ?? []).map((r: any) => r.day as string);
        const bars: Bar[] = [];
        const CH = 8;
        for (let i = 0; i < list.length; i += CH * 3) {
          const part = list.slice(i, i + CH * 3);
          const res = await Promise.all(
            Array.from({ length: Math.ceil(part.length / CH) }, (_, k) => part.slice(k * CH, k * CH + CH)).map((chunk) =>
              sb.from("candles").select("day, bars").eq("symbol", symbol).in("day", chunk)
            )
          );
          for (const r of res) {
            if (r.error) throw new Error(r.error.message);
            for (const row of r.data ?? []) bars.push(...unpackDay((row as any).day, (row as any).bars as DayRow[]));
          }
          if (dead) return;
          setProgress(`Loading candles… ${Math.min(i + CH * 3, list.length)} of ${list.length} days`);
        }
        bars.sort((a, b) => (a.time < b.time ? -1 : 1));
        if (dead) return;
        setM1(seriesFromBars(bars));
        setProgress(null);
      } catch (e) { if (!dead) { setError(e instanceof Error ? e.message : "Could not load candles."); setProgress(null); } }
    })();
    return () => { dead = true; };
  }, [symbol]);

  const trades = useMemo(() => allTrades.filter((t) => t.symbol.toLowerCase() === symbol.toLowerCase()), [allTrades, symbol]);

  // first jump: the requested trade, else the latest one
  const [didJump, setDidJump] = useState(false);
  useEffect(() => {
    if (didJump || !m1 || !trades.length) return;
    const t = (want && trades.find((x) => idOf(x) === want)) || trades[trades.length - 1];
    setSelected(idOf(t));
    setJump({ id: idOf(t), n: 1 });
    setDidJump(true);
  }, [m1, trades, want, didJump]);

  useEffect(() => {
    if (!want || !didJump) return;
    const t = trades.find((x) => idOf(x) === want);
    if (t && selected !== want) { setSelected(want); setJump((j) => ({ id: want, n: (j?.n ?? 0) + 1 })); }
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id: string) => { setSelected(id); setJump((j) => ({ id, n: (j?.n ?? 0) + 1 })); };
  const idx = trades.findIndex((t) => idOf(t) === selected);
  const sel = idx >= 0 ? trades[idx] : null;
  const hasNames = (id: string) => (setupsOf.get(id) ?? []).map((s) => setupNames.get(s)).filter(Boolean) as string[];

  useEffect(() => {
    if (!fullscreen) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [fullscreen]);

  return (
    <div className="shell wide">
      <header className="top">
        <div className="brand">Edge<span>Log</span></div>
        <div className="top-right">
          <Link href="/dashboard" className="linkbtn">← Dashboard</Link>
        </div>
      </header>

      <div className="lc-head">
        <h1>Live chart</h1>
        <select value={account} onChange={(e) => { setAccount(e.target.value); remember("edgelog.account", e.target.value); setDidJump(false); setSelected(null); }} aria-label="Account">
          <option value="all">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {symbols.length > 0 && (
          <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setM1(null); setDidJump(false); setSelected(null); }} aria-label="Symbol">
            {symbols.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <span className="muted small">{trades.length} trades on this chart</span>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {progress && <div className="card muted">{progress}</div>}
      {!progress && !error && symbols.length === 0 && (
        <div className="card empty">
          No candles saved yet. On the dashboard choose <b>Import trades</b>, then use <b>Add price candles</b> with your MT5 1-minute export. Your whole history will appear here.
        </div>
      )}

      {m1 && (
        <>
          <div className={"lc-wrap card" + (fullscreen ? " lc-full" : "")}>
            <button type="button" className="chart-expand" onClick={() => setFullscreen((v) => !v)}>{fullscreen ? "✕ Close (Esc)" : "⛶ Full screen"}</button>
            <LiveChart m1={m1} symbol={symbol} trades={trades} selectedId={selected} onSelect={setSelected} jump={jump} />
          </div>

          <div className="card lc-trade">
            <div className="lc-nav">
              <button type="button" disabled={idx <= 0} onClick={() => go(idOf(trades[idx - 1]))}>‹ Previous trade</button>
              <select value={selected ?? ""} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Jump to a trade">
                <option value="">Jump to a trade…</option>
                {[...trades].reverse().map((t) => (
                  <option key={idOf(t)} value={idOf(t)}>{shortStamp(t.openTime)} · {t.side === "buy" ? "Long" : "Short"} {t.volume} · {money(t.net, true)}</option>
                ))}
              </select>
              <button type="button" disabled={idx < 0 || idx >= trades.length - 1} onClick={() => go(idOf(trades[idx + 1]))}>Next trade ›</button>
            </div>
            {sel ? (
              <div className="lc-detail">
                <div><span className="muted small">Trade</span><b>{sel.symbol} {sel.side === "buy" ? "Long" : "Short"} {sel.volume}</b></div>
                <div><span className="muted small">Entry</span><b>{sel.openPrice}</b><small>{shortStamp(sel.openTime)}</small></div>
                <div><span className="muted small">Exit</span><b>{sel.closePrice}</b><small>{shortStamp(sel.closeTime)}</small></div>
                <div><span className="muted small">Stop / Target</span><b>{sel.sl ?? "–"} / {sel.tp ?? "–"}</b></div>
                <div><span className="muted small">Net</span><b className={cls(sel.net)}>{money(sel.net, true)}</b><small>{sel.rMultiple === null ? "no R" : `${sel.rMultiple.toFixed(2)}R`}</small></div>
                <div><span className="muted small">Held</span><b>{duration((Date.parse(sel.closeTime + "Z") - Date.parse(sel.openTime + "Z")) / 1000)}</b></div>
                {hasNames(idOf(sel)).length > 0 && <div className="lc-setups">{hasNames(idOf(sel)).map((n) => <span key={n} className="chip">{n}</span>)}</div>}
                {sel.dbId && <div><Link href={`/trades/${sel.dbId}`}>Open journal →</Link></div>}
              </div>
            ) : <p className="muted small">Click a long/short box on the chart, or pick a trade above.</p>}
          </div>
        </>
      )}
    </div>
  );
}
