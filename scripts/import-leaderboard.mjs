import { readFile } from 'node:fs/promises';

const sourcePath = new URL('../unstop_all_teams.json', import.meta.url);
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const batchSize = 500;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (!Array.isArray(source)) throw new Error('Expected unstop_all_teams.json to contain an array.');

const rows = source.map((entry) => {
  const rank = Number(entry.rank);
  const score = entry.score === null || entry.score === undefined ? null : Number(entry.score);
  const players = Array.isArray(entry.team?.players)
    ? entry.team.players.map((player) => ({
      name: player.name || '',
      organisation: player.organisation || '',
    }))
    : [];

  if (!Number.isFinite(Number(entry.id)) || !Number.isInteger(rank)) {
    throw new Error(`Invalid leaderboard record (id: ${entry.id}, rank: ${entry.rank}).`);
  }

  return {
    id: Number(entry.id),
    rank,
    score: Number.isFinite(score) ? score : null,
    team_name: entry.team?.team_name || 'Unknown team',
    players,
    finish_time: entry.finish_time || null,
  };
});

const endpoint = new URL('/rest/v1/leaderboard_entries', supabaseUrl);
endpoint.searchParams.set('on_conflict', 'id');

for (let start = 0; start < rows.length; start += batchSize) {
  const batch = rows.slice(start, start + batchSize);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Import failed at row ${start + 1}: ${details}`);
  }
  console.log(`Imported ${Math.min(start + batch.length, rows.length)} / ${rows.length}`);
}

console.log(`Done. ${rows.length} leaderboard entries are available in Supabase.`);
