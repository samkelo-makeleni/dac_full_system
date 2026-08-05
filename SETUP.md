# Falcorp DAC Automation — Full Setup Guide

This turns the DAC process into a self-running pipeline:

**Team Lead uploads weekly report → auto-parsed → on the 1st of the month, the DAC narrative is built from the parsed reports → docx is generated → stored → visible to Managers.**

Estimated setup time: 1–2 hours if this is your first time with Supabase.

---

## 0. What you'll need

- A Supabase account (free tier is enough to start): https://supabase.com
- A Resend API key and verified sending domain/address (for emailing generated DACs): https://resend.com
- The Supabase CLI installed locally: `npm install -g supabase`
- A place to host the frontend `index.html` (Netlify, Vercel, or even Supabase Storage as a static site — any will do)

---

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Name it (e.g. `falcorp-dac`), set a strong database password (save it somewhere), choose a region close to your team.
3. Wait ~2 minutes for it to provision.
4. Note down, from **Project Settings → API**:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **anon public key**
   - **service_role key** (keep this secret — never put it in the frontend)

---

## 2. Run the database schema

1. In the dashboard, go to **SQL Editor → New query**.
2. Paste the contents of `sql/schema.sql` and run it.
3. New query again, paste `sql/storage_policies.sql`, run it.

This creates:
- `profiles` (roles: `team_lead` / `manager`)
- `weekly_reports` (uploaded file metadata)
- `weekly_entries` (parsed structured data)
- `generated_dacs` (finished monthly DACs)
- The `weekly-reports` and `generated-dacs` storage buckets, with access locked to authenticated team leads/managers only.

---

## 3. Add your Team Leads and Managers

There's no public sign-up — access is invite-only, added by you.

For each person:
1. Dashboard → **Authentication → Users → Add user** (set email + a temporary password, or use "send invite email" if you've set up email).
2. Copy their new **User UID**.
3. SQL Editor:
   ```sql
   insert into public.profiles (id, full_name, role)
   values ('paste-user-uid-here', 'Boipelo Motshabi', 'team_lead');
   ```
   Use `'manager'` for managers (e.g. Eben le Roux, Tabea Phele).

Repeat for everyone who needs access.

---

## 4. Set up the Edge Functions

1. Log in to the CLI and link the project:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   ```
2. Copy this whole `edge-functions/` folder into a new `supabase/functions/` folder in your local project (the CLI expects `supabase/functions/<name>/index.ts`):
   ```
   mkdir -p supabase/functions
   cp -r edge-functions/parse-report supabase/functions/
   cp -r edge-functions/generate-dac supabase/functions/
   cp -r edge-functions/_shared supabase/functions/_shared
   ```
3. Set the secrets the functions need:
   ```
   supabase secrets set RESEND_API_KEY=re_your-real-resend-key-here
   supabase secrets set DAC_EMAIL_FROM="Falcorp DAC Portal <samkelo.makeleni@falcorp.co.za>"
   supabase secrets set DAC_MANAGER_EMAIL="lrouxe1@telkom.co.za,samkelo.makeleni@falcorp.co.za"
   supabase secrets set OPENAI_API_KEY=sk-your-openai-key-here
   supabase secrets set OPENAI_MODEL=gpt-5
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to edge functions — no need to set them manually.)
   The deployed Supabase Edge Functions use OpenAI's HTTPS Responses API directly because they run on Deno/TypeScript.
4. Deploy both functions:
   ```
   supabase functions deploy parse-report --no-verify-jwt
   supabase functions deploy generate-dac --no-verify-jwt
   ```

---

## 5. Wire up automatic parsing (Database Webhook)

1. Dashboard → **Database → Webhooks → Create a new hook**.
2. Table: `weekly_reports`. Events: `Insert`.
3. Type: **Supabase Edge Function**. Function: `parse-report`.
4. Save.

Now every new row in `weekly_reports` (i.e. every upload) automatically triggers parsing within seconds.

---

## 6. Schedule the monthly generation (pg_cron)

1. Dashboard → **Database → Extensions** → enable `pg_cron` and `pg_net` (or just run the `create extension` lines in `sql/schedule_cron.sql`).
2. Open `sql/schedule_cron.sql`, replace the two placeholders:
   - `YOUR-PROJECT-REF` → your actual project ref
   - `YOUR-SERVICE-ROLE-KEY` → your service_role key
3. Run it in the SQL Editor.

This runs on the 1st of every month at 06:00 UTC, generating the DAC for the *previous* month automatically.

To test it immediately without waiting for the 1st, just call the function manually (see step 8).

---

## 7. Deploy the frontend

1. Open `frontend/index.html`, fill in near the top:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   ```
   (Use the **anon** key here — never the service_role key, since this file is public.)
2. Deploy it anywhere static:
   - **Netlify**: drag the `frontend` folder onto https://app.netlify.com/drop
   - **Vercel**: `vercel deploy` from inside the `frontend` folder
   - Or literally just open `index.html` locally to test first.
3. Share the URL with your Team Leads and Managers.

---

## 8. Test the whole pipeline end-to-end

1. Log in as a team lead → upload a `.docx` weekly report with a `week_start` date.
2. Wait ~10–30 seconds, refresh — status should flip to "Parsed ✓". If it shows an error, check **Edge Functions → parse-report → Logs** in the dashboard.
3. Log in as a manager → click **Generate DAC now**, optionally picking a specific month.
4. After the DAC is generated, a new row should appear in the Generated DACs table with a **Download** link.
5. Open the downloaded `.docx` and check it looks right.

---

## 9. Ongoing operation

- Team Leads upload every week, whenever their report is ready.
- Parsing happens automatically per upload.
- On the 1st of each month, the previous month's DAC is generated automatically — no one needs to do anything.
- Managers can always trigger an extra/regenerated run via the "Generate DAC now" button (e.g. if a late report came in after the automatic run).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Upload shows "Pending…" forever | Database Webhook not set up, or `parse-report` erroring | Check Edge Functions logs; check Webhook is enabled |
| `parse-report` error: "download failed" | Storage RLS policy issue | Re-check `storage_policies.sql` ran successfully |
| Generate DAC now → 403 | Logged-in user's profile role isn't `manager` | Fix their row in `public.profiles` |
| Generate DAC → "No weekly reports found" | No reports with `week_start` in that month, or none parsed yet | Check `weekly_reports` table for that date range |
| Generate DAC contains fewer details than expected | Weekly report tables were empty or did not match the expected template | Check the parsed `weekly_entries` rows and the uploaded report format |
| docx looks broken / won't open | `npm:docx` version mismatch in Deno | Pin the exact version already specified (`docx@9.6.1`) |

---

## File map

```
sql/
  schema.sql              — tables + RLS (run first)
  storage_policies.sql    — bucket creation + storage RLS (run second)
  schedule_cron.sql        — monthly automation (run after functions are deployed)

edge-functions/
  _shared/
    docx_parser.ts         — docx -> structured JSON (the parsing engine)
    dac_template.ts         — structured JSON -> finished docx (the layout engine)
    write_narrative.ts      — builds narrative sections from parsed report rows
    dac_config.ts            — fixed project/company details (edit if these ever change)
    logo_base64.ts           — embedded Falcorp logo
  parse-report/index.ts     — runs on every upload
  generate-dac/index.ts     — runs monthly (or on-demand)

frontend/
  index.html                — the whole portal (login, upload, dashboard) — no build step

test/
  docx_parser_prototype.js  — the Node prototype used to validate the parsing logic
                               against real weekly reports before porting to Deno
```
