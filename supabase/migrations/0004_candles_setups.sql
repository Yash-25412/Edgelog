-- EdgeLog: full candle history + editable setups list. Run once in the Supabase SQL Editor after 0003.

-- 1) All 1-minute candles, stored one row per symbol per broker day.
--    bars = [[minuteOfDay, open, high, low, close, tickVolume], ...]
create table if not exists public.candles (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  day text not null,                      -- 'YYYY-MM-DD', broker date
  bars jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol, day)
);
alter table public.candles enable row level security;
drop policy if exists "own candles" on public.candles;
create policy "own candles" on public.candles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Your list of setups, each with an optional rule note.
create table if not exists public.setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Entry',  -- e.g. Entry, Structure, Alignment (free text)
  note text,                               -- the rules for this setup (optional)
  created_at timestamptz not null default now()
);
create unique index if not exists setups_user_name on public.setups (user_id, lower(name));
alter table public.setups enable row level security;
drop policy if exists "own setups" on public.setups;
create policy "own setups" on public.setups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) A trade can carry several setups.
alter table public.trade_journal add column if not exists setup_ids uuid[] not null default '{}';

-- 4) Carry over the setups you already typed by hand (one list entry per distinct name).
insert into public.setups (user_id, name, category)
select distinct on (user_id, lower(btrim(setup))) user_id, btrim(setup), 'Entry'
from public.trade_journal
where setup is not null and btrim(setup) <> ''
on conflict do nothing;

update public.trade_journal j
set setup_ids = array[s.id]
from public.setups s
where j.setup is not null and btrim(j.setup) <> ''
  and s.user_id = j.user_id and lower(s.name) = lower(btrim(j.setup))
  and cardinality(j.setup_ids) = 0;
