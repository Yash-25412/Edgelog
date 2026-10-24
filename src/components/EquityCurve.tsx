"use client";

import { useMemo, useState } from "react";
import type { CurvePoint } from "@/lib/engine/stats";

export interface CurveExtra { symbol: string; side: string; net: number }

const W = 900, H = 300, PL = 10, PR = 10, PT = 16, PB = 16;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Smooth monotone-ish path through points (midpoint quadratic smoothing). */
function smooth(pts: [number, number][]): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0].toFixed(1)},${l[1].toFixed(1)}`;
}

export function EquityCurve({ start, points, extras }: { start: number; points: CurvePoint[]; extras: CurveExtra[] }) {
  const [range, setRange] = useState<"all" | 50 | 20>("all");
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    const all = points.map((p, i) => ({ ...p, ...extras[i] }));
    const slice = range === "all" ? all : all.slice(-range);
    const base = range === "all" ? start : all[Math.max(all.length - range - 1, 0)]?.balance ?? start;
    return { pts: [{ time: slice[0]?.time ?? "", balance: base, tradeId: "start", symbol: "", side: "", net: 0 }, ...slice], base };
  }, [points, extras, range, start]);

  const P = data.pts, N = P.length;
  if (N < 2) return <p className="muted small">No trades to draw yet.</p>;
  const vals = P.map((p) => p.balance);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i: number) => PL + (i / (N - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - lo) / span) * (H - PT - PB);
  const xy = P.map((p, i) => [x(i), y(p.balance)] as [number, number]);
  const line = smooth(xy);
  const area = `${line} L${x(N - 1)},${H - PB} L${x(0)},${H - PB} Z`;

  // deepest peak-to-trough stretch, shaded
  let peak = 0, ddFrom = 0, ddTo = 0, ddMax = 0, curPeak = 0;
  P.forEach((p, i) => {
    if (p.balance > P[curPeak].balance) curPeak = i;
    const d = P[curPeak].balance - p.balance;
    if (d > ddMax) { ddMax = d; ddFrom = curPeak; ddTo = i; }
    if (p.balance > P[peak].balance) peak = i;
  });
  const iLo = vals.indexOf(lo), iHi = vals.indexOf(hi);
  const up = P[N - 1].balance >= P[0].balance;
  const col = up ? "var(--pos)" : "var(--neg)";

  const maxAbs = Math.max(...P.slice(1).map((p) => Math.abs(p.net)), 1);
  const hp = hover === null ? null : P[hover];

  function onMove(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const px = ((cx - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(N - 1, Math.round(((px - PL) / (W - PL - PR)) * (N - 1)))));
  }

  return (
    <div className="eq">
      <div className="eq-head">
        <div>
          <div className="eq-big" style={{ color: col }}>{money(hp ? hp.balance : P[N - 1].balance)}</div>
          <div className="muted small">
            {hp
              ? hp.tradeId === "start"
                ? "Start of range"
                : `${hp.time.slice(0, 16).replace("T", " ")} · ${hp.symbol} ${hp.side === "buy" ? "long" : "short"} · ${hp.net >= 0 ? "+" : ""}${money(hp.net)}`
              : `${N - 1} trades · ${up ? "up" : "down"} ${money(Math.abs(P[N - 1].balance - P[0].balance))} in this view`}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Range">
          {(["all", 50, 20] as const).map((r) => (
            <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => { setRange(r); setHover(null); }}>
              {r === "all" ? "All" : `Last ${r}`}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="eq-svg" onMouseMove={onMove} onTouchMove={onMove} onMouseLeave={() => setHover(null)} onTouchEnd={() => setHover(null)} role="img" aria-label="Equity curve">
        <defs>
          <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "#2dd4a8" : "#ff6b6b"} stopOpacity="0.38" />
            <stop offset="100%" stopColor={up ? "#2dd4a8" : "#ff6b6b"} stopOpacity="0" />
          </linearGradient>
          <filter id="eqglow" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PL} x2={W - PR} y1={PT + f * (H - PT - PB)} y2={PT + f * (H - PT - PB)} stroke="var(--line)" strokeDasharray="3 6" />)}
        <line x1={PL} x2={W - PR} y1={y(P[0].balance)} y2={y(P[0].balance)} stroke="var(--muted)" strokeDasharray="4 4" opacity=".5" />
        {ddMax > 0 && <rect x={x(ddFrom)} y={PT} width={Math.max(x(ddTo) - x(ddFrom), 2)} height={H - PT - PB} fill="var(--neg)" opacity=".07" />}
        <path key={"a" + range} d={area} fill="url(#eqfill)" className="eq-area" />
        <path key={"l" + range} d={line} fill="none" stroke={col} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" filter="url(#eqglow)" className="eq-line" pathLength={1} />
        <g className="eq-marks">
          <circle cx={x(iHi)} cy={y(hi)} r="4" fill={col} /><text x={x(iHi)} y={y(hi) - 9} fontSize="12" fill="var(--muted)" textAnchor="middle">high {money(hi)}</text>
          <circle cx={x(iLo)} cy={y(lo)} r="4" fill="var(--neg)" /><text x={x(iLo)} y={y(lo) + 18} fontSize="12" fill="var(--muted)" textAnchor="middle">low {money(lo)}</text>
          {ddMax > 0 && <text x={(x(ddFrom) + x(ddTo)) / 2} y={H - 3} fontSize="11" fill="var(--neg)" opacity=".8" textAnchor="middle">biggest drawdown −{money(ddMax)}</text>}
        </g>
        <circle cx={x(N - 1)} cy={y(P[N - 1].balance)} r="5" fill={col} className="eq-pulse" />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="var(--muted)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(P[hover].balance)} r="6" fill="var(--bg)" stroke={col} strokeWidth="3" />
          </g>
        )}
      </svg>

      <svg viewBox={`0 0 ${W} 54`} className="eq-bars" aria-label="Result of each trade">
        {P.slice(1).map((p, k) => {
          const i = k + 1, h = Math.max((Math.abs(p.net) / maxAbs) * 24, 1.5), w = Math.max((W - PL - PR) / N - 1.5, 1);
          return <rect key={i} x={x(i) - w / 2} y={p.net >= 0 ? 27 - h : 27} width={w} height={h} rx="1" fill={p.net >= 0 ? "var(--pos)" : "var(--neg)"} opacity={hover === null || hover === i ? 0.9 : 0.3} className="eq-bar" style={{ animationDelay: `${Math.min(k * 8, 700)}ms` }} />;
        })}
        <line x1={PL} x2={W - PR} y1="27" y2="27" stroke="var(--line)" />
      </svg>
    </div>
  );
}
