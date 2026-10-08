-- ─────────────────────────────────────────────────────────────────────────────
-- Old cutting instructions, migrated as files onto producer records.
--
-- Before the online form, a cutting card was a scanned PDF (or an Office Lens
-- photo, a Word doc, an Excel sheet) filed on SharePoint: hundreds of
-- "Abel, Dave BEEF.pdf" under Shared Documents/USB Drive/Cutting Instructions,
-- "Customer Cut Cards", and a folder per producer in Charlie's OneDrive. None
-- of it was reachable from a producer's record in the app (Charlie,
-- 2026-10-05: "migrate old cutting instructions that are stored on OneDrive
-- and get them to the producers' profiles").
--
-- /cutting-instructions/migrate turns each file into a cutting_instructions
-- card — status 'imported' (the "On file" badge /customers already shows),
-- data.formVersion = 'legacy-file', customer_id = the producer — and one row
-- here per file. The bytes go in a PRIVATE bucket; the browser only ever gets
-- a five-minute signed link from /api/cut-sheet-files/[id].
--
-- A file imported straight off SharePoint remembers which drive item it was,
-- so the page can grey out what's already in and the same scan can't land
-- twice. See lib/cutSheetFiles.ts.
--
-- Service role only — read and written through /api/cut-sheet-files.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cutting_instruction_files (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  -- cutting_instructions.id is TEXT (a uuid string). Deleting the card drops
  -- its file rows; the object in the bucket is removed by the API first.
  cutting_instruction_id text not null references public.cutting_instructions(id) on delete cascade,
  filename               text not null,
  storage_path           text not null unique,
  mime_type              text,
  size_bytes             bigint,
  -- 'sharepoint' = pulled through Graph from a drive item; 'upload' = picked
  -- off the office PC.
  source                 text not null check (source in ('sharepoint', 'upload')),
  source_drive_id        text,
  source_item_id         text,
  -- Where it came from, for the record and for finding the original again.
  source_url             text,
  source_path            text,
  imported_by            text
);

create index if not exists cutting_instruction_files_card_idx
  on public.cutting_instruction_files (cutting_instruction_id);

-- One drive item imports once.
create unique index if not exists cutting_instruction_files_source_item
  on public.cutting_instruction_files (source_drive_id, source_item_id)
  where source_item_id is not null;

comment on table public.cutting_instruction_files is
  'Scanned / legacy cutting-instruction files attached to a cutting_instructions card (data.formVersion = legacy-file). Bytes in the private cut-sheet-files bucket. See scripts/2026-10-05_cutting_instruction_files.sql.';

alter table public.cutting_instruction_files enable row level security;
revoke all on public.cutting_instruction_files from anon, authenticated;

-- The private bucket. No policies for anon/authenticated: only the service
-- role (the API) reads or writes it, and uploads from the browser go through a
-- signed upload URL the API hands out for one path.
insert into storage.buckets (id, name, public, file_size_limit)
values ('cut-sheet-files', 'cut-sheet-files', false, 52428800)
on conflict (id) do nothing;
