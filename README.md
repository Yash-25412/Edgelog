# EdgeLog

Trading journal and analytics for day, swing and prop-firm traders. Multi-user.

## Status

| Stage | What | State |
|---|---|---|
| 0 | Repo, Supabase, Vercel, login | Not started (npm was unreachable when Stage 1 code was written) |
| 1 | MT5 import + trade engine + database schema | Parser, stats and schema done and tested. Upload screen not built |
| 2 | Dashboard (KPIs, equity curve, calendar, multi-account) | Not started |
| 3 | Journal + analytics | Not started |
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
- `src/lib/types.ts` – shared types
- `supabase/migrations/0001_core.sql` – tables with per-user Row Level Security
- `scripts/xlsx_to_rows.py` – dev helper to make a new test fixture from an .xlsx

## Rules the code follows

- Statistics are computed in code. The AI coach (Stage 5) only explains them.
- Times are kept exactly as the platform reports them (server time, no zone).
- Import is idempotent: unique (account, platform position id).
- Anything odd found while parsing becomes a warning shown to the user. Nothing is silently dropped.
- R-multiples use the stop set when the order was placed. Trades without one have no R; it is never guessed.
