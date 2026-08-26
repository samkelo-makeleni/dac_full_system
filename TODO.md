# TODO Notes

## Deployment And Configuration

- Schedule the monthly DAC cron job in Supabase.
  - Replace `YOUR-SERVICE-ROLE-KEY` in `sql/schedule_cron.sql`.
  - Run the SQL in the Supabase SQL Editor after `generate-dac` is deployed.
  - Verify the job exists with `select * from cron.job;`.

- Confirm GitHub Actions deployment configuration.
  - Add repository variable `SUPABASE_PROJECT_REF`.
  - Add repository secret `SUPABASE_ACCESS_TOKEN`.
  - Set GitHub Pages source to `GitHub Actions`.

- Confirm Supabase Edge Function runtime secrets are configured.
  - `RESEND_API_KEY`
  - `DAC_EMAIL_FROM`
  - `DAC_MANAGER_EMAIL`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `PARSE_REPORT_WEBHOOK_SECRET`

## Security And Policies

- Review temporary broad storage policies documented in `docs/DAC_SQL_STATEMENTS.md`.
  - `temp allow any authenticated user read weekly reports`
  - `temp allow any authenticated user upload weekly reports`
  - Remove or replace them with stricter policies once testing is complete.

- Apply the hardened auth/role SQL in `sql/schema.sql` and `sql/storage_policies.sql` to the live Supabase project.
  - Confirm public sign-up is disabled in Supabase Auth.
  - Confirm only managers can read generated DAC records/files.
  - Confirm users cannot self-assign or update their own role.

- Keep the Supabase `service_role` key out of the frontend and public docs.
  - It should only be used in Supabase SQL setup, Supabase secrets, or protected automation.

## Documentation

- Update setup documentation to reflect the current live project.
  - Replace example `YOUR-PROJECT-REF` references where appropriate.
  - Confirm the frontend deployment target is GitHub Pages.
  - Include the live website URL once GitHub Pages deployment is confirmed.

- Add GitHub Actions status badges after workflows are stable.

## Product Follow-Up

- Confirm the complete manager workflow after deployment.
  - Upload weekly reports as a team lead.
  - Confirm reports parse automatically.
  - Generate a monthly DAC as a manager.
  - Download and review the generated `.docx`.

- Confirm email delivery for generated DACs.
  - Test Resend sender/domain configuration.
  - Confirm all manager recipient addresses are correct.
