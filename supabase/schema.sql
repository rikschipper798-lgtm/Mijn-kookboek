-- Mijn Kookboek: persoonlijke voedingsdagboeken per ingelogde gebruiker.
-- Uitvoeren in de SQL Editor van je EIGEN Supabase-project.
-- Deel nooit service_role- of secret-API-sleutels met de website.
create table if not exists public.nutrition_diaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  diary jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint diary_max_size check (octet_length(diary::text) <= 2097152)
);

alter table public.nutrition_diaries enable row level security;

-- Beperk Data API-toegang: alleen ingelogde gebruikers, nooit anoniem.
-- Supabase-projecten kunnen extra standaardrechten aan authenticated geven.
-- Trek daarom eerst ALLE rechten in (inclusief DELETE en TRUNCATE) en
-- verleen daarna uitsluitend de rechten die deze app nodig heeft.
revoke all privileges on table public.nutrition_diaries from anon, authenticated, public;
grant select, insert, update on table public.nutrition_diaries to authenticated;

drop policy if exists "Own diary read" on public.nutrition_diaries;
create policy "Own diary read"
  on public.nutrition_diaries
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Own diary create" on public.nutrition_diaries;
create policy "Own diary create"
  on public.nutrition_diaries
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Own diary update" on public.nutrition_diaries;
create policy "Own diary update"
  on public.nutrition_diaries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Geen DELETE-toegang via de website: voorkom onbedoeld gegevensverlies.
-- Een account/databasebeheerder kan een gebruiker en daarmee diens dagboek verwijderen.
