# EdgeLog

Trading journal and analytics for day, swing and prop-firm traders. Multi-user.

## Status

| Stage | What | State |
|---|---|---|
| 0 | Repo, Supabase, Vercel, login | App written (login, upload, dashboard). Not yet built or deployed |
| 1 | MT5 import + trade engine + database schema | Parser, stats and schema tested. Upload screen written, untested in a browser |
| 2 | Dashboard (KPIs, equity curve, calendar, multi-account) | Done: overview, P&L calendar, account switcher |
| 3 | Journal + analytics | Done: edge cuts (hour, weekday, exit, stop discipline), per-trade journal with tags, mistakes, emotion, screenshots |
| 4 | Broker auto-sync | Not started |
| 5 | AI coach | Not started |
| 6 | X-factor features | Not started |

## Run the tests

Needs Node 22.6 or newer. No installs required.

    npm test

The tests parse a real FundedNext MT5 report (`tests/fixtures/`, account name anonymised)
and check the result against the figures MetaTrader prints in that same file.

## Layout

- `src/lib/import/mt5.ts` – MT5 "Trade History Report" parser (pure function on rows)
- `src/lib/import/xlsx.ts` – turns an uploaded .xlsx into rows (not yet tested)
- `src/lib/engine/stats.ts` – win rate, profit factor, expectancy, drawdown, streaks, equity curve
- `src/lib/engine/analytics.ts` – hour / weekday / exit / stop-discipline / tag buckets, daily P&L, sample-size confidence
- `src/components/` – Calendar and Edge tab; `src/app/trades/[id]` – per-trade journal page
- `src/lib/types.ts` – shared types
- `supabase/migrations/0001_core.sql` – tables with per-user Row Level Security
- `scripts/xlsx_to_rows.py` – dev helper to make a new test fixture from an .xlsx

## Rules the code follows

- Statistics are computed in code. The AI coach (Stage 5) only explains them.
- Times are kept exactly as the platform reports them (server time, no zone).
- Import is idempotent: unique (account, platform position id).
- Anything odd found while parsing becomes a warning shown to the user. Nothing is silently dropped.
- R-multiples use the stop set when the order was placed. Trades without one have no R; it is never guessed.

## Deploying

1. Run `supabase/migrations/0001_core.sql`, then `0002_journal.sql`, once each in the Supabase SQL Editor.
2. In Vercel set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).
3. Deploy. Only the public anon key is used; Row Level Security keeps each user's data private.

## Known gaps

- `next.config.mjs` has `ignoreBuildErrors: true` because the first version was written without being able to run a build. Turn it off once `npx tsc --noEmit` is clean.
- `src/lib/import/xlsx.ts` and the app screens have not been exercised against a real browser session yet.
- Dashboard drawdown uses closed trades, so it can differ slightly from MetaTrader's (which includes entry commission).
