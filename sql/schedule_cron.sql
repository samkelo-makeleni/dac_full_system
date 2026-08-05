-- =====================================================================
-- Falcorp DAC Automation — Monthly Schedule
-- Run AFTER deploying the generate-dac edge function.
-- Requires the pg_cron and pg_net extensions (enable via
-- Database -> Extensions in the Supabase dashboard, or the lines below).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Runs at 06:00 UTC on the 1st of every month, calling generate-dac
-- with the service role key so it passes the "isServiceRoleCall" check
-- in the edge function. Replace YOUR-SERVICE-ROLE-KEY below with your
-- actual service role key (Project Settings -> API).
select cron.schedule(
  'generate-monthly-dac',
  '0 6 1 * *',  -- minute hour day month weekday
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

-- To check scheduled jobs:
--   select * from cron.job;
-- To remove the schedule:
--   select cron.unschedule('generate-monthly-dac');

-- Also useful: a Database Webhook (not SQL — set up in the dashboard
-- under Database -> Webhooks) that fires the parse-report function on
-- every INSERT into public.weekly_reports. This is the trigger that
-- makes each uploaded file get parsed automatically within seconds.
-- Webhook config:
--   Table: weekly_reports
--   Events: Insert
--   Type: Supabase Edge Function
--   Function: parse-report
