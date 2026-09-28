import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZES = [10, 25, 50];
const INSTITUTION_RANK_OPTIONS = [
  { value: 'top10', label: 'Top 10' },
  { value: 'top50', label: 'Top 50' },
  { value: 'top100', label: 'Top 100' },
  { value: 'top1000', label: 'Top 1,000' },
];
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function normalizeEntry(entry) {
  const team = entry.team ?? entry;
  return {
    id: entry.id,
    rank: Number(entry.rank) || 0,
    score: entry.score === null || entry.score === undefined ? null : Number(entry.score),
    team_name: team.team_name || 'Unknown team',
    players: Array.isArray(team.players) ? team.players : [],
    finish_time: entry.finish_time || null,
  };
}

function formatScore(score) {
  return Number.isFinite(Number(score)) ? Number(score).toFixed(4) : '—';
}

function formatFinishTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function levenshteinDistance(first, second) {
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= second.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (first[row - 1] === second[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[second.length];
}

function matchesFuzzy(searchableText, queryText) {
  const terms = queryText.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const words = searchableText.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.every((term) => {
    if (term.length < 4) return words.includes(term);
    const maxDistance = Math.max(1, Math.floor(term.length * 0.22));
    return words.some((word) => (
      Math.abs(word.length - term.length) <= maxDistance
      && levenshteinDistance(term, word) <= maxDistance
    ));
  });
}

function aggregateInstitutions(entries, rankBy = 'top1000') {
  const institutions = new Map();
  const rankedEntries = [...entries].sort((first, second) => (
    first.rank - second.rank
    || (Number(second.score ?? -Infinity) - Number(first.score ?? -Infinity))
    || Number(first.id) - Number(second.id)
  ));
  for (const [index, entry] of rankedEntries.entries()) {
    const standingPosition = index + 1;
    const seenForTeam = new Map();
    for (const player of entry.players ?? []) {
      const name = (player.organisation || '').trim().replace(/\s+/g, ' ');
      const key = name.toLocaleLowerCase();
      if (name && !['n/a', 'na', 'unknown'].includes(key)) seenForTeam.set(key, name);
    }
    for (const [key, name] of seenForTeam) {
      const stats = institutions.get(key) ?? {
        institution_key: key,
        institution_name: name,
        top10_count: 0,
        top50_count: 0,
        top100_count: 0,
        top1000_count: 0,
        best_rank: entry.rank,
      };
      stats.institution_name = stats.institution_name.localeCompare(name) <= 0 ? stats.institution_name : name;
      if (standingPosition <= 10) stats.top10_count += 1;
      if (standingPosition <= 50) stats.top50_count += 1;
      if (standingPosition <= 100) stats.top100_count += 1;
      if (standingPosition <= 1000) stats.top1000_count += 1;
      stats.best_rank = Math.min(stats.best_rank, entry.rank);
      institutions.set(key, stats);
    }
  }

  return [...institutions.values()]
    .sort((first, second) => (
      second[`${rankBy}_count`] - first[`${rankBy}_count`]
      || second.top1000_count - first.top1000_count
      || second.top100_count - first.top100_count
      || second.top50_count - first.top50_count
      || second.top10_count - first.top10_count
      || first.best_rank - second.best_rank
      || first.institution_name.localeCompare(second.institution_name)
    ))
    .map((entry, index) => ({ ...entry, id: entry.institution_key, rank: index + 1 }));
}

function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const initialTheme = localStorage.getItem('amazon-ml-ranking-theme') === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = initialTheme;
      return initialTheme;
    } catch {
      document.documentElement.dataset.theme = 'dark';
      return 'dark';
    }
  });
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState('teams');
  const [institutionRankBy, setInstitutionRankBy] = useState('top1000');
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const localData = useRef(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080d09' : '#e9eee5');
    try {
      localStorage.setItem('amazon-ml-ranking-theme', theme);
    } catch {
      // Theme still works for this session when browser storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const requestId = ++latestRequest.current;

    async function loadPage() {
      setLoading(true);
      setError('');
      try {
        if (supabase) {
          const rpcName = activeTab === 'teams' ? 'get_leaderboard' : 'get_institution_rankings';
          const { data, error: rpcError } = await supabase.rpc(rpcName, {
            p_search: search,
            p_page: page,
            p_page_size: pageSize,
            ...(activeTab === 'institutions' ? { p_rank_by: institutionRankBy } : {}),
          });
          if (rpcError) {
            if (activeTab === 'teams' && rpcError.code === 'PGRST202') {
              throw new Error('Supabase search is out of date. Run the fuzzy-search SQL migration, then refresh.');
            }
            if (activeTab === 'institutions' && rpcError.code === 'PGRST202') {
              throw new Error('Supabase institute rankings need updating. Run the latest institute rankings SQL migration, then refresh.');
            }
            throw rpcError;
          }
          if (requestId !== latestRequest.current) return;
          if (activeTab === 'institutions' && data?.search_version !== 1) {
            throw new Error('Institute search is still using the old function. Re-run the contents of supabase/migrations/202609300002_institute_rankings.sql, then refresh.');
          }
          if (activeTab === 'teams' && data?.search_version !== 1) {
            throw new Error('Supabase search is still using the old function. Paste and run the contents of supabase/migrations/202609300001_fuzzy_search.sql, then refresh.');
          }
          if (activeTab === 'institutions' && data?.items?.some((entry) => !Object.hasOwn(entry, 'top1000_count'))) {
            throw new Error('Supabase is still returning the old institute rankings. Run the latest institute rankings SQL migration, then refresh.');
          }
          setEntries(data?.items ?? []);
          setTotal(Number(data?.total ?? 0));
          return;
        }

        if (import.meta.env.DEV) {
          if (!localData.current) {
            localData.current = fetch('/unstop_all_teams.json')
              .then(async (response) => {
                if (!response.ok) throw new Error('Could not load the local leaderboard JSON.');
                return (await response.json()).map(normalizeEntry);
              })
              .catch((fetchError) => {
                localData.current = null;
                throw fetchError;
              });
          }
          const localEntries = await localData.current;
          const sourceEntries = activeTab === 'teams' ? localEntries : aggregateInstitutions(localEntries, institutionRankBy);
          const filtered = sourceEntries.filter((entry) => {
            const searchable = activeTab === 'teams'
              ? [entry.team_name, ...entry.players.flatMap((player) => [player.name, player.organisation])].filter(Boolean).join(' ')
              : entry.institution_name;
            return !search || searchable.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || matchesFuzzy(searchable, search);
          });
          if (requestId !== latestRequest.current) return;
          const start = (page - 1) * pageSize;
          setEntries(filtered.slice(start, start + pageSize));
          setTotal(filtered.length);
          return;
        }

        throw new Error('Add your Supabase URL and public key to .env.local to load the leaderboard.');
      } catch (loadError) {
        if (requestId !== latestRequest.current) return;
        setError(loadError.message || 'Something went wrong while loading the leaderboard.');
        setEntries([]);
        setTotal(0);
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    }

    loadPage();
  }, [search, page, pageSize, activeTab, institutionRankBy]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedRankCountKey = `${institutionRankBy}_count`;
  const selectedRankLabel = INSTITUTION_RANK_OPTIONS.find((option) => option.value === institutionRankBy)?.label.toUpperCase() ?? 'TOP 1,000';
  const firstResult = total ? (page - 1) * pageSize + 1 : 0;
  const lastResult = Math.min(page * pageSize, total);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchSettled = normalizedQuery === search.toLocaleLowerCase();
  const suggestions = searchSettled && !loading ? entries.slice(0, 5) : [];
  const showSuggestions = searchFocused && Boolean(normalizedQuery) && searchSettled && !loading && !error;

  function updateQuery(value) {
    setQuery(value);
    setPage(1);
    setActiveSuggestion(-1);
  }

  function chooseSuggestion(entry) {
    updateQuery(activeTab === 'teams' ? entry.team_name || '' : entry.institution_name || '');
    setSearchFocused(false);
  }

  function switchTab(tab) {
    setActiveTab(tab);
    setQuery('');
    setSearch('');
    setPage(1);
    setEntries([]);
    setTotal(0);
    setSearchFocused(false);
    setActiveSuggestion(-1);
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeSuggestion]);
    } else if (event.key === 'Escape') {
      setSearchFocused(false);
      setActiveSuggestion(-1);
    }
  }

  return (
    <div className="app-shell">
      <main id="top" className="page-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">THE FIELD, AT A GLANCE <span>✳</span></p>
            <h1>Amazon ML<br />Challenge Ranking</h1>
            <p className="hero-description">Explore team standings, scores, and finish times from the Unstop challenge.</p>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-pressed={theme === 'dark'}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-star">✳</div>
            <span className="art-number">01</span>
          </div>
        </section>

        <section className="overview" aria-label="Leaderboard overview">
          <div className="overview-title"><span className="section-kicker">01 / STANDINGS</span><span className="overview-divider" /></div>
          <div className="overview-stats">
            <div className="overview-stat"><span className="stat-label">{activeTab === 'teams' ? 'TOTAL TEAMS' : 'INSTITUTIONS'}</span><strong>{loading && !total ? '—' : total.toLocaleString('en-IN')}</strong></div>
            <div className="overview-stat"><span className="stat-label">SHOWING</span><strong>{loading && !entries.length ? '—' : <>{entries.length.toString().padStart(2, '0')} <small>/ {pageSize}</small></>}</strong></div>
            <div className="overview-caption">{activeTab === 'teams' ? <>A live view of team standings.<br />Search names, even with a typo.</> : <>Top 10, 50, 100, and 1,000 are exact team slots.<br />Mixed-college teams count once for each college.</>}</div>
          </div>
        </section>

        <section className="leaderboard-section" aria-labelledby="leaderboard-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">THE COMPLETE TABLE</p>
              <h2 id="leaderboard-title">{activeTab === 'teams' ? 'Team Rankings' : 'Institute Rankings'}</h2>
            </div>
            <div className="section-index">DATASET <span>↘</span></div>
          </div>

          <div className="view-tabs" role="tablist" aria-label="Ranking views">
            <button type="button" role="tab" id="teams-tab" aria-selected={activeTab === 'teams'} aria-controls="rankings-panel" className={activeTab === 'teams' ? 'view-tab active' : 'view-tab'} onClick={() => switchTab('teams')}>Teams</button>
            <button type="button" role="tab" id="institutes-tab" aria-selected={activeTab === 'institutions'} aria-controls="rankings-panel" className={activeTab === 'institutions' ? 'view-tab active' : 'view-tab'} onClick={() => switchTab('institutions')}>Institutes</button>
            {activeTab === 'institutions' && <label className="rank-scope-control">RANK BY
              <select value={institutionRankBy} onChange={(event) => { setInstitutionRankBy(event.target.value); setPage(1); }} aria-label="Rank institutes by top team entries">
                {INSTITUTION_RANK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>}
          </div>

          <div className="table-tools">
            <div className="search-control">
              <label className="search-box">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
                <input
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={activeTab === 'teams' ? 'Search teams, players, institutions…' : 'Search colleges and institutions…'}
                  aria-label={activeTab === 'teams' ? 'Search team rankings' : 'Search institute rankings'}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showSuggestions}
                  aria-controls="search-suggestions"
                  aria-activedescendant={activeSuggestion >= 0 ? `suggestion-${activeSuggestion}` : undefined}
                />
                {query && <button type="button" className="clear-search" onMouseDown={(event) => event.preventDefault()} onClick={() => updateQuery('')} aria-label="Clear search">×</button>}
              </label>
              {showSuggestions && <div className="search-suggestions" id="search-suggestions" role="listbox" aria-label="Search suggestions">
                <div className="suggestions-heading" role="presentation">{suggestions.length ? 'QUICK MATCHES' : 'NO CLOSE MATCHES'} <span>{suggestions.length ? `${suggestions.length} OF ${total.toLocaleString('en-IN')} ${activeTab === 'teams' ? 'TEAMS' : 'INSTITUTES'}` : 'TRY ANOTHER SPELLING'}</span></div>
                {suggestions.map((entry, index) => <button
                  type="button"
                  className={`suggestion-option ${activeSuggestion === index ? 'suggestion-active' : ''}`}
                  id={`suggestion-${index}`}
                  role="option"
                  aria-selected={activeSuggestion === index}
                  key={entry.id ?? `${entry.rank}-${index}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(entry)}
                >
                  <span className="suggestion-rank">{String(entry.rank).padStart(2, '0')}</span>
                  <span className="suggestion-copy"><strong>{activeTab === 'teams' ? entry.team_name || 'Unknown team' : entry.institution_name}</strong><small>{activeTab === 'teams' ? `${entry.players?.length ?? 0} ${(entry.players?.length ?? 0) === 1 ? 'member' : 'members'}` : `${entry[selectedRankCountKey]} teams in ${selectedRankLabel}`}</small></span>
                  <span className="suggestion-score">{activeTab === 'teams' ? formatScore(entry.score) : entry[selectedRankCountKey]}<small>{activeTab === 'teams' ? 'PTS' : selectedRankLabel}</small></span>
                </button>)}
                {suggestions.length > 0 && <div className="suggestions-footnote" role="presentation">↑ ↓ TO NAVIGATE <span>ENTER TO SELECT</span></div>}
              </div>}
            </div>
            <div className="results-count">{loading ? 'UPDATING…' : `${total.toLocaleString('en-IN')} RESULTS`}</div>
          </div>

          <div className="table-frame" id="rankings-panel" role="tabpanel" aria-labelledby={activeTab === 'teams' ? 'teams-tab' : 'institutes-tab'}>
            <div className="table-scroll">
              <table className={activeTab === 'institutions' ? 'institution-table' : undefined}>
                {activeTab === 'teams'
                  ? <thead><tr><th className="rank-column">RANK</th><th>TEAM</th><th>SCORE</th><th>PLAYERS &amp; ORGANISATIONS</th><th>FINISHED</th></tr></thead>
                  : <thead><tr><th className="rank-column">RANK</th><th>INSTITUTION</th><th>TOP 10</th><th>TOP 50</th><th>TOP 100</th><th>TOP 1,000</th><th>BEST RANK</th></tr></thead>}
                <tbody>
                  {loading ? Array.from({ length: Math.min(pageSize, 6) }, (_, index) => (
                    <tr className="skeleton-row" key={index}>{Array.from({ length: activeTab === 'teams' ? 5 : 7 }, (__, columnIndex) => <td key={columnIndex}><span /></td>)}</tr>
                  )) : error ? (
                    <tr><td className="table-message" colSpan={activeTab === 'teams' ? 5 : 7}><div className="message-icon">!</div><strong>Leaderboard unavailable</strong><span>{error}</span><small>{!supabase ? (import.meta.env.DEV ? 'Setup steps are in README.md.' : 'The site owner needs to configure Supabase.') : 'Check the Supabase setup and try refreshing.'}</small></td></tr>
                  ) : entries.length === 0 ? (
                    <tr><td className="table-message" colSpan={activeTab === 'teams' ? 5 : 7}><div className="message-icon">⌕</div><strong>{activeTab === 'teams' ? 'No teams found' : 'No institutes found'}</strong><span>Try a different name or search term.</span></td></tr>
                  ) : activeTab === 'institutions' ? entries.map((entry, index) => (
                    <tr key={entry.institution_key ?? entry.id ?? `${entry.rank}-${index}`}>
                      <td className="rank-cell"><span className={`rank-badge ${entry.rank <= 3 ? `rank-top rank-${entry.rank}` : ''}`}>{String(entry.rank).padStart(2, '0')}</span></td>
                      <td className="institution-cell"><strong>{entry.institution_name}</strong><span>College or organisation</span></td>
                      <td><span className={`institution-count ${institutionRankBy === 'top10' ? 'count-highlight' : ''}`}>{entry.top10_count}</span></td>
                      <td><span className={`institution-count ${institutionRankBy === 'top50' ? 'count-highlight' : ''}`}>{entry.top50_count}</span></td>
                      <td><span className={`institution-count ${institutionRankBy === 'top100' ? 'count-highlight' : ''}`}>{entry.top100_count}</span></td>
                      <td><span className={`institution-count ${institutionRankBy === 'top1000' ? 'count-highlight' : ''}`}>{entry.top1000_count}</span></td>
                      <td className="best-rank">#{entry.best_rank}</td>
                    </tr>
                  )) : entries.map((entry, index) => (
                    <tr key={entry.id ?? `${entry.rank}-${index}`}>
                      <td className="rank-cell"><span className={`rank-badge ${entry.rank <= 3 ? `rank-top rank-${entry.rank}` : ''}`}>{String(entry.rank).padStart(2, '0')}</span></td>
                      <td className="team-cell"><strong>{entry.team_name || 'Unknown team'}</strong><span>Team entry</span></td>
                      <td className="score-cell">{formatScore(entry.score)}<span>PTS</span></td>
                      <td className="players-cell">
                        {entry.players?.length ? <>
                          <div className="player-names">{entry.players.slice(0, 3).map((player, playerIndex) => <span key={`${player.name}-${playerIndex}`}>{player.name || 'Unknown player'}</span>)}</div>
                          <div className="organisation-names">{entry.players.slice(0, 2).map((player, playerIndex) => <span key={`${player.organisation}-${playerIndex}`}>{player.organisation || 'Organisation not listed'}</span>)}</div>
                          {entry.players.length > 3 && <span className="more-players">+{entry.players.length - 3} MORE</span>}
                        </> : <span className="muted-dash">No player details</span>}
                      </td>
                      <td className="time-cell">{formatFinishTime(entry.finish_time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pagination">
            <div className="pagination-summary">SHOWING <strong>{firstResult}–{lastResult}</strong> OF <strong>{total.toLocaleString('en-IN')}</strong> {activeTab === 'teams' ? 'TEAMS' : 'INSTITUTES'}</div>
            <div className="pagination-controls">
              <label className="page-size-control">ROWS <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
              <button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage(1)} aria-label="First page" title="First page">⇤</button>
              <button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} aria-label="Previous page" title="Previous page">←</button>
              <span className="page-indicator"><strong>{String(page).padStart(2, '0')}</strong> / {String(totalPages).padStart(2, '0')}</span>
              <button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} aria-label="Next page" title="Next page">→</button>
              <button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage(totalPages)} aria-label="Last page" title="Last page">⇥</button>
            </div>
          </div>
        </section>

        <footer className="footer"><span>TEAM STANDINGS · LIVE DATA</span><span>MADE TO FIND YOUR PLACE <b>✳</b></span></footer>
      </main>
    </div>
  );
}

export default App;
