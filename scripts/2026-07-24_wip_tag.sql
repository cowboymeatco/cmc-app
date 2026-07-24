-- Work-in-progress tag: the printed version of the handwritten WIP sheet the
-- processing room fills out when product goes to value add.
--
-- Their sheet reads WEIGHT / CUSTOMER / INTENT / LABEL / BATCH. weight_in_lbs
-- and output_item_name already cover WEIGHT and LABEL, and BATCH is the Julian
-- off requested_date, so this adds the two that had nowhere to live:
--   customer_name      — whose animal this is. Custom-exempt product must not
--                        get mixed into shelf stock, so it prints big.
--   source_description — what is in the tub right now ("Trim", "Round Roast"),
--                        as opposed to what it is meant to become.
--   tag_code           — short Code 39-safe code so the tag can be scanned
--                        instead of read.

alter table value_add_jobs
  add column if not exists customer_name text,
  add column if not exists source_description text,
  add column if not exists tag_code text;

create unique index if not exists value_add_jobs_tag_code_key
  on value_add_jobs (tag_code) where tag_code is not null;

comment on column value_add_jobs.customer_name is
  'Whose product this is — blank means CMC shelf stock';
comment on column value_add_jobs.source_description is
  'What went in ("Trim", "Round Roast") — the intent is what it becomes';
comment on column value_add_jobs.tag_code is
  'WIP<julian><seq> — printed as a Code 39 barcode on the WIP tag';
