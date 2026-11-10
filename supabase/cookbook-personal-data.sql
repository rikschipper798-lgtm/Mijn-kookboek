-- Mijn Kookboek: gescheiden accountopslag voor persoonlijke receptgegevens.
-- Dit is GEEN voedingsdagboek en verandert bestaande dagboekgegevens niet.
create table if not exists public.cookbook_personal_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint cookbook_personal_data_object check (jsonb_typeof(data) = 'object'),
  constraint cookbook_personal_data_size check (octet_length(data::text) <= 2097152)
);
alter table public.cookbook_personal_data enable row level security;
revoke all privileges on table public.cookbook_personal_data from anon, authenticated, public;
grant select, insert, update on table public.cookbook_personal_data to authenticated;
drop policy if exists "Own cookbook data read" on public.cookbook_personal_data;
create policy "Own cookbook data read" on public.cookbook_personal_data
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Own cookbook data create" on public.cookbook_personal_data;
create policy "Own cookbook data create" on public.cookbook_personal_data
  for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Own cookbook data update" on public.cookbook_personal_data;
create policy "Own cookbook data update" on public.cookbook_personal_data
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Geen DELETE voor browsers; lokale back-up en versievergelijking blijven vereist.
