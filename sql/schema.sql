-- =====================================================================
-- Falcorp DAC Automation — Database Schema
-- Run this in Supabase SQL Editor (Project -> SQL Editor -> New query)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Roles & Profiles
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('team_lead', 'manager');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auth users are not automatically approved for portal access. An admin must
  -- create/update public.profiles with the intended role after inviting a user.
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Everyone who is logged in can see the list of approved profiles.
create policy "profiles readable by any authenticated user"
  on public.profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "trigger can create profile row" on public.profiles;
drop policy if exists "users can create own team lead profile" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "users can delete own profile" on public.profiles;


-- ---------------------------------------------------------------------
-- 2. Weekly report uploads (raw file + metadata)
-- ---------------------------------------------------------------------
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles(id),
  person_name text not null,          -- name on the report (may differ from uploader)
  week_start date not null,
  project text,                        -- e.g. "Telkom CSB"
  storage_path text not null,          -- path inside the 'weekly-reports' bucket
  parsed boolean not null default false,
  parse_error text,
  created_at timestamptz not null default now()
);

alter table public.weekly_reports enable row level security;

-- Team leads can insert their own uploads; managers can see everything;
-- team leads can see their own uploads only.
drop policy if exists "team leads insert own reports" on public.weekly_reports;
drop policy if exists "team leads see own reports, managers see all" on public.weekly_reports;
drop policy if exists "team leads delete own reports, managers delete all" on public.weekly_reports;

create policy "team leads insert own reports"
  on public.weekly_reports for insert
  with check (
    auth.uid() is not null
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('team_lead','manager')
    )
  );

create policy "team leads see own reports, managers see all"
  on public.weekly_reports for select
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );

create policy "team leads delete own reports, managers delete all"
  on public.weekly_reports for delete
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );


-- ---------------------------------------------------------------------
-- 3. Parsed structured entries (one row per weekly_report, JSON payload)
-- ---------------------------------------------------------------------
create table if not exists public.weekly_entries (
  id uuid primary key default gen_random_uuid(),
  weekly_report_id uuid not null references public.weekly_reports(id) on delete cascade,
  activities jsonb not null default '[]',
  risks jsonb not null default '[]',
  knowledge_transfer jsonb not null default '[]',
  continuous_improvement jsonb not null default '[]',
  continuous_learning jsonb not null default '[]',
  ai_efficiency jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.weekly_entries enable row level security;

create policy "readable if underlying report is readable"
  on public.weekly_entries for select
  using (
    exists (
      select 1 from public.weekly_reports wr
      where wr.id = weekly_report_id
        and (
          wr.uploaded_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
        )
    )
  );

-- Only the parse-report edge function (using the service role key, which
-- bypasses RLS) writes to this table, so no insert policy is needed for
-- regular users.


-- ---------------------------------------------------------------------
-- 4. Generated monthly DACs
-- ---------------------------------------------------------------------
create table if not exists public.generated_dacs (
  id uuid primary key default gen_random_uuid(),
  reporting_period text not null,      -- e.g. "August 2026"
  period_start date not null,
  period_end date not null,
  storage_path text not null,          -- path inside 'generated-dacs' bucket
  generated_at timestamptz not null default now(),
  generated_by text not null default 'automated'  -- 'automated' or a user id/name
);

alter table public.generated_dacs enable row level security;

drop policy if exists "managers and team leads can read generated dacs" on public.generated_dacs;
drop policy if exists "managers can read generated dacs" on public.generated_dacs;

create policy "managers can read generated dacs"
  on public.generated_dacs for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );


-- ---------------------------------------------------------------------
-- 5. Helpful index for the monthly generation job
-- ---------------------------------------------------------------------
create index weekly_reports_week_start_idx on public.weekly_reports (week_start);
create index weekly_entries_report_id_idx on public.weekly_entries (weekly_report_id);
