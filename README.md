# Amazon ML Challenge Ranking

An Unstop competition leaderboard built with React and Vite, with typo-tolerant search, keyboard-accessible suggestions, server-side pagination through Supabase, and a dark theme by default. The institute table can rank by top-10, top-50, top-100, or top-1,000 team entries. The current JSON export contains 10,942 entries.

## Run locally

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and keys.
3. Apply `supabase/migrations/202609290001_leaderboard.sql` in the Supabase SQL Editor.
4. Import the dataset with `npm run import:leaderboard`.
5. Start the app with `npm run dev`.

For an existing Supabase project, paste the contents of each newer SQL file in `supabase/migrations/` into the Supabase SQL Editor in order, then run it. The fuzzy-search migration installs `pg_trgm` and updates the paginated search RPC; the next migration adds institution rankings and top-10/50/100/1,000 counts. Re-run the institution migration after updates; it replaces the RPC used by the ranking selector.

Institute top-10/50/100/1,000 counts use exact leaderboard slots ordered by rank, score, then entry ID to break ties. Each team adds one count to every distinct institution represented by its players, including within the first 1,000 slots. Teams with players from multiple institutions count once for each listed institution, so college totals can overlap.

For local UI work before creating a Supabase project, leave the environment values unset and run `npm run dev`. Vite uses the bundled JSON as a development-only fallback; the deployed app requires Supabase configuration.

## Supabase keys

The browser only uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (a publishable/anon key). `SUPABASE_SERVICE_ROLE_KEY` is used only by the local import script. Never put the service role key in a `VITE_` variable or in Vercel's client-exposed environment variables.

The migration enables read-only row level security for the public leaderboard and exposes `get_leaderboard`, which returns one page and the matching row count. The import script sends 500 rows per request and upserts by entry ID.

## Vercel

The project is structured as a Vite app and can be imported into Vercel when you're ready. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables before deploying. Do not add `SUPABASE_SERVICE_ROLE_KEY` to the frontend deployment; it is only needed locally when importing data.
