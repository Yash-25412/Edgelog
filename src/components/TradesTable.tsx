"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ChartWindow } from "@/lib/engine/chartwindow";
import { filterTrades, NO_FILTERS, totals, type Filters } from "@/lib/engine/insights";
import type { Journal } from "@/lib/journal";
import type { Trade } from "@/lib/types";
import { money, pct, shortStamp } from "@/lib/format";

const cls = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "pos" : "neg");
const PAGE = 50;

export function MiniChart({ trade, chart }: { trade: Trade; chart: ChartWindow }) {
  const W = 260, H = 130, C = chart.candles, N = C.length;
  const lo = Math.min(...C.map((c) => c.low)), hi = Math.max(...C.map((c) => c.high)), span = hi - lo || 1;
  const x = (i: number) => 4 + ((i + 0.5) / N) * (W - 8);
  const y = (p: number) => 6 + (1 - (p - lo) / span) * (H - 12);
  const bw = Math.max((W - 8) / N - 0.8, 1);
  const buy = trade.side === "buy";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      {C.map((c, i) => {
        const col = c.close >= c.open ? "#2dd4a8" : "#ff6b6b";
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth="0.8" />
            <rect x={x(i) - bw / 2} y={y(Math.max(c.open, c.close))} width={bw} height={Math.max(Math.abs(y(c.open) - y(c.close)), 0.8)} fill={col} />
          </g>
        );
      })}
      <line x1={x(chart.entryIndex)} x2={x(chart.exitIndex)} y1={y(trade.openPrice)} y2={y(trade.closePrice)} stroke="#e6e9ee" strokeWidth="1.4" strokeDasharray="3 2" />
      <circle cx={x(chart.entryIndex)} cy={y(trade.openPrice)} r="3.5" fill={buy ? "#2dd4a8" : "#ff6b6b"} stroke="#0e1116" />
      <rect x={x(chart.exitIndex) - 3} y={y(trade.closePrice) - 3} width="6" height="6" fill={trade.net >= 0 ? "#2dd4a8" : "#ff6b6b"} stroke="#0e1116" />
    </svg>
  );
}

export function TradesTable({
  trades, journal, chartIds, onDelete, loadChart,
}: {
  trades: Trade[];
  journal: Map<string, Journal> | null;
  chartIds: Set<string> | null;
  onDelete: (t: Trade) => void;
  loadChart: (dbId: string) => Promise<ChartWindow | null>;
}) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [asc, setAsc] = useState(false);
  const [pv, setPv] = useState<{ t: Trade; x: number; y: number; chart: ChartWindow | null | undefined } | null>(null);
  const token = useRef(0);

  const rows = filterTrades(trades, f);
  const sorted = asc ? rows : [...rows].reverse();
  const sum = totals(rows);
  const active = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const set = (p: Partial<Filters>) => { setF((o) => ({ ...o, ...p })); setShown(PAGE); };

  function enter(t: Trade, e: React.MouseEvent) {
    if (!t.dbId || !chartIds?.has(t.dbId)) return setPv(null);
    const my = ++token.current;
    setPv({ t, x: e.clientX, y: e.clientY, chart: undefined });
    loadChart(t.dbId).then((c) => { if (token.current === my) setPv((p) => (p && p.t === t ? { ...p, chart: c } : p)); });
  }
  const leave = () => { token.current++; setPv(null); };

  return (
    <section className="card">
      <div className="filters">
        <input type="search" placeholder="Search symbol…" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" />
        <div className="seg">
          {(["all", "buy", "sell"] as const).map((s) => <button key={s} type="button" className={f.side === s ? "on" : ""} onClick={() => set({ side: s })}>{s === "all" ? "All" : s === "buy" ? "Long" : "Short"}</button>)}
        </div>
        <div className="seg">
          {(["all", "win", "loss"] as const).map((s) => <button key={s} type="button" className={f.result === s ? "on" : ""} onClick={() => set({ result: s })}>{s === "all" ? "Any result" : s === "win" ? "Wins" : "Losses"}</button>)}
        </div>
        <label className="inl">From<input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="inl">To<input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {active && <button type="button" className="link" onClick={() => { setF(NO_FILTERS); setShown(PAGE); }}>Clear</button>}
      </div>
      <div className="tot">
        <b>{sum.n}</b> trades · <b className={cls(sum.net)}>{money(sum.net, true)}</b> · {pct(sum.winRate)} won
        {active && <span className="muted"> (filtered from {trades.length})</span>}
      </div>

      <div className="scroll full">
        <table>
          <thead>
            <tr>
              <th><button type="button" className="link" onClick={() => setAsc((v) => !v)}>Closed {asc ? "▲" : "▼"}</button></th>
              <th>Symbol</th><th>Side</th><th className="r">Lots</th>
              <th className="r">Entry</th><th className="r">Exit</th><th>Exit by</th>
              <th className="r">R</th><th className="r">Net</th><th>Chart</th><th>Journal</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, shown).map((t) => {
              const j = t.dbId && journal ? journal.get(t.dbId) : undefined;
              const hasEntry = !!j && (j.notes || j.setup || j.tags.length || j.mistakes.length || j.emotion || j.screenshots.length);
              return (
                <tr key={t.externalId} className="hovrow" onMouseEnter={(e) => enter(t, e)} onMouseMove={(e) => setPv((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))} onMouseLeave={leave}>
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
                  <td>{t.dbId && <button type="button" className="link danger" onClick={() => onDelete(t)} aria-label="Delete trade">Delete</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && <p className="muted small">No trades match these filters.</p>}
      </div>
      {sorted.length > shown && <button type="button" className="more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, sorted.length - shown)} more ({sorted.length - shown} left)</button>}

      {pv && (
        <div className="preview" style={{ left: Math.min(pv.x + 18, (typeof window === "undefined" ? 1000 : window.innerWidth) - 290), top: Math.max(pv.y - 70, 8) }}>
          {pv.chart ? <MiniChart trade={pv.t} chart={pv.chart} /> : <div className="muted small pvload">{pv.chart === undefined ? "Loading chart…" : "No chart saved"}</div>}
          <div className="small">{pv.t.symbol} {pv.t.side === "buy" ? "long" : "short"} · <b className={cls(pv.t.net)}>{money(pv.t.net, true)}</b>{pv.t.rMultiple !== null && ` · ${pv.t.rMultiple.toFixed(2)}R`}</div>
        </div>
      )}
    </section>
  );
}
