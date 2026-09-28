create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated;

create or replace function public.get_leaderboard(
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with params as (
    select nullif(lower(btrim(coalesce(p_search, ''))), '') as needle
  ),
  query_terms as (
    select distinct term
    from params as p
    cross join lateral regexp_split_to_table(coalesce(p.needle, ''), '[^[:alnum:]]+') as terms(term)
    where term <> ''
  ),
  searchable as (
    select
      e.id,
      e.rank,
      e.score,
      e.team_name,
      e.players,
      e.finish_time,
      lower(concat_ws(
        ' ',
        e.team_name,
        coalesce((
          select string_agg(concat_ws(' ', player->>'name', player->>'organisation'), ' ')
          from jsonb_array_elements(e.players) as players(player)
        ), '')
      )) as searchable_text
    from public.leaderboard_entries as e
  ),
  filtered as (
    select
      s.id,
      s.rank,
      s.score,
      s.team_name,
      s.players,
      s.finish_time,
      case
        when p.needle is null then 0::real
        when position(p.needle in s.searchable_text) > 0 then 1::real
        else coalesce((
          select avg(word_similarity(q.term, s.searchable_text))
          from query_terms as q
        ), 0::real)
      end as relevance,
      (p.needle is not null and position(p.needle in s.searchable_text) > 0) as exact_match
    from searchable as s
    cross join params as p
    where p.needle is null
       or position(p.needle in s.searchable_text) > 0
       or (
         exists (select 1 from query_terms)
         and not exists (
           select 1
           from query_terms as q
           where case
             when char_length(q.term) < 3 then not exists (
               select 1
               from regexp_split_to_table(s.searchable_text, '[^[:alnum:]]+') as words(word)
               where words.word = q.term
             )
             else word_similarity(q.term, s.searchable_text) < 0.35
           end
         )
       )
  ),
  page_rows as (
    select f.id, f.rank, f.score, f.team_name, f.players, f.finish_time, f.relevance, f.exact_match
    from filtered as f
    order by f.exact_match desc, f.relevance desc, f.rank asc, f.id asc
    limit least(greatest(coalesce(p_page_size, 10), 1), 100)
    offset (greatest(coalesce(p_page, 1), 1) - 1)
      * least(greatest(coalesce(p_page_size, 10), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', page_rows.id,
            'rank', page_rows.rank,
            'score', page_rows.score,
            'team_name', page_rows.team_name,
            'players', page_rows.players,
            'finish_time', page_rows.finish_time
          )
          order by page_rows.exact_match desc, page_rows.relevance desc, page_rows.rank asc, page_rows.id asc
        )
        from page_rows
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_leaderboard(text, integer, integer) from public;
grant execute on function public.get_leaderboard(text, integer, integer) to anon, authenticated;
