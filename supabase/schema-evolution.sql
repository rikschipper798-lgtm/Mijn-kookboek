-- Compatibele schema-evolutie. Bestaande JSONB-opslag blijft functioneren.
-- Het formaat kan in een latere migratie expliciet worden opgehoogd.
alter table public.nutrition_diaries
  add column if not exists schema_version smallint not null default 1;

alter table public.nutrition_diaries
  add constraint nutrition_schema_version_positive check (schema_version >= 1);

alter table public.nutrition_diaries
  add constraint nutrition_diary_core_structure check (
    jsonb_typeof(diary) = 'object'
    and jsonb_typeof(diary->'goals') = 'object'
    and jsonb_typeof(diary->'days') = 'object'
  );
