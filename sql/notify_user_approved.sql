-- =====================================================================
-- Falcorp DAC Automation - User approval notification trigger
-- Run this in Supabase SQL Editor after deploying notify-user-approved.
-- Replace YOUR-APPROVAL-WEBHOOK-SECRET with the same value saved in
-- Supabase Edge Function secrets as APPROVAL_WEBHOOK_SECRET.
-- =====================================================================

create extension if not exists pg_net;

create or replace function public.notify_user_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform net.http_post(
      url := 'https://lrqvvxxhaxakmhnvrlbn.supabase.co/functions/v1/notify-user-approved',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', 'YOUR-APPROVAL-WEBHOOK-SECRET'
      ),
      body := jsonb_build_object(
        'profileId', new.id,
        'fullName', new.full_name,
        'role', new.role
      )
    );
  elsif old.role is distinct from new.role
    or old.full_name is distinct from new.full_name
  then
    perform net.http_post(
      url := 'https://lrqvvxxhaxakmhnvrlbn.supabase.co/functions/v1/notify-user-approved',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', 'YOUR-APPROVAL-WEBHOOK-SECRET'
      ),
      body := jsonb_build_object(
        'profileId', new.id,
        'fullName', new.full_name,
        'role', new.role
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_approved on public.profiles;

create trigger on_profile_approved
after insert or update of full_name, role on public.profiles
for each row execute procedure public.notify_user_approved();
