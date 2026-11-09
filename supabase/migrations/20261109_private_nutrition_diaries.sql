-- Mijn Kookboek: privéopslag van voedingsdagboeken
-- UITVOEREN PAS NADAT een eigen Supabase-project is aangemaakt.
-- Er worden geen persoonlijke voedingsgegevens in deze migratie opgenomen.

create table if not exists public.nutrition_diaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  diary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint nutrition_diaries_object_check check (jsonb_typeof(diary) = 'object'),
  constraint nutrition_diaries_size_check check (octet_length(diary::text) <= 1048576)
);

alter table public.nutrition_diaries enable row level security;
revoke all on public.nutrition_diaries from public, anon;
grant select, insert, update, delete on public.nutrition_diaries to authenticated;

create policy "diary_select_self" on public.nutrition_diaries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "diary_insert_self" on public.nutrition_diaries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "diary_update_self" on public.nutrition_diaries
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "diary_delete_self" on public.nutrition_diaries
  for delete to authenticated using ((select auth.uid()) = user_id);

comment on table public.nutrition_diaries is
 'Persoonlijke voedingsdagboeken, alleen toegankelijk voor het eigen ingelogde account via RLS.';
