drop function if exists public.get_institution_rankings(text, integer, integer);

create or replace function public.get_institution_rankings(
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 10,
  p_rank_by text default 'top1000'
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with params as (
    select
      nullif(lower(btrim(coalesce(p_search, ''))), '') as needle,
      case when p_rank_by in ('top10', 'top50', 'top100', 'top1000') then p_rank_by else 'top1000' end as rank_by
  ),
  query_terms as (
    select distinct term
    from params as p
    cross join lateral regexp_split_to_table(coalesce(p.needle, ''), '[^[:alnum:]]+') as terms(term)
    where term <> ''
  ),
  ranked_teams as (
    select
      id,
      rank as team_rank,
      row_number() over (order by rank asc, score desc nulls last, id asc) as standing_position
    from public.leaderboard_entries
  ),
  per_team as (
    select
      ranked_teams.id,
      ranked_teams.team_rank,
      ranked_teams.standing_position,
      lower(btrim(regexp_replace(player->>'organisation', '[[:space:]]+', ' ', 'g'))) as institution_key,
      min(btrim(regexp_replace(player->>'organisation', '[[:space:]]+', ' ', 'g'))) as institution_name
    from ranked_teams
    join public.leaderboard_entries as e on e.id = ranked_teams.id
    cross join lateral jsonb_array_elements(e.players) as players(player)
    where nullif(btrim(player->>'organisation'), '') is not null
      and lower(btrim(player->>'organisation')) not in ('n/a', 'na', 'unknown')
    group by
      ranked_teams.id,
      ranked_teams.team_rank,
      ranked_teams.standing_position,
      lower(btrim(regexp_replace(player->>'organisation', '[[:space:]]+', ' ', 'g')))
  ),
  aggregates as (
    select
      per_team.institution_key,
      min(per_team.institution_name) as institution_name,
      count(*) filter (where per_team.standing_position <= 10)::integer as top10_count,
      count(*) filter (where per_team.standing_position <= 50)::integer as top50_count,
      count(*) filter (where per_team.standing_position <= 100)::integer as top100_count,
      count(*) filter (where per_team.standing_position <= 1000)::integer as top1000_count,
      min(per_team.team_rank)::integer as best_rank
    from per_team
    group by per_team.institution_key
  ),
  ranked as (
    select
      row_number() over (
        order by
          case when p.rank_by = 'top10' then aggregates.top10_count end desc nulls last,
          case when p.rank_by = 'top50' then aggregates.top50_count end desc nulls last,
          case when p.rank_by = 'top100' then aggregates.top100_count end desc nulls last,
          case when p.rank_by = 'top1000' then aggregates.top1000_count end desc nulls last,
          aggregates.top1000_count desc, aggregates.top100_count desc,
          aggregates.top50_count desc, aggregates.top10_count desc,
          aggregates.best_rank asc, aggregates.institution_name asc
      )::integer as rank,
      aggregates.*
    from aggregates
    cross join params as p
  ),
  filtered as (
    select ranked.*
    from ranked
    cross join params as p
    where p.needle is null
      or position(p.needle in lower(ranked.institution_name)) > 0
      or (
        exists (select 1 from query_terms)
        and not exists (
          select 1
          from query_terms as q
          where case
            when char_length(q.term) < 3 then not exists (
              select 1
              from regexp_split_to_table(lower(ranked.institution_name), '[^[:alnum:]]+') as words(word)
              where words.word = q.term
            )
            else word_similarity(q.term, lower(ranked.institution_name)) < 0.35
          end
        )
      )
  ),
  page_rows as (
    select *
    from filtered
    order by rank asc
    limit least(greatest(coalesce(p_page_size, 10), 1), 100)
    offset (greatest(coalesce(p_page, 1), 1) - 1)
      * least(greatest(coalesce(p_page_size, 10), 1), 100)
  )
  select jsonb_build_object(
    'search_version', 1,
    'total', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(page_rows) order by page_rows.rank asc) from page_rows),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_institution_rankings(text, integer, integer, text) from public;
grant execute on function public.get_institution_rankings(text, integer, integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
