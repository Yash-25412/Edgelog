# EdgeLog

Trading journal and analytics web app for day, swing and prop-firm traders. Multi-user (each user's data is private via Supabase Row Level Security). First data source: MetaTrader 5 (FundedNext) trade history reports plus the user's own MT5 1-minute bar exports.

**Stack:** Next.js 15 (App Router, client components) · React 19 · TypeScript · plain CSS (`src/app/globals.css`, no Tailwind) · Supabase (Postgres, Auth, Storage, supabase-js with the public anon key only) · Vercel (auto-deploys on every push to `main`) · exceljs (server side, in the import API route).

**Repo:** github.com/Yash-25412/Edgelog · **Owner:** Yash (not a developer: give literal, click-by-click steps for GitHub / Supabase / Vercel).

> Future sessions: read this file and `CLAUDE.md` first. Update the "Status", "Backlog" and "Decisions" sections whenever you ship something.

## Status

| Stage | What | State |
|---|---|---|
| 0 | Repo, Supabase, Vercel, email/password login | Done, live |
| 1 | MT5 report import (xlsx), trade engine, schema | Done. Reconciles exactly with MetaTrader's own totals |
| 2 | Dashboard: KPIs, interactive equity curve, calendar, account switcher | Done |
| 3 | Journal + analytics (edge tab) | Done |
| 3b | Per-trade 100-candle chart from the user's own MT5 1-minute bars | Done. Level marking deliberately not built (needs the user's strategy first) |
| 3c | **Live chart**: all candles, timeframes 1m-1D, long/short boxes, jump from trades list | Done (needs `0004` SQL) |
| 3d | **Setups list**: editable, grouped, rule notes, several per trade | Done (needs `0004` SQL) |
| 3e | Manual trade entry, delete trade, filters + hover preview on Trades tab, animated dashboard | Done |
| 4 | Broker auto-sync | Not started |
| 5 | AI coach (explains numbers computed in code; will read the journal, setups, candles and trades) | Not started |
| 6 | X-factor features | Not started |

## Deploying from scratch

1. Supabase SQL Editor: run `supabase/migrations/0001_core.sql`, `0002_journal.sql`, `0003_charts.sql`, `0004_candles_setups.sql`, once each, in order.
2. Vercel environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). Only the public anon key is used.
3. Supabase Auth > URL configuration: add the Vercel URL. (Turn "Confirm email" back on before real users sign up.)
4. Push to `main`; Vercel builds.

## Using it (user flow)

1. **Import trades**: upload the MT5 `ReportHistory-*.xlsx` (Toolbox > History > Report > Open XML). Re-importing is safe. Choose an existing account or a new one (different MT5 accounts must be separate accounts).
2. **Add price candles**: upload the MT5 1-minute bars export (`Ctrl+U` > Bars > M1 > Export). The whole file is saved per broker day to the `candles` table, and a 100-candle snapshot is built for each trade.
3. **Dashboard** tabs: Overview, Calendar, Edge, Trades. Header buttons: Live chart, Setups, Log a trade, Import trades.
4. **Live chart** (`/chart`, `/chart?trade=<trade id>`): continuous candles, long/short boxes, prev/next trade.
5. **Journal** (`/trades/<id>`): setups (multi-select), tags, mistakes, emotion, notes, screenshots, delete.
6. **Setups** (`/setups`): add/edit/delete setups with groups (Entry, Structure, Alignment or your own) and optional rules.

## Layout

- `src/app/` pages: `dashboard`, `chart`, `setups`, `trades/[id]`, `login`, `api/import` (server route, verifies the bearer token, parses xlsx, upserts)
- `src/components/`: `LiveChart` (canvas, hand-built: pan/zoom/crosshair/boxes), `TradeChart` (per-trade SVG), `EquityCurve`, `Calendar`, `EdgeTab`, `TradesTable`, `SetupPicker`, `SetupsManager`, `Fx` (count-up, reveal, ring)
- `src/lib/import/`: `mt5.ts` (report parser, pure), `xlsx.ts` (exceljs reader; converts UTF-16 xlsx parts to UTF-8 first), `bars.ts` (MT5 bars parser)
- `src/lib/engine/` (pure, tested): `stats`, `analytics` (buckets, plan/timing), `rfallback` (R from final stop), `insights` (filters, month summary, plain-language insights), `chartwindow` (per-trade window rule), `series` (typed-array candles, resample, day packing), `chartmath` (boxes, view framing, ticks)
- `src/lib/`: `db.ts` (row mapping), `charts.ts`, `candlestore.ts` (save candles per day), `journal.ts`, `setups.ts`, `manual.ts` (manual trade builder), `format.ts`, `supabase.ts` (lazy client)
- `supabase/migrations/` 0001 core, 0002 journal + screenshots bucket, 0003 trade charts, 0004 candles + setups
- `tests/` + `tests/fixtures/` (real anonymised FundedNext report, one day of XAUUSD M1)

## Data model (Postgres, all tables RLS: `user_id = auth.uid()`)

`accounts` (platform mt5|manual) · `trades` (unique account_id + external_id) · `ledger_rows` (deal ledger, balances) · `imports` · `trade_journal` (one row per trade; `setup_ids uuid[]`, legacy `setup text`) · `trade_charts` (100-candle window per trade, jsonb) · `candles` (user, symbol, broker day, `bars` jsonb `[minuteOfDay,o,h,l,c,tickVol]`) · `setups` (name, category, note; unique per user by lowercase name). Storage bucket `trade-screenshots` (private, `<user id>/<trade id>/...`).

## Decisions and domain rules (do not change silently)

- **Times** are kept exactly as the broker reports them (naive broker server time, never shifted). Candle times use the same clock, so trades line up with candles.
- **Statistics are computed in code**; the AI coach only explains them.
- **Import is idempotent** (unique account + position id). Consequence: a trade the user deleted comes back on re-import (a "hidden" list is a backlog idea). Deleting a trade does not change drawdown, which comes from the imported balance ledger.
- **R-multiple**: risk = distance from entry to the stop set when the order was placed. Many trades add the stop after entry (limit orders), so `rfallback.withFinalStopR` falls back to the position's final stop when it is still on the losing side of entry (`rBasis: "final"`). Stops moved to/past break-even give no R. Contract size per symbol is inferred from profit / (move x volume), median per symbol. 80 of 83 trades in the first account have R.
- **"Defined" trades**: a stop or target at any point counts as a defined trade (adding them after a limit fill is normal). The Edge tab shows "Risk plan defined" (stop & target / stop only / ...) and "When the plan was added" (set at entry / added after / never).
- **Per-trade chart window**: smallest timeframe in [1,5,15,30,60,240,1440] where the trade spans <= 40 bars; 100 bars total; 8 candles after the exit; the rest before entry. Alignment guard: entry/exit price must lie inside the 1-minute candle at that time (+-1 min), otherwise the trade is skipped (different price feed / clock).
- **Live chart boxes** use the final stop/target (user's choice); a stop on the wrong side of entry is not drawn. Account-scoped (the account selected on the dashboard; "All accounts" also available). Higher timeframes are resampled in the browser from 1-minute candles, bucketed on the broker clock (midnight aligned).
- **Setups**: a trade may have several (entry setup, structure-level setup, timeframe alignment). The Edge "By setup" table counts a trade under each setup.
- Never fabricate market data. Price comes only from the user's own MT5 exports.

## Tests and verification

    npm test          # Node 22.6+, no installs; node:test with --experimental-strip-types (imports use .ts extensions)

Covers the MT5 parser against MetaTrader's own totals, analytics, R fallback, insights/filters, chart windows, series/resampling/boxes, manual trades, candle packing. UI cannot be unit tested without installing packages; the cloud sandbox used so far could not run `npm install` (registry blocked), so UI was checked by bundling components with Bun and screenshotting them in Chromium (Playwright). Anyone with a normal machine can run `npm install && npm run build`.

## Backlog / ideas

- Prop-firm progress card (profit target, daily loss, max drawdown per account) - waiting for the user's FundedNext rules
- Level marking on charts (needs the user's strategy rules; the user is documenting a market-structure strategy: valid high / confirmed low, levels, liquidity)
- Live chart: load candles lazily in pieces (a year+ of M1 will be slow), drawing tools, indicators, price-axis scaling
- Equity curve replay, month mini equity curve on the calendar
- Hidden/deleted trades list so re-import does not resurrect them
- Stage 5 AI coach (inputs: trades, journal, setups with rule notes, candles); Stage 4 broker auto-sync; Stage 6 extras
- Housekeeping: set `ignoreBuildErrors` to false in `next.config.mjs` once `npx tsc --noEmit` is clean (the code was written without ever running a full local build); dashboard drawdown is from closed trades so it differs slightly from MT5's
