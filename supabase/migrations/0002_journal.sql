-- EdgeLog journal (Stage 3). Run once in the Supabase SQL Editor after 0001.
-- Journal data lives in its own table, so re-importing a report never touches your notes.

create table if not exists public.trade_journal (
  trade_id uuid primary key references public.trades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  setup text,                                   -- e.g. 'Breakout', 'Pullback'
  tags text[] not null default '{}',
  mistakes text[] not null default '{}',        -- e.g. 'Moved stop', 'Revenge trade'
  emotion smallint check (emotion between 1 and 5),   -- 1 = calm and in control, 5 = tilted
  notes text,
  screenshots text[] not null default '{}',     -- paths inside the trade-screenshots bucket
  updated_at timestamptz not null default now()
);
create index if not exists trade_journal_user on public.trade_journal (user_id);

alter table public.trade_journal enable row level security;
drop policy if exists "own journal" on public.trade_journal;
create policy "own journal" on public.trade_journal
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private bucket for chart screenshots. Files live under <user id>/<trade id>/...
insert into storage.buckets (id, name, public)
values ('trade-screenshots', 'trade-screenshots', false)
on conflict (id) do nothing;

drop policy if exists "own screenshots read" on storage.objects;
drop policy if exists "own screenshots write" on storage.objects;
drop policy if exists "own screenshots delete" on storage.objects;

create policy "own screenshots read" on storage.objects for select to authenticated
  using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own screenshots write" on storage.objects for insert to authenticated
  with check (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own screenshots delete" on storage.objects for delete to authenticated
  using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
