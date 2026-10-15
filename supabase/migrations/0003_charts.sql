-- EdgeLog trade charts (Stage 3b). Run once in the Supabase SQL Editor after 0001 and 0002.
-- Only the ~100 candles around each trade are kept, not the whole price history.

create table if not exists public.trade_charts (
  trade_id uuid primary key references public.trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tf_minutes smallint not null,
  candles jsonb not null,             -- [[time, open, high, low, close, tickVolume], ...] broker time
  entry_index smallint not null,
  exit_index smallint not null,
  truncated boolean not null default false,
  source text not null default 'mt5-bars',
  created_at timestamptz not null default now()
);
create index if not exists trade_charts_user on public.trade_charts (user_id);

alter table public.trade_charts enable row level security;
drop policy if exists "own charts" on public.trade_charts;
create policy "own charts" on public.trade_charts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Saving a chart screenshot into the journal overwrites the same file each time, which needs an update policy.
drop policy if exists "own screenshots update" on storage.objects;
create policy "own screenshots update" on storage.objects for update to authenticated
  using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
