import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZES = [10, 25, 50];
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

function App() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const localData = useRef(null);
  const latestRequest = useRef(0);

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
          const { data, error: rpcError } = await supabase.rpc('get_leaderboard', {
            p_search: search,
            p_page: page,
            p_page_size: pageSize,
          });
          if (rpcError) throw rpcError;
          if (requestId !== latestRequest.current) return;
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
          const needle = search.toLocaleLowerCase();
          const filtered = localEntries.filter((entry) => {
            const searchable = [
              entry.team_name,
              ...entry.players.flatMap((player) => [player.name, player.organisation]),
            ].filter(Boolean).join(' ').toLocaleLowerCase();
            return searchable.includes(needle);
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
  }, [search, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstResult = total ? (page - 1) * pageSize + 1 : 0;
  const lastResult = Math.min(page * pageSize, total);

  function updateQuery(value) {
    setQuery(value);
    setPage(1);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Rankroom home">
          <span className="brand-mark">R</span>
          <span>rankroom<span className="brand-divider">/</span><span className="brand-section">unstop</span></span>
        </a>
        <div className="topbar-note"><span className="live-dot" /> COMPETITION TRACKER</div>
      </header>

      <main id="top" className="page-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">THE FIELD, AT A GLANCE <span>✳</span></p>
            <h1>Every point<br />counts<span>.</span></h1>
            <p className="hero-description">Explore team standings, scores, and finish times from the Unstop challenge.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-star">✳</div>
            <div className="art-label">RANK<br />YOUR<br />NEXT MOVE</div>
            <span className="art-number">01</span>
          </div>
        </section>

        <section className="overview" aria-label="Leaderboard overview">
          <div className="overview-title"><span className="section-kicker">01 / STANDINGS</span><span className="overview-divider" /></div>
          <div className="overview-stats">
            <div className="overview-stat"><span className="stat-label">TOTAL TEAMS</span><strong>{loading && !total ? '—' : total.toLocaleString('en-IN')}</strong></div>
            <div className="overview-stat"><span className="stat-label">SHOWING</span><strong>{loading && !entries.length ? '—' : <>{entries.length.toString().padStart(2, '0')} <small>/ {pageSize}</small></>}</strong></div>
            <div className="overview-caption">A live view of the leaderboard.<br />Search teams, people, or institutions.</div>
          </div>
        </section>

        <section className="leaderboard-section" aria-labelledby="leaderboard-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">THE COMPLETE TABLE</p>
              <h2 id="leaderboard-title">Leaderboard</h2>
            </div>
            <div className="section-index">DATASET <span>↘</span></div>
          </div>

          <div className="table-tools">
            <label className="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
              <input value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search team, player, or institution" aria-label="Search leaderboard" />
              {query && <button className="clear-search" onClick={() => updateQuery('')} aria-label="Clear search">×</button>}
            </label>
            <div className="results-count">{loading ? 'UPDATING…' : `${total.toLocaleString('en-IN')} RESULTS`}</div>
          </div>

          <div className="table-frame">
            <div className="table-scroll">
              <table>
                <thead><tr><th className="rank-column">RANK</th><th>TEAM</th><th>SCORE</th><th>PLAYERS &amp; ORGANISATIONS</th><th>FINISHED</th></tr></thead>
                <tbody>
                  {loading ? Array.from({ length: Math.min(pageSize, 6) }, (_, index) => (
                    <tr className="skeleton-row" key={index}><td><span /></td><td><span /></td><td><span /></td><td><span /></td><td><span /></td></tr>
                  )) : error ? (
                    <tr><td className="table-message" colSpan="5"><div className="message-icon">!</div><strong>Leaderboard unavailable</strong><span>{error}</span><small>{!supabase ? (import.meta.env.DEV ? 'Setup steps are in README.md.' : 'The site owner needs to configure Supabase.') : 'Check the Supabase setup and try refreshing.'}</small></td></tr>
                  ) : entries.length === 0 ? (
                    <tr><td className="table-message" colSpan="5"><div className="message-icon">⌕</div><strong>No teams found</strong><span>Try a different name or search term.</span></td></tr>
                  ) : entries.map((entry, index) => (
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
            <div className="pagination-summary">SHOWING <strong>{firstResult}–{lastResult}</strong> OF <strong>{total.toLocaleString('en-IN')}</strong></div>
            <div className="pagination-controls">
              <label className="page-size-control">ROWS <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
              <button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} aria-label="Previous page">←</button>
              <span className="page-indicator"><strong>{String(page).padStart(2, '0')}</strong> / {String(totalPages).padStart(2, '0')}</span>
              <button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} aria-label="Next page">→</button>
            </div>
          </div>
        </section>

        <footer className="footer"><span>RANKROOM / UNSTOP CHALLENGE</span><span>MADE TO FIND YOUR PLACE <b>✳</b></span></footer>
      </main>
    </div>
  );
}

export default App;
