create table if not exists public.leaderboard_entries (
  id bigint primary key,
  rank integer not null,
  score numeric,
  team_name text not null default 'Unknown team',
  players jsonb not null default '[]'::jsonb,
  finish_time text,
  search_text text generated always as (
    lower(coalesce(team_name, '') || ' ' || coalesce(players::text, ''))
  ) stored
);

create index if not exists leaderboard_entries_rank_idx
  on public.leaderboard_entries (rank asc, id asc);

alter table public.leaderboard_entries enable row level security;

create policy "Public can read leaderboard"
  on public.leaderboard_entries
  for select
  to anon, authenticated
  using (true);

grant select on public.leaderboard_entries to anon, authenticated;

create or replace function public.get_leaderboard(
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select e.id, e.rank, e.score, e.team_name, e.players, e.finish_time
    from public.leaderboard_entries as e
    where nullif(btrim(coalesce(p_search, '')), '') is null
       or position(lower(btrim(p_search)) in e.search_text) > 0
  ),
  page_rows as (
    select f.id, f.rank, f.score, f.team_name, f.players, f.finish_time
    from filtered as f
    order by f.rank asc, f.id asc
    limit least(greatest(coalesce(p_page_size, 10), 1), 100)
    offset (greatest(coalesce(p_page, 1), 1) - 1)
      * least(greatest(coalesce(p_page_size, 10), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(page_rows) order by page_rows.rank asc, page_rows.id asc) from page_rows),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_leaderboard(text, integer, integer) from public;
grant execute on function public.get_leaderboard(text, integer, integer) to anon, authenticated;
