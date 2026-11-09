-- Beperkte, accountgebonden versiegeschiedenis van het voedingsdagboek.
-- Aanvullende herstelmogelijkheid; geen volledige externe databaseback-up.
create table if not exists public.nutrition_diary_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision >= 1),
  diary jsonb not null,
  saved_at timestamptz not null default now(),
  primary key(user_id,revision),
  constraint history_diary_max_size check (octet_length(diary::text) <= 2097152)
);
alter table public.nutrition_diary_history enable row level security;
revoke all privileges on table public.nutrition_diary_history from anon,authenticated,public;
grant select on table public.nutrition_diary_history to authenticated;
drop policy if exists "Own diary version read" on public.nutrition_diary_history;
create policy "Own diary version read"
 on public.nutrition_diary_history for select to authenticated
 using (user_id=(select auth.uid()));

-- Een trigger in een niet-openbaar schema beheert de snapshots. Geen publieke RPC.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create or replace function app_private.capture_previous_nutrition_diary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.nutrition_diary_history(user_id,revision,diary)
  values (old.user_id,old.revision,old.diary)
  on conflict (user_id,revision) do nothing;

  delete from public.nutrition_diary_history h
  where h.user_id=old.user_id
    and h.revision not in (
      select hh.revision from public.nutrition_diary_history hh
      where hh.user_id=old.user_id
      order by hh.revision desc
      limit 3
    );
  return new;
end;
$$;
revoke all on function app_private.capture_previous_nutrition_diary() from public,anon,authenticated;

drop trigger if exists capture_previous_nutrition_diary on public.nutrition_diaries;
create trigger capture_previous_nutrition_diary
after update of diary on public.nutrition_diaries
for each row when (old.diary is distinct from new.diary)
execute function app_private.capture_previous_nutrition_diary();
