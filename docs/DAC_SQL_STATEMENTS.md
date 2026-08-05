# DAC System SQL Statements

This document collects the SQL used by the Falcorp DAC automation app and records the live Supabase checks run against the linked project.

Linked Supabase project checked:

- Project name: `DAC_SYSTEM`
- Project ref: `lrqvvxxhaxakmhnvrlbn`
- Status: `ACTIVE_HEALTHY`

Live database check summary:

- Expected public tables exist: `profiles`, `weekly_reports`, `weekly_entries`, `generated_dacs`.
- Expected storage buckets exist and are private: `weekly-reports`, `generated-dacs`.
- Live RLS policies exist for the public app tables.
- Live storage policies include two temporary broad weekly-report policies not present in the repo SQL:
  - `temp allow any authenticated user read weekly reports`
  - `temp allow any authenticated user upload weekly reports`
- `pg_cron` and `pg_net` were enabled on the live project after this document was first created.
- `cron.job` exists, but no monthly DAC job is scheduled yet. The service-role key placeholder must be replaced before running the schedule SQL.

## 1. Database Schema

Source file: `sql/schema.sql`

```sql
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
declare
  v_full_name text;
  v_role public.user_role;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  v_role := case
    when new.raw_user_meta_data->>'role' in ('team_lead', 'manager')
      then (new.raw_user_meta_data->>'role')::public.user_role
    else 'team_lead'
  end;

  insert into public.profiles (id, full_name, role)
  values (new.id, v_full_name, v_role)
  on conflict (id) do update
    set full_name = excluded.full_name,
        role = excluded.role;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create policy "profiles readable by any authenticated user"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "trigger can create profile row"
  on public.profiles for insert
  with check (true);

create policy "users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users can delete own profile"
  on public.profiles for delete
  using (id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. Weekly report uploads (raw file + metadata)
-- ---------------------------------------------------------------------
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles(id),
  person_name text not null,
  week_start date not null,
  project text,
  storage_path text not null,
  parsed boolean not null default false,
  parse_error text,
  created_at timestamptz not null default now()
);

alter table public.weekly_reports enable row level security;

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

-- ---------------------------------------------------------------------
-- 4. Generated monthly DACs
-- ---------------------------------------------------------------------
create table if not exists public.generated_dacs (
  id uuid primary key default gen_random_uuid(),
  reporting_period text not null,
  period_start date not null,
  period_end date not null,
  storage_path text not null,
  generated_at timestamptz not null default now(),
  generated_by text not null default 'automated'
);

alter table public.generated_dacs enable row level security;

create policy "managers and team leads can read generated dacs"
  on public.generated_dacs for select
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- 5. Helpful index for the monthly generation job
-- ---------------------------------------------------------------------
create index weekly_reports_week_start_idx on public.weekly_reports (week_start);
create index weekly_entries_report_id_idx on public.weekly_entries (weekly_report_id);
```

## 2. Storage Buckets And Policies

Source file: `sql/storage_policies.sql`

```sql
-- =====================================================================
-- Falcorp DAC Automation — Storage Buckets & Policies
-- Run AFTER schema.sql, in the same SQL Editor.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('weekly-reports', 'weekly-reports', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('generated-dacs', 'generated-dacs', false)
on conflict (id) do nothing;

drop policy if exists "authenticated team leads/managers can upload weekly reports" on storage.objects;
drop policy if exists "authenticated team leads/managers can update weekly reports" on storage.objects;
drop policy if exists "authenticated team leads/managers can read weekly reports" on storage.objects;
drop policy if exists "authenticated team leads/managers can delete weekly reports" on storage.objects;

create policy "authenticated team leads/managers can upload weekly reports"
  on storage.objects for insert
  with check (
    bucket_id = 'weekly-reports'
    and auth.uid() is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('team_lead', 'manager')
    )
  );

create policy "authenticated team leads/managers can update weekly reports"
  on storage.objects for update
  using (
    bucket_id = 'weekly-reports'
    and auth.uid() is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('team_lead', 'manager')
    )
  )
  with check (
    bucket_id = 'weekly-reports'
    and auth.uid() is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('team_lead', 'manager')
    )
  );

create policy "authenticated team leads/managers can read weekly reports"
  on storage.objects for select
  using (
    bucket_id = 'weekly-reports'
    and auth.uid() is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('team_lead', 'manager')
    )
  );

create policy "authenticated team leads/managers can delete weekly reports"
  on storage.objects for delete
  using (
    bucket_id = 'weekly-reports'
    and auth.uid() is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('team_lead', 'manager')
    )
  );

drop policy if exists "authenticated users can read generated dacs" on storage.objects;

create policy "authenticated users can read generated dacs"
  on storage.objects for select
  using (
    bucket_id = 'generated-dacs'
    and auth.role() = 'authenticated'
  );
```

## 3. Monthly Schedule

Source file: `sql/schedule_cron.sql`

Live status: `pg_cron` and `pg_net` are enabled, but no monthly DAC job is scheduled yet. Replace `YOUR-SERVICE-ROLE-KEY`, then run the schedule SQL.

```sql
-- =====================================================================
-- Falcorp DAC Automation — Monthly Schedule
-- Run AFTER deploying the generate-dac edge function.
-- Requires the pg_cron and pg_net extensions.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'generate-monthly-dac',
  '0 6 1 * *',
  $$
  select net.http_post(
    url := 'https://lrqvvxxhaxakmhnvrlbn.functions.supabase.co/generate-dac',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

select * from cron.job;

select cron.unschedule('generate-monthly-dac');
```

Do not place the real service-role key in this document.

## 4. Live Supabase Verification Queries

These are the SQL queries used to check the live project.

```sql
select
  to_regclass('public.profiles') as profiles,
  to_regclass('public.weekly_reports') as weekly_reports,
  to_regclass('public.weekly_entries') as weekly_entries,
  to_regclass('public.generated_dacs') as generated_dacs;
```

```sql
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;
```

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public','storage')
order by schemaname, tablename, policyname;
```

```sql
select jobid, schedule, command, active, jobname
from cron.job
order by jobid;
```

## 5. Live Policy Findings

The live database returned these notable policies:

- `public.generated_dacs`: `managers and team leads can read generated dacs`
- `public.profiles`: `profiles readable by any authenticated user`
- `public.weekly_entries`: `readable if underlying report is readable`
- `public.weekly_reports`: `team leads insert own reports`
- `public.weekly_reports`: `team leads see own reports, managers see all`
- `storage.objects`: `authenticated team leads/managers can update weekly reports`
- `storage.objects`: `authenticated users can read generated dacs`
- `storage.objects`: `temp allow any authenticated user read weekly reports`
- `storage.objects`: `temp allow any authenticated user upload weekly reports`

Recommended cleanup:

```sql
drop policy if exists "temp allow any authenticated user read weekly reports" on storage.objects;
drop policy if exists "temp allow any authenticated user upload weekly reports" on storage.objects;
```

Only run that cleanup after confirming uploads still work with the stricter team-lead/manager storage policies.

## 6. Useful Admin Queries

List reports and parse status:

```sql
select
  id,
  person_name,
  week_start,
  storage_path,
  parsed,
  parse_error,
  created_at
from public.weekly_reports
order by week_start desc, created_at desc;
```

Check parsed entry sizes:

```sql
select
  wr.person_name,
  wr.week_start,
  jsonb_array_length(coalesce(we.activities, '[]'::jsonb)) as activity_count,
  jsonb_array_length(coalesce(we.risks, '[]'::jsonb)) as risk_count,
  jsonb_array_length(coalesce(we.knowledge_transfer, '[]'::jsonb)) as knowledge_transfer_count,
  jsonb_array_length(coalesce(we.continuous_improvement, '[]'::jsonb)) as continuous_improvement_count,
  jsonb_array_length(coalesce(we.continuous_learning, '[]'::jsonb)) as continuous_learning_count,
  jsonb_array_length(coalesce(we.ai_efficiency, '[]'::jsonb)) as ai_efficiency_count
from public.weekly_reports wr
left join public.weekly_entries we on we.weekly_report_id = wr.id
order by wr.week_start desc, wr.person_name;
```

List generated DACs:

```sql
select
  id,
  reporting_period,
  period_start,
  period_end,
  storage_path,
  generated_at,
  generated_by
from public.generated_dacs
order by generated_at desc;
```

List user profiles:

```sql
select id, full_name, role, created_at
from public.profiles
order by created_at desc;
```
