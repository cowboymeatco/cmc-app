-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 of 2 — helper functions + RPCs.  ADDITIVE AND SAFE.
--
-- APPLIED 2026-08-10 (migration rls_customers_phase1_functions). Verified after:
-- all five functions exist, prosecdef = true, search_path pinned to public,
-- anon has no EXECUTE, authenticated does.
--
-- Run this FIRST, on its own.  It changes no permissions and no rows: it only
-- creates functions.  Nothing behaves differently until the app code that calls
-- them is deployed, and nothing locks down until phase 2 runs.
--
-- WHY THESE EXIST
-- Two portal paths legitimately need to touch customer rows that are NOT the
-- signed-in user's own.  Today they do it by reading the whole table from the
-- browser.  Under RLS that is exactly what we want to stop, so the two paths
-- move into SECURITY DEFINER functions: the function runs with the owner's
-- rights (bypassing RLS), but it only ever returns the one answer the UI needs
-- instead of handing the browser the table.
--
-- SECURITY DEFINER notes: every function pins `search_path` so a caller cannot
-- shadow `public` with their own schema, and every one re-derives the caller
-- from auth.uid() rather than trusting an argument.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Who is asking? ───────────────────────────────────────────────────────────
-- Both helpers are SECURITY DEFINER on purpose.  A policy on `customers` that
-- queried `customers` directly would recurse forever; reading it through a
-- definer function does not re-enter the policy.

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.customers where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_staff from public.customers where auth_user_id = auth.uid() limit 1),
    false
  )
$$;

comment on function public.current_customer_id() is
  'The customers.id of the signed-in user, or null. SECURITY DEFINER so RLS policies on customers can call it without recursing.';
comment on function public.is_staff() is
  'True when the signed-in user has customers.is_staff. SECURITY DEFINER — see current_customer_id().';


-- ── Profile setup: claim or create this login''s customer row ────────────────
-- Replaces the browser-side full-table scan in apps/portal/app/profile/setup.
-- That code pulled all 327 rows'' phone + email into the browser to find the
-- row this login should claim.  The matching rule is unchanged and moves here
-- verbatim: a row already tied to this login wins; otherwise match an UNCLAIMED
-- row on 10-digit phone, then on email.  Rows claimed by another login are
-- never up for grabs.
--
-- The email is taken from the JWT, not from an argument, so a caller cannot
-- claim a row by asserting someone else''s address.

create or replace function public.claim_customer_profile(
  p_name       text,
  p_ranch_name text,
  p_phone      text,
  p_role       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text := nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_digits text;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Same normalisation the TypeScript used: keep digits, drop a leading US 1.
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := right(v_digits, 10);
  end if;

  -- 1. A row already tied to this login always wins.
  select id into v_id from public.customers where auth_user_id = v_uid limit 1;

  -- 2. Otherwise an UNCLAIMED row matching on phone digits, then on email.
  if v_id is null and length(v_digits) >= 10 then
    select id into v_id
    from public.customers
    where auth_user_id is null
      and length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
      and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10)
    limit 1;
  end if;

  if v_id is null and v_email is not null then
    select id into v_id
    from public.customers
    where auth_user_id is null
      and lower(trim(coalesce(email, ''))) = v_email
    limit 1;
  end if;

  if v_id is not null then
    update public.customers
       set name         = p_name,
           ranch_name   = p_ranch_name,
           phone        = p_phone,
           role         = p_role,
           auth_user_id = v_uid,
           updated_at   = now()
     where id = v_id;
  else
    insert into public.customers (name, ranch_name, phone, email, role, auth_user_id)
    values (p_name, p_ranch_name, p_phone, coalesce(v_email, ''), p_role, v_uid)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

comment on function public.claim_customer_profile(text, text, text, text) is
  'Profile setup. Claims an unclaimed customer row by phone/email or creates one, and ties it to auth.uid(). Replaces a browser-side full-table read of phone+email.';


-- ── Splits: look up / create the buyer of a share of MY animal ───────────────
-- Replaces two browser-side queries in animals/[id]/splits/SplitsClient.tsx:
-- an unrestricted phone search across all customers, and an unrestricted insert.
--
-- Both now require the caller to be the PRODUCER OF THAT APPOINTMENT, which the
-- function verifies itself.  Without that check any signed-in user could walk
-- the customer list a phone number at a time.

create or replace function public.find_split_buyer(
  p_appointment_id text,
  p_phone          text
)
returns table (id uuid, name text, phone text, ranch_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := public.current_customer_id();
  v_digits text;
begin
  if v_me is null then
    raise exception 'no customer record for this login' using errcode = '42501';
  end if;

  -- Only the producer of this animal may look buyers up through it.
  if not exists (
    select 1 from public.harvest_appointments ha
    where ha.id = p_appointment_id and ha.producer_id = v_me
  ) then
    raise exception 'not your animal' using errcode = '42501';
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) < 10 then
    return;  -- too short to identify anybody; return no rows
  end if;

  return query
    select c.id, c.name, c.phone, c.ranch_name
    from public.customers c
    where length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 10
      and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = v_digits
    limit 1;
end;
$$;

create or replace function public.create_split_buyer(
  p_appointment_id text,
  p_name           text,
  p_phone          text
)
returns table (id uuid, name text, phone text, ranch_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := public.current_customer_id();
  v_new uuid;
begin
  if v_me is null then
    raise exception 'no customer record for this login' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.harvest_appointments ha
    where ha.id = p_appointment_id and ha.producer_id = v_me
  ) then
    raise exception 'not your animal' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'buyer name required' using errcode = '22023';
  end if;

  insert into public.customers (name, phone, role)
  values (trim(p_name), regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 'customer')
  returning customers.id into v_new;

  return query
    select c.id, c.name, c.phone, c.ranch_name from public.customers c where c.id = v_new;
end;
$$;

comment on function public.find_split_buyer(text, text) is
  'Split buyer lookup by phone, restricted to the producer of that appointment. Returns at most one minimal row.';
comment on function public.create_split_buyer(text, text, text) is
  'Creates a placeholder buyer for a split on the caller''s own animal.';


-- ── Who may call these ───────────────────────────────────────────────────────
-- Signed-in users only.  anon gets nothing: the portal requires a session for
-- every path that reaches these.

revoke all on function public.current_customer_id()                    from public, anon;
revoke all on function public.is_staff()                               from public, anon;
revoke all on function public.claim_customer_profile(text,text,text,text) from public, anon;
revoke all on function public.find_split_buyer(text, text)             from public, anon;
revoke all on function public.create_split_buyer(text, text, text)     from public, anon;

grant execute on function public.current_customer_id()                    to authenticated;
grant execute on function public.is_staff()                               to authenticated;
grant execute on function public.claim_customer_profile(text,text,text,text) to authenticated;
grant execute on function public.find_split_buyer(text, text)             to authenticated;
grant execute on function public.create_split_buyer(text, text, text)     to authenticated;
