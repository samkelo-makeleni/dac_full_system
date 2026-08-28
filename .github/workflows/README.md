# GitHub Actions

This project uses two workflows:

- `CI`: runs on pull requests and pushes to `main`, checks the Supabase Edge Functions with Deno, and verifies the required SQL/frontend files.
- `Deploy`: runs on pushes to `main` and manual dispatch. It deploys the static frontend to GitHub Pages and deploys Supabase Edge Functions when the required Supabase configuration exists.

## Required GitHub Configuration

For Supabase Edge Function deployment, add:

- Repository variable: `SUPABASE_PROJECT_REF`
- Repository secret: `SUPABASE_ACCESS_TOKEN`

The Supabase function runtime secrets still need to be configured in Supabase:

- `RESEND_API_KEY`
- `DAC_EMAIL_FROM`
- `DAC_MANAGER_EMAIL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `APPROVAL_WEBHOOK_SECRET` if you use the `notify-user-approved` SQL trigger.

For GitHub Pages, set the repository Pages source to `GitHub Actions`.
