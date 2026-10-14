-- Run this once in Supabase Dashboard → SQL Editor.
-- One JSON document per authenticated user, protected by Row Level Security.
create table if not exists public.user_finance_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_finance_data enable row level security;

create policy "Users can read their own finance data"
  on public.user_finance_data for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own finance data"
  on public.user_finance_data for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own finance data"
  on public.user_finance_data for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
