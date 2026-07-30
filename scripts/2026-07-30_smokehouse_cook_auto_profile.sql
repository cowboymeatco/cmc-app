-- Auto-tag a cook's recipe from the controller export filename.
-- Applied to prod 2026-07-30 as migration smokehouse_cook_auto_profile
-- (Supabase MCP). Kept here per the scripts/ migration pattern.
--
-- The controller names every run RECIPE_MM-DD-YYYY-HH-MM-SS.csv, so the recipe
-- is already in smokehouse_cook.file_name — the ingestion just never parsed it.
-- A trigger tags on insert regardless of what does the ingesting, so the
-- /calendar and /cooks pages title new cooks without the crew touching them
-- (Charlie, feedback 820406a4, 2026-07-30).
--
-- Matching against cook_profile.profile_key, unique match required:
--   1. exact            — SNACK STICKS_...csv          → SNACK STICKS
--   2. profile + space  — BEEF JERKY TCG_...csv        → BEEF JERKY
--   3. truncated prefix — the controller cuts names at 16 chars
--                         (CHARLIE PRIME RI), so a profile extending the parsed
--                         name also matches when it is the only one that does.
-- No match → NULL, which is correct: SMOKE TEST / BLOWER / cleaning runs must
-- not title the calendar. A crew tag from /cooks is never overwritten.
--
-- To re-tag after adding a new cook_profile row (e.g. a CHARLIE PRIME RIB
-- profile), re-run the UPDATE at the bottom — the trigger only fires on insert.

create or replace function match_cook_profile(p_file_name text)
returns text
language sql stable as $$
  with parsed as (
    select regexp_replace(coalesce(p_file_name, ''), '_\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{2}\.csv$', '') as name
  ),
  hits as (
    select cp.profile_key,
           (cp.profile_key = parsed.name) as exact
    from cook_profile cp, parsed
    where parsed.name <> ''
      and (cp.profile_key = parsed.name
           or parsed.name like cp.profile_key || ' %'
           or (length(parsed.name) >= 12 and cp.profile_key like parsed.name || '%'))
  )
  select profile_key from hits
  where exact or (select count(*) from hits) = 1
  order by exact desc
  limit 1
$$;

create or replace function trg_smokehouse_cook_auto_profile()
returns trigger
language plpgsql as $$
begin
  if new.profile_key is null then
    new.profile_key := match_cook_profile(new.file_name);
  end if;
  return new;
end;
$$;

drop trigger if exists smokehouse_cook_auto_profile on smokehouse_cook;
create trigger smokehouse_cook_auto_profile
  before insert on smokehouse_cook
  for each row
  execute function trg_smokehouse_cook_auto_profile();

-- Catch rows the one-time backfill missed (safe to re-run any time).
update smokehouse_cook
   set profile_key = match_cook_profile(file_name)
 where profile_key is null
   and match_cook_profile(file_name) is not null;
