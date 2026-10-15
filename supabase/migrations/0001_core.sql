-- EdgeLog core schema (Stage 1). Multi-user from day one: every row belongs to a
-- user and Row Level Security makes the database itself refuse cross-user access.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('mt5','manual')),
  firm text,                                   -- e.g. 'FundedNext'
  currency text not null default 'USD',
  starting_balance numeric(18,2),
  created_at timestamptz not null default now()
);

-- Times are stored exactly as the platform reports them (server time, no zone).
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  external_id text not null,                   -- platform position id
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  volume numeric(18,4) not null,
  open_time timestamp not null,
  open_price numeric(18,5) not null,
  sl numeric(18,5), tp numeric(18,5),
  initial_sl numeric(18,5), initial_tp numeric(18,5),
  close_time timestamp not null,
  close_price numeric(18,5) not null,
  commission numeric(18,2) not null default 0,
  swap numeric(18,2) not null default 0,
  profit numeric(18,2) not null,
  net numeric(18,2) not null,
  exit_reason text check (exit_reason in ('sl','tp','stop_out','manual')),
  risk_money numeric(18,2),
  r_multiple numeric(10,2),
  exits jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (account_id, external_id)             -- re-importing a report can never duplicate trades
);
create index trades_user_close on public.trades (user_id, close_time);
create index trades_account_close on public.trades (account_id, close_time);

create table public.ledger_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  deal_id text not null,
  time timestamp not null,
  kind text not null check (kind in ('entry','exit','deposit','withdrawal','credit','other')),
  symbol text, side text,
  volume numeric(18,4), price numeric(18,5),
  commission numeric(18,2) not null default 0,
  fee numeric(18,2) not null default 0,
  swap numeric(18,2) not null default 0,
  profit numeric(18,2) not null default 0,
  balance numeric(18,2) not null,
  comment text,
  unique (account_id, deal_id)
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  filename text,
  platform text not null,
  trades_added int not null default 0,
  trades_skipped int not null default 0,
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.accounts    enable row level security;
alter table public.trades      enable row level security;
alter table public.ledger_rows enable row level security;
alter table public.imports     enable row level security;

create policy "own accounts"    on public.accounts    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own trades"      on public.trades      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own ledger"      on public.ledger_rows for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own imports"     on public.imports     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
