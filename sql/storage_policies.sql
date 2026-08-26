-- =====================================================================
-- Falcorp DAC Automation — Storage Buckets & Policies
-- Run AFTER schema.sql, in the same SQL Editor.
-- =====================================================================

-- Create the two storage buckets (private — not public URLs).
insert into storage.buckets (id, name, public)
values ('weekly-reports', 'weekly-reports', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('generated-dacs', 'generated-dacs', false)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- weekly-reports bucket
-- Path convention: {year}/{month}/{person-slug}/{week_start}.docx
-- e.g. 2026/08/mabente-mophuting/2026-08-03.docx
-- ---------------------------------------------------------------------

-- Team leads/managers can upload into a folder that starts with their
-- own user id, OR (simpler for this use case) any authenticated team
-- lead/manager can upload — access is already restricted at the app
-- level to approved accounts only, since there is no public signup.
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


-- ---------------------------------------------------------------------
-- generated-dacs bucket — read-only for managers; only the
-- generate-dac edge function (service role key) writes here.
-- ---------------------------------------------------------------------
drop policy if exists "authenticated users can read generated dacs" on storage.objects;
drop policy if exists "managers can read generated dacs" on storage.objects;

create policy "managers can read generated dacs"
  on storage.objects for select
  using (
    bucket_id = 'generated-dacs'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );
