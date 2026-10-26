# Expense Tracker MVP

A responsive expense-tracking application built with React, TypeScript, and Vite, backed by FastAPI and Supabase Auth/Postgres. Demo mode remains available when credentials are not configured.

## Features

- Email sign-in, account creation, and password recovery through Supabase Auth
- Personal and organization workspace data protected by PostgreSQL RLS
- Transaction create, edit, delete, search, date filtering, and CSV export
- Bank statement PDF import with in-browser text extraction and a review step before saving
- Monthly budgets, dashboard totals, category breakdowns, and spending trends
- Support requests with threaded replies; platform support staff can triage and answer queries across workspaces
- Fictional demo data stored locally only in demo mode

PDF statement import currently supports text-selectable statements. Scanned/image-only statements are not OCR-processed. The PDF is parsed in the browser; only rows you review and import are sent to the authenticated API.

## Windows Setup

Install Node.js and Python 3.11 or newer. Copy the environment template.

Command Prompt:

```cmd
copy .env.example .env
npm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

PowerShell:

```powershell
Copy-Item .env.example .env
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Paste your Supabase project URL and **anon/public key** into both matching variables in `.env`. Never put a service-role key in a `VITE_*` variable or browser code. In Supabase, run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor, enable email authentication, and set the local redirect URL to `http://localhost:5173`. If the database schema was installed before statement-import support was added, run [`supabase/migrations/20261008110000_transaction_import_fingerprint.sql`](supabase/migrations/20261008110000_transaction_import_fingerprint.sql) in the SQL Editor before importing statements. If the database schema was already installed, run [`supabase/seed_default_categories.sql`](supabase/seed_default_categories.sql) once to add the expanded default categories to existing personal and organization workspaces.

Account creation uses Supabase's email confirmation link. Keep the `{{ .ConfirmationURL }}` link in **Authentication → Email Templates → Confirm signup**. Set the allowed redirect URL to the app's address so users return to the app after confirming.

If organization creation fails with a row-level security error, run [`supabase/migrations/20261009131000_create_organization_rpc.sql`](supabase/migrations/20261009131000_create_organization_rpc.sql) in the Supabase SQL Editor. This creates an authenticated database function that sets the creator from the verified Supabase user.

To use organization member management, replace the `SUPABASE_SERVICE_ROLE_KEY` placeholder in the project-root `.env` with the `service_role` key from your Supabase project's API settings. Keep this key out of all `VITE_*` variables and never expose it in the browser. Ensure `SUPABASE_URL` points to the same project. Restart the API after changing `.env`, then run [`supabase/migrations/20261009140000_admin_member_management.sql`](supabase/migrations/20261009140000_admin_member_management.sql) in the SQL Editor. Owners can invite members or admins; admins can invite members. New users receive an email invitation; an already registered user is added directly to the organization.

Invitation email delivery is handled by Supabase Auth, not the app. For reliable delivery to users outside your Supabase project's team, configure a custom SMTP provider under **Authentication → SMTP Settings** and check its delivery logs, spam folder, and recipient address when an invite is missing. Add the app URL to **Authentication → URL Configuration → Redirect URLs**. Optionally set `SUPABASE_AUTH_REDIRECT_URL` in the backend environment to the URL where invitees should land after accepting (for example, `http://localhost:5173` during local development); restart the backend after changing it.

The cross-workspace Support inbox is available only to trusted platform support staff. Grant access by adding the staff user's authenticated profile ID to `public.platform_admins` using a trusted database administrator. Do not expose a service-role key or allow users to grant themselves platform-admin access.

If categories are missing from transaction or statement-import selectors, run [`supabase/migrations/20261009160000_seed_existing_workspace_categories.sql`](supabase/migrations/20261009160000_seed_existing_workspace_categories.sql) in the SQL Editor, then reload the app. It fills missing default categories for existing personal and organization workspaces without duplicating categories that are already present.

Statement imports automatically match common merchants and descriptions to categories. Transactions that do not match a specific rule are assigned to `Other expenses` or `Other income`; review and change any suggestion before importing. To add these fallback categories to existing workspaces, run [`supabase/migrations/20261009161500_add_other_categories.sql`](supabase/migrations/20261009161500_add_other_categories.sql) in the SQL Editor.

On app load, the API also assigns categories to existing uncategorized transactions in the selected workspace. Existing workspaces need the category-seeding migrations above applied, and the backend must be restarted after code updates for this backfill to run.

Start the app from the project root. This starts both the Vite frontend and the FastAPI service:

Command Prompt:

```cmd
npm run dev
```

PowerShell:

```powershell
npm run dev
```

The frontend runs at `http://localhost:5173`; the API docs are at `http://localhost:8000/docs`. To start only the frontend, use `npm run dev:frontend` and run `npm run api:dev` in another terminal.

## Available Scripts

```text
npm run dev
npm run build
npm run test
npm run lint
npm run api:install
npm run api:dev
npm run test:api
```

`npm run api:dev` and `npm run test:api` use the `python` executable on `PATH`. If that launcher is not discoverable, run `.venv\Scripts\python.exe -m uvicorn backend.main:app --reload` and `.venv\Scripts\python.exe -m pytest` instead.

Without Supabase credentials the app opens in demo mode. Real signup, authentication, and API persistence require a configured Supabase project and the schema migration above. Normal FastAPI requests use the anon key plus the signed-in user's bearer token; database RLS remains the authorization boundary. The service-role key is used only by the backend invitation flow and must remain server-side.

The frontend (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) and backend (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) must point to the same Supabase project and use that project's anon/public key. If authentication reports an invalid or expired token, confirm those settings, restart both servers after changing `.env`, and sign in again. The frontend automatically refreshes and retries requests when an access token expires.

## Project Structure

- `src/features/auth/`: authentication and password recovery screens
- `src/lib/`: Supabase client and typed FastAPI client
- `src/utils/`: finance calculations
- `backend/`: FastAPI endpoints and request validation
- `supabase/schema.sql`: relational schema, indexes, triggers, and RLS policies
