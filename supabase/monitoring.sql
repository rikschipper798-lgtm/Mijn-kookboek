-- Alleen voor beheercontrole in de Supabase SQL Editor.
-- Geeft geen namen, e-mailadressen of individuele maaltijdgegevens terug.
select
 count(*)::int as active_diaries,
 coalesce(sum(octet_length(diary::text)),0)::bigint as total_diary_bytes,
 coalesce(max(octet_length(diary::text)),0)::bigint as largest_diary_bytes,
 round(coalesce(avg(octet_length(diary::text)),0))::bigint as average_diary_bytes,
 coalesce(max(revision),0)::bigint as latest_revision,
 count(*) filter(where octet_length(diary::text)>1200000)::int as diaries_above_warning,
 count(*) filter(where octet_length(diary::text)>1800000)::int as diaries_above_app_limit
from public.nutrition_diaries;

select
 count(*)::int as saved_versions,
 coalesce(sum(octet_length(diary::text)),0)::bigint as history_bytes,
 count(distinct user_id)::int as accounts_with_history
from public.nutrition_diary_history;

select
 (select count(*) from auth.users)::int as auth_accounts,
 (select count(*) from public.nutrition_diaries)::int as diaries,
 (select count(*) from public.nutrition_diary_history)::int as saved_versions;
