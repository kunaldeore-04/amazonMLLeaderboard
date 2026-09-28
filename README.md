# Rankroom

An Unstop competition leaderboard built with React and Vite, with server-side search and pagination through Supabase. The current JSON export contains 10,942 entries.

## Run locally

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and keys.
3. Apply `supabase/migrations/202609290001_leaderboard.sql` in the Supabase SQL Editor.
4. Import the dataset with `npm run import:leaderboard`.
5. Start the app with `npm run dev`.

For local UI work before creating a Supabase project, leave the environment values unset and run `npm run dev`. Vite uses the bundled JSON as a development-only fallback; the deployed app requires Supabase configuration.

## Supabase keys

The browser only uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (a publishable/anon key). `SUPABASE_SERVICE_ROLE_KEY` is used only by the local import script. Never put the service role key in a `VITE_` variable or in Vercel's client-exposed environment variables.

The migration enables read-only row level security for the public leaderboard and exposes `get_leaderboard`, which returns one page and the matching row count. The import script sends 500 rows per request and upserts by entry ID.

## Vercel

The project is structured as a Vite app and can be imported into Vercel when you're ready. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables before deploying. Do not add `SUPABASE_SERVICE_ROLE_KEY` to the frontend deployment; it is only needed locally when importing data.
