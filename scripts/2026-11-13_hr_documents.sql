-- The Team Member Handbook and per-position Roles & Responsibilities, in the
-- app (/handbook for the crew, /handbook/manage for Charlie).
--
-- Charlie's rules (2026-11-13):
--   • Every employee reads the handbook. A role document is seen only by the
--     people it is assigned to, plus the manager.
--   • Documents are pages edited in the app, and print to PDF.
--   • Sign-off is in the app: "I've read this", stamped with who, when and
--     WHICH VERSION. So publishing is a separate step from editing — a draft
--     can be worked on without anyone seeing it, and each publish freezes a
--     copy. An acknowledgment points at that frozen copy, so what somebody
--     agreed to can always be shown exactly as it read that day.
--   • Employees sign in with their time clock PIN (tk_employees), on the
--     entrance iPad or their own phone.
--
-- hr_sessions is deliberately NOT tk_kiosk_sessions. A handbook sign-in on a
-- phone must never be good for punching the clock from home.
--
-- All five tables: RLS on, no policies — the same shape as the tk_* tables.
-- The browser never reads them; every read and write goes through the
-- service-role API routes under /api/handbook.
--
-- Additive only. Touches no existing table.

create table if not exists public.hr_documents (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  -- 'everyone' = the handbook and anything else the whole crew reads;
  -- 'assigned' = only the employees in hr_document_assignments.
  audience           text not null check (audience in ('everyone', 'assigned')),
  -- The working draft (markdown). Employees never see this — only versions.
  body               text not null default '',
  -- 0 = never published. Otherwise the newest row in hr_document_versions.
  published_version  integer not null default 0,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.hr_document_versions (
  document_id   uuid not null references public.hr_documents(id) on delete cascade,
  version       integer not null check (version > 0),
  title         text not null,
  body          text not null,
  published_at  timestamptz not null default now(),
  primary key (document_id, version)
);

create table if not exists public.hr_document_assignments (
  document_id  uuid not null references public.hr_documents(id) on delete cascade,
  employee_id  uuid not null references public.tk_employees(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  primary key (document_id, employee_id)
);

-- No cascades here on purpose: an acknowledgment is a record. Deleting a
-- document or an employee that has one should fail loudly; archive the
-- document or deactivate the employee instead.
create table if not exists public.hr_acknowledgments (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null,
  version          integer not null,
  employee_id      uuid not null references public.tk_employees(id),
  acknowledged_at  timestamptz not null default now(),
  unique (document_id, version, employee_id),
  foreign key (document_id, version) references public.hr_document_versions(document_id, version)
);
create index if not exists hr_acknowledgments_employee_idx on public.hr_acknowledgments (employee_id);

create table if not exists public.hr_sessions (
  token        uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.tk_employees(id) on delete cascade,
  expires_at   timestamptz not null
);
create index if not exists hr_sessions_employee_idx on public.hr_sessions (employee_id);

alter table public.hr_documents            enable row level security;
alter table public.hr_document_versions    enable row level security;
alter table public.hr_document_assignments enable row level security;
alter table public.hr_acknowledgments      enable row level security;
alter table public.hr_sessions             enable row level security;

-- Belt and braces: RLS with no policies already denies the browser keys.
revoke all on public.hr_documents, public.hr_document_versions, public.hr_document_assignments,
              public.hr_acknowledgments, public.hr_sessions
  from anon, authenticated;

-- Publishing has to bump the version, freeze the copy and move the pointer
-- together, and two clicks must not both mint "version 3".
create or replace function public.hr_publish_document(p_document_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  update hr_documents
     set published_version = published_version + 1, updated_at = now()
   where id = p_document_id and not archived
   returning published_version into v_next;
  if v_next is null then
    raise exception 'Document not found or archived';
  end if;
  insert into hr_document_versions (document_id, version, title, body)
    select id, v_next, title, body from hr_documents where id = p_document_id;
  return v_next;
end;
$$;
revoke all on function public.hr_publish_document(uuid) from public, anon, authenticated;
grant execute on function public.hr_publish_document(uuid) to service_role;
