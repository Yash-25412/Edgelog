"use client";

import { useState, type Ref } from "react";
import type { ChartWindow } from "@/lib/engine/chartwindow";
import type { Trade } from "@/lib/types";

/**
 * Candlestick chart for one trade, drawn as plain SVG with explicit colours so the same markup
 * can be exported as a PNG screenshot. Shows entry, exit, the stop at entry, and the stop/target
 * as they stood when the trade closed.
 */

const W = 1000, H = 540, L = 58, R = 175, T = 66, B = 52;
const BG = "#0e1116", GRID = "#262d38", TXT = "#e6e9ee", MUT = "#8b95a5";
const UP = "#2dd4a8", DOWN = "#ff6b6b", WARN = "#f5b942", BLUE = "#6ea8ff";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const seconds = (s: string) => Date.parse(s + "Z") / 1000;

function niceStep(range: number, target = 6): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Push labels apart vertically so they never overlap. Input and output are in pixel y. */
function spread(ys: number[], gap = 14): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const out = new Array<number>(ys.length);
  order.forEach((o) => (out[o.i] = o.y));
  return out;
}

function decimalsFor(prices: number[]): number {
  return Math.min(5, Math.max(0, ...prices.map((p) => (String(p).split(".")[1] ?? "").length)));
}

export function TradeChart({ trade, chart, svgRef }: { trade: Trade; chart: ChartWindow; svgRef?: Ref<SVGSVGElement> }) {
  const [hover, setHover] = useState<number | null>(null);
  const { candles: C, tfMinutes: tf } = chart;
  const N = C.length;
  const dp = decimalsFor([trade.openPrice, trade.closePrice]);
  const fmt = (p: number) => p.toFixed(dp);

  // vertical range: candles, plus any level that is near enough not to squash the candles
  const lo0 = Math.min(...C.map((c) => c.low)), hi0 = Math.max(...C.map((c) => c.high));
  const near = (p: number | null): p is number => p !== null && p >= lo0 - (hi0 - lo0) * 0.35 && p <= hi0 + (hi0 - lo0) * 0.35;
  const levels = [
    { key: "isl", price: trade.initialSl, color: WARN, label: "Stop at entry", dash: "2 4" },
    { key: "sl", price: trade.sl, color: WARN, label: "Stop at close", dash: "6 4" },
    { key: "tp", price: trade.tp, color: BLUE, label: "Target at close", dash: "6 4" },
  ].filter((l) => near(l.price) && !(l.key === "sl" && l.price === trade.initialSl));
  const all = [lo0, hi0, trade.openPrice, trade.closePrice, ...levels.map((l) => l.price as number)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || 1;
  const yMin = lo - pad, yMax = hi + pad;

  const plotW = W - L - R, plotH = H - T - B;
  const step = plotW / N;
  const x = (i: number) => L + (i + 0.5) * step;
  const y = (p: number) => T + (1 - (p - yMin) / (yMax - yMin)) * plotH;
  const along = (stamp: string, idx: number) => {
    const frac = (seconds(stamp) - seconds(C[idx].time)) / (tf * 60);
    return L + (idx + Math.min(Math.max(frac, 0), 1)) * step;
  };
  const xIn = along(trade.openTime, chart.entryIndex);
  const xOut = along(trade.closeTime, chart.exitIndex);

  const tickStep = niceStep(yMax - yMin, 9);
  const ticks: number[] = [];
  for (let v = Math.ceil(yMin / tickStep) * tickStep; v <= yMax; v += tickStep) ticks.push(v);
  const xEvery = Math.max(1, Math.round(N / 10));
  const xTicks = C.map((_, i) => i).filter((i) => i % xEvery === 0);

  const isBuy = trade.side === "buy";
  const day = (() => {
    const [yy, mm, dd] = trade.openTime.slice(0, 10).split("-");
    return `${Number(dd)} ${MONTHS[Number(mm) - 1]} ${yy}`;
  })();
  const tfLabel = tf >= 1440 ? "1D" : tf >= 60 ? `${tf / 60}h` : `${tf}m`;
  const before = chart.entryIndex, after = N - 1 - chart.exitIndex;
  const net = trade.net;

  // right-hand labels, de-overlapped
  const rightItems = [
    ...levels.map((l) => ({ y: y(l.price as number), color: l.color, text: `${l.label}  ${fmt(l.price as number)}` })),
    { y: y(trade.openPrice), color: TXT, text: `Entry  ${fmt(trade.openPrice)}` },
    { y: y(trade.closePrice), color: UP, text: `Exit  ${fmt(trade.closePrice)}` },
  ];
  const labelYs = spread(rightItems.map((r) => r.y));

  const entryAbove = !isBuy; // a short is entered near a high, a long near a low
  const halo = { stroke: BG, strokeWidth: 3.5, paintOrder: "stroke" } as const;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - L) / step);
    setHover(i >= 0 && i < N ? i : null);
  }
  const hc = hover === null ? null : C[hover];

  return (
    <div className="tchart">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ width: "100%", height: "auto", display: "block" }}
        fontFamily={FONT}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${trade.symbol} ${tfLabel} chart of the trade`}
      >
        <rect width={W} height={H} fill={BG} />
        <text x={L} y={26} fill={TXT} fontSize={17} fontWeight={700}>
          {trade.symbol} · {tfLabel} · {isBuy ? "Long" : "Short"} {trade.volume} lots · {day}
        </text>
        <text x={L} y={46} fill={MUT} fontSize={12}>
          {N} candles, {C[0].time.slice(11, 16)} to {C[N - 1].time.slice(11, 16)} broker time · {before} before entry, {after} after exit ·{" "}
          {net >= 0 ? "+" : ""}
          {net.toFixed(2)}
          {trade.rMultiple !== null ? ` · ${trade.rMultiple.toFixed(2)}R` : ""}
        </text>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} fill={MUT} fontSize={11} textAnchor="end">{v.toFixed(tickStep < 1 ? 2 : 0)}</text>
          </g>
        ))}
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke={GRID} strokeWidth={1} opacity={0.5} />
            <text x={x(i)} y={H - B + 17} fill={MUT} fontSize={11} textAnchor="middle">{C[i].time.slice(11, 16)}</text>
          </g>
        ))}

        <rect x={xIn} y={T} width={Math.max(xOut - xIn, 1)} height={plotH} fill="#ffffff" opacity={0.05} />

        {C.map((c, i) => {
          const col = c.close >= c.open ? UP : DOWN;
          const top = y(Math.max(c.open, c.close)), bottom = y(Math.min(c.open, c.close));
          const bw = Math.max(step * 0.68, 1.5);
          return (
            <g key={c.time}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1.2} />
              <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(bottom - top, 1)} fill={col} />
            </g>
          );
        })}

        {levels.map((l) => (
          <line key={l.key} x1={xIn} x2={W - R} y1={y(l.price as number)} y2={y(l.price as number)} stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} />
        ))}
        <line x1={xIn} x2={xOut} y1={y(trade.openPrice)} y2={y(trade.openPrice)} stroke={TXT} strokeWidth={1.3} />
        <line x1={xIn} x2={xOut} y1={y(trade.openPrice)} y2={y(trade.closePrice)} stroke={TXT} strokeWidth={1.1} opacity={0.55} />
        <line x1={xOut} x2={W - R} y1={y(trade.closePrice)} y2={y(trade.closePrice)} stroke={UP} strokeWidth={1.3} />

        {/* entry marker: triangle pointing the way you traded; exit marker: square */}
        <polygon
          points={isBuy ? `${xIn},${y(trade.openPrice) - 2} ${xIn - 7},${y(trade.openPrice) + 11} ${xIn + 7},${y(trade.openPrice) + 11}` : `${xIn},${y(trade.openPrice) + 2} ${xIn - 7},${y(trade.openPrice) - 11} ${xIn + 7},${y(trade.openPrice) - 11}`}
          fill={isBuy ? UP : DOWN}
          stroke={BG}
          strokeWidth={1.5}
        />
        <rect x={xOut - 6} y={y(trade.closePrice) - 6} width={12} height={12} fill={net >= 0 ? UP : DOWN} stroke={BG} strokeWidth={1.5} />

        <text x={xIn - 12} y={y(trade.openPrice) + (entryAbove ? -22 : 34)} fill={TXT} fontSize={12} textAnchor="end" {...halo}>
          {isBuy ? "BUY" : "SELL"} {trade.volume} @ {fmt(trade.openPrice)}
        </text>
        <text x={xIn - 12} y={y(trade.openPrice) + (entryAbove ? -8 : 48)} fill={MUT} fontSize={11} textAnchor="end" {...halo}>
          {trade.openTime.slice(11)}
        </text>
        <text x={xOut - 14} y={y(trade.closePrice) + (entryAbove ? 30 : -30)} fill={TXT} fontSize={12} textAnchor="end" {...halo}>
          CLOSE @ {fmt(trade.closePrice)}{trade.exitReason === "manual" ? " (manual)" : trade.exitReason === "sl" ? " (stop)" : trade.exitReason === "tp" ? " (target)" : ""}
        </text>
        <text x={xOut - 14} y={y(trade.closePrice) + (entryAbove ? 44 : -16)} fill={MUT} fontSize={11} textAnchor="end" {...halo}>
          {trade.closeTime.slice(11)} · {net >= 0 ? "+" : ""}{net.toFixed(2)}
        </text>

        {rightItems.map((r, i) => (
          <text key={i} x={W - R + 8} y={labelYs[i] + 4} fill={r.color} fontSize={12}>{r.text}</text>
        ))}

        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={MUT} strokeWidth={1} strokeDasharray="3 3" />}
        <text x={L} y={H - 9} fill={MUT} fontSize={10.5}>
          Candles: your MT5 price history. Entry, exit and stops: your trade report. Times are broker server time.
        </text>
      </svg>
      <div className="chart-hover muted small">
        {hc
          ? `${hc.time.slice(5, 16).replace("T", " ")}  ·  O ${fmt(hc.open)}  H ${fmt(hc.high)}  L ${fmt(hc.low)}  C ${fmt(hc.close)}`
          : "Hover over the chart to read a candle."}
        {chart.truncated && " · The price file did not go back far enough to fill all 100 candles."}
      </div>
    </div>
  );
}
