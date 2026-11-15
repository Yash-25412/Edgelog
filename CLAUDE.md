# Notes for Claude (read before changing anything)

Read `README.md` first: stack, layout, data model, decisions, backlog. Keep it current; update Status/Backlog/Decisions in the same commit as the change.

## Working with the owner (Yash)
- Not a developer, works in FP&A. Explain in plain language and give literal click-by-click steps for GitHub, Supabase (SQL editor) and Vercel. Say exactly which SQL file to run and in what order.
- Build in stages with a test gate. Ask questions when a request is ambiguous and expensive to redo (he invites it); otherwise decide and say what you decided.
- Be straight about what was and was not tested. Never claim a UI screen works if you only type-checked it.
- Do not guess trading facts: when something is not in the data (e.g. a stop that was never recorded), say so. Never fabricate prices.

## Engineering rules
- Pure logic goes in `src/lib/engine/*` with tests in `tests/` (add the file to the `test` script in `package.json`). Run `npm test` before every push.
- Imports of engine/lib files used by tests must end in `.ts` (Node strip-types). App code imports with `@/...`.
- Broker times are naive strings treated as UTC for arithmetic; never convert to local time.
- Only the Supabase anon key is used in the browser; all tables rely on RLS. Any new table needs RLS policies and a numbered migration in `supabase/migrations/` plus a README line.
- New DB features must degrade gracefully if the migration has not been run yet (show a message naming the SQL file), as the existing pages do.
- `next.config.mjs` ignores type errors on build; still keep `tsc --noEmit` clean apart from missing-package noise.
- Commit message ends with the Co-Authored-By / Claude-Session lines given by the session. Push to `main` deploys to Vercel.
- If `npm install` is blocked in the sandbox, verify UI by bundling with Bun and screenshotting with Playwright (see README), and tell the owner what could not be run.
