# Falcorp DAC Automation

Static Supabase portal for collecting weekly `.docx` reports and generating monthly Delivery Acceptance Certificate (DAC) documents.

## What It Does

- Team leads sign in and upload weekly report documents.
- A Supabase database webhook calls `parse-report` to parse each DOCX into structured rows.
- Managers can generate a monthly DAC for a selected reporting period.
- `generate-dac` builds a source-grounded narrative, creates a `.docx`, stores it, and can email it to configured recipients.
- Generated DAC records and files are restricted to managers.

## Project Map

- `frontend/index.html` - static portal; no build step.
- `sql/` - schema, storage policies, and monthly cron setup.
- `supabase/functions/` - deployable Supabase Edge Functions.
- `edge-functions/` - mirrored copy of the Edge Functions for manual/reference workflows.
- `docs/` - deployment notes and live SQL checks.
- `.github/workflows/` - CI plus GitHub Pages/Supabase deployment.

## Setup

Use `SETUP.md` for the full deployment guide. Keep Supabase public sign-up disabled, create users by invitation, and assign roles through the `profiles` table.
