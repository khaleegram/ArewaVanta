import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { allPublicEvents } from "./api/events";
import type {
  EventSummary,
  PlayerProfile,
  PlayerRanking,
  SquadStanding,
  Standings,
} from "./api/types";
import {
  countLabel,
  formatDate,
  formatDateRange,
  placementLabel,
  squadIdentity,
} from "./presentation";
import { Brand, Icon } from "./ui";
import { pageMetadata, usePageSeo } from "./seo";


type Kind = "squads" | "players";
type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const message = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
function averageKills(kills: number, appearances: number) {
  if (appearances === 0) return "—";
  const hundredths = Math.floor(
    (kills * 200 + appearances) / (2 * appearances),
  );
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}
const dateText = (date: string | null) => formatDate(date);

type SpotlightEntry = { id: string; rank: number; name: string; tag: string; score: string | number; detail: string };
function RankBadge({ tag, player = false }: { tag: string; player?: boolean }) {
  return <span className={`arena-badge${player ? " arena-badge-player" : ""}`} aria-hidden="true">{tag}</span>;
}
function Leaders({ entries, kind }: { entries: SpotlightEntry[]; kind: Kind }) {
  if (!entries.length) return null;
  const visible = entries.slice(0, 3);
  return <section className={`arena-leaders arena-leaders-${visible.length}`} aria-label={`Leading ${kind}`}>
    <div className="arena-section-label"><span><Icon name="trophy" /> The front runners</span><small>{kind === "squads" ? "Squad standings" : "Individual performance"}</small></div>
    <div className="arena-podium">
      {visible.map((entry, index) => <article className={`arena-contender arena-place-${index + 1}`} key={entry.id}>
        <div className="arena-contender-top"><span className="arena-medal">{index === 0 ? <Icon name="trophy" /> : String(entry.rank).padStart(2, "0")}</span><span>{index === 0 ? "Leading the board" : `Rank #${entry.rank}`}</span><span className="arena-contender-number">#{entry.rank}</span></div>
        <div className="arena-contender-main"><RankBadge tag={entry.tag} player={kind === "players"} /><div><h2>{entry.name}</h2><p>{entry.detail}</p></div></div>
        <div className="arena-contender-bottom"><div><strong>{entry.score}</strong><span>{kind === "squads" ? "TOTAL POINTS" : "TOTAL KILLS"}</span></div><span className="arena-contender-caption">{index === 0 ? "Setting the pace" : "In the chase"}<Icon name={kind === "squads" ? "trophy" : "target"} /></span></div>
      </article>)}
    </div>
  </section>;
}
function Notice({ children, retry }: { children: React.ReactNode; retry?: () => void }) {
  return <div className="arena-empty" role="status"><Icon name="trophy" /><p>{children}</p>{retry && <button type="button" onClick={retry}>Try again <Icon name="arrow" /></button>}</div>;
}
function Tabs({ kind, onChange }: { kind: Kind; onChange: (kind: Kind) => void }) {
  return <div className="arena-tabs" role="tablist" aria-label="Ranking type">{(["squads", "players"] as const).map((item) => <button key={item} type="button" id={`${item}-ranking-tab`} role="tab" aria-selected={kind === item} aria-controls="full-ranking-panel" tabIndex={kind === item ? 0 : -1} onClick={() => onChange(item)} onKeyDown={(e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "squads" : e.key === "End" ? "players" : item === "squads" ? "players" : "squads";
    onChange(next); document.getElementById(`${next}-ranking-tab`)?.focus();
  }}><Icon name={item === "squads" ? "trophy" : "target"} /><span>{item === "squads" ? "Squad standings" : "Player rankings"}</span></button>)}</div>;
}

function SquadBreakdown({ row }: { row: SquadStanding }) {
  if (!row.match_results.length)
    return (
      <div className="arena-detail-content">
        <p className="arena-table-note">No game results for this squad yet.</p>
      </div>
    );
  return (
    <div className="arena-detail-content">
      <p className="arena-detail-title">
        Game results · {countLabel(row.matches_played, "game")} ·{" "}
        {countLabel(row.wins, "win")}
      </p>
      <div className="arena-live-matches">
        {row.match_results.map((match) => (
          <div key={match.match_id}>
            <span>
              {dateText(match.event_date)} · Game {match.match_index} ·{" "}
              {match.map_label}
            </span>
            <strong>
              {placementLabel(match.placement)} ·{" "}
              {countLabel(match.team_kills, "kill")} · {match.total_points} pts
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
function PlayerBreakdown({ playerId }: { playerId: string }) {
  const [state, setState] = useState<Load<PlayerProfile>>({
    status: "loading",
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    api
      .player(playerId, 1, controller.signal)
      .then(({ data }) => setState({ status: "ready", data }))
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ status: "error", message: message(e) });
      });
    return () => controller.abort();
  }, [playerId, retry]);
  if (state.status === "loading")
    return <div className="arena-detail-content">Loading player statistics…</div>;
  if (state.status === "error")
    return (
      <div className="arena-detail-content">
        <p>{state.message}</p>
        <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </div>
    );
  const p = state.data;
  return (
    <div className="arena-detail-content">
      <div className="arena-detail-stats">
        {[
          ["Games played", p.appearances],
          ["Total kills", p.total_kills],
          ["Kills / game", p.kills_per_appearance ?? "—"],
          ["Best game", p.best_game_kills ?? "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="arena-detail-title">
        Recent games{" "}
        {p.history_meta.total > p.match_history.length
          ? `(showing ${p.match_history.length} of ${p.history_meta.total})`
          : ""}
      </p>
      <div className="arena-live-matches">
        {p.match_history.map((match) => (
          <div key={match.match_id}>
            <span>
              {match.event_title} · {match.map_label} ·{" "}
              {dateText(match.event_date)}
            </span>
            <span>{squadIdentity({
              name: match.squad_name,
              squadNumber: match.squad_number,
              clanTag: match.clan_tag,
              clanName: match.clan_name,
              clanSquadCount: match.clan_squad_count,
            })}</span>
            <strong>{countLabel(match.kills, "kill")}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function LiveLeaderboard() {
  const initialParams = new URLSearchParams(window.location.search);
  const [kind, setKind] = useState<Kind>(
    initialParams.get("type") === "players" ? "players" : "squads",
  );
  const [events, setEvents] = useState<Load<EventSummary[]>>({
    status: "loading",
  });
  const [event, setEvent] = useState(initialParams.get("event") ?? "");
  const [seasonId, setSeasonId] = useState(initialParams.get("season") ?? "");
  const [standings, setStandings] = useState<Load<Standings>>({
    status: "loading",
  });
  const [players, setPlayers] = useState<
    Load<{ data: PlayerRanking[]; total: number; lastPage: number }>
  >({ status: "loading" });
  const [playerPage, setPlayerPage] = useState(() => {
    const page = Number(initialParams.get("page"));
    return Number.isSafeInteger(page) && page > 0 ? page : 1;
  });
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [sort, setSort] = useState("rank");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setEvents({ status: "loading" });
    allPublicEvents(controller.signal)
      .then((data) => {
        setEvents({ status: "ready", data });
        setEvent((current) =>
          data.some((e) => e.slug === current)
            ? current
            : ((data.find((e) => e.scored_match_count > 0) ?? data[0])?.slug ??
              ""),
        );
        setSeasonId((current) =>
          current && data.some((e) => e.season?.id === current) ? current : "",
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setEvents({ status: "error", message: message(error) });
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!event && !seasonId) return;
    const controller = new AbortController();
    setStandings({ status: "loading" });
    (seasonId
      ? api.seasonStandings(seasonId, controller.signal)
      : api.eventStandings(event, controller.signal)
    )
      .then(({ data }) => setStandings({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setStandings({ status: "error", message: message(error) });
      });
    return () => controller.abort();
  }, [event, seasonId, retry]);
  useEffect(() => {
    if (kind !== "players") return;
    const controller = new AbortController();
    setPlayers({ status: "loading" });
    api
      .playerRankings(playerPage, controller.signal)
      .then((response) => {
        if (
          playerPage > response.meta.last_page &&
          response.meta.last_page > 0
        ) {
          setPlayerPage(response.meta.last_page);
          return;
        }
        setPlayers({
          status: "ready",
          data: {
            data: response.data,
            total: response.meta.total,
            lastPage: response.meta.last_page,
          },
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setPlayers({ status: "error", message: message(error) });
      });
    return () => controller.abort();
  }, [kind, playerPage, retry]);
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("type", kind);
    if (seasonId) p.set("season", seasonId);
    else if (event) p.set("event", event);
    if (kind === "players" && playerPage > 1) p.set("page", String(playerPage));
    if (kind === "squads" && query.trim()) p.set("q", query.trim());
    window.history.replaceState(null, "", `/leaderboard?${p}`);
  }, [kind, event, seasonId, playerPage, query]);
  const currentEvent =
    events.status === "ready"
      ? events.data.find((e) => e.slug === event)
      : undefined;
  const seasons =
    events.status === "ready"
      ? [
          ...new Map(
            events.data.flatMap((e) =>
              e.season ? [[e.season.id, e.season] as const] : [],
            ),
          ).values(),
        ]
      : [];
  const currentSeason = seasons.find((season) => season.id === seasonId);
  const activeContext = seasonId
    ? currentSeason && { title: currentSeason.name }
    : currentEvent;
  usePageSeo({
    ...pageMetadata.leaderboard,
    title: kind === "players"
      ? "Arewa CODM Player Rankings & Kills Leaderboard | ArewaVanta"
      : "Arewa CODM Squad Standings & Leaderboard | ArewaVanta",
    description: activeContext
      ? `See ${kind === "players" ? "player rankings" : "squad standings"} for ${activeContext.title} in the Arewa CODM Battle Royale community. Follow kills, wins and points.`
      : pageMetadata.leaderboard.description,
  });
  const rows =
    standings.status === "ready"
      ? standings.data.standings.filter((row) =>
          `${row.squad.name} ${row.squad.clan.tag ?? ""} ${row.squad.clan.name}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
      : [];
  if (sort === "kills")
    rows.sort((a, b) => b.total_kills - a.total_kills || a.rank - b.rank);
  function changeKind(value: Kind) {
    setKind(value);
    setExpanded(null);
    setSort("rank");
    setQuery("");
  }
  const groups = events.status === "ready" ? [...new Map(events.data.map((item) => {
    const key = item.series_id ? `series:${item.series_id}` : item.slug;
    const weeks = events.data.filter((week) => item.series_id ? week.series_id === item.series_id : week.id === item.id).sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
    const representative = weeks.find((week) => week.scored_match_count > 0) ?? weeks.at(-1)!;
    return [key, { key, title: item.title, weeks, representative }] as const;
  })).values()] : [];
  const currentGroup = groups.find((group) => group.weeks.some((week) => week.slug === event));
  const leaders: SpotlightEntry[] = kind === "squads"
    ? (standings.status === "ready" ? standings.data.standings.filter((row) => row.matches_played > 0).slice(0, 3).map((row) => ({
      id: row.squad.id, rank: row.rank,
      name: `${row.squad.clan.name}${(row.squad.clan.squad_count ?? 1) > 1 ? ` (${row.squad.squad_number ?? 1})` : ""}`,
      tag: row.squad.clan.tag || row.squad.name.slice(0, 2), score: row.total_points,
      detail: `${countLabel(row.total_kills, "kill")} · ${countLabel(row.wins, "win")} · ${countLabel(row.matches_played, "game")}`,
    })) : [])
    : (players.status === "ready" && playerPage === 1 ? players.data.data.slice(0, 3).map((player) => ({
      id: player.id, rank: player.rank, name: player.ign, tag: player.ign.slice(0, 2), score: player.total_kills,
      detail: `${averageKills(player.total_kills, player.appearances)} kills / game · ${countLabel(player.appearances, "game")}`,
    })) : []);
  const squadCount = standings.status === "ready" ? standings.data.standings.length : null;
  const completedGames = standings.status === "ready" ? Math.max(0, ...standings.data.standings.map((row) => row.matches_played)) : 0;
  return <div className={`arena-page arena-${kind}`}>
    <a className="skip-link" href="#standings-content">Skip to standings</a>
    <header className="arena-header"><Brand href="/" /><nav aria-label="Main navigation"><a href="/">Home</a><a href="/competitions">Competitions</a><a href="/leaderboard" aria-current="page">Leaderboards</a><a href="/clans">Clans</a><a href="/players">Players</a></nav><a className="arena-header-action" href="/competitions">Find a competition <Icon name="arrow" /></a></header>
    <main className="arena-main" id="standings-content">
      <section className="arena-hero" aria-labelledby="arena-title">
        <div className="arena-hero-art" aria-hidden="true"><span /><span /><Icon name={kind === "squads" ? "trophy" : "target"} /></div>
        <div className="arena-hero-copy"><span className="arena-eyebrow"><i /> AREWA CODM · THE RANKINGS</span><h1 id="arena-title">Every game.<br /><em>Make it count.</em></h1><p>{kind === "squads" ? "The squads, the wins, the race to the top. This is where the North keeps score." : "The sharpest aim. The biggest games. Meet the players making their mark."}</p></div>
        <div className="arena-hero-stats"><div><span>{kind === "squads" ? "SQUADS IN THE RACE" : "RANKED PLAYERS"}</span><strong>{kind === "squads" ? (squadCount ?? "—") : players.status === "ready" ? players.data.total : "—"}<Icon name={kind === "squads" ? "trophy" : "target"} /></strong></div><p><span className="arena-status-dot" /> {kind === "squads" ? `${countLabel(completedGames, "game")} played${currentEvent ? ` · ${currentEvent.title}` : ""}` : "Across competitions with individual kills enabled"}</p></div>
      </section>
      <div className="arena-navigation"><Tabs kind={kind} onChange={changeKind} /><span>PLAY HARD. CLIMB HIGHER.</span></div>
      {kind === "squads" ? <section className="arena-filters" aria-label="Competition filters">
        <label className="arena-select"><Icon name="trophy" /><span><small>COMPETITION</small><select aria-label="Competition or season" value={seasonId ? `season:${seasonId}` : currentGroup?.key ?? ""} disabled={events.status !== "ready" || !events.data.length} onChange={(e) => {
          if (e.target.value.startsWith("season:")) setSeasonId(e.target.value.slice(7));
          else { setSeasonId(""); const group = groups.find((item) => item.key === e.target.value); if (group) setEvent(group.representative.slug); }
          setStandings({ status: "loading" }); setExpanded(null); setQuery("");
        }}>{!groups.length && <option value="">{events.status === "loading" ? "Loading competitions…" : "No competitions yet"}</option>}{groups.map((group) => <option key={group.key} value={group.key}>{group.title}</option>)}{seasons.length > 0 && <optgroup label="Seasons">{seasons.map((season) => <option key={season.id} value={`season:${season.id}`}>{season.name}</option>)}</optgroup>}</select></span><Icon name="chevron" /></label>
        {currentGroup && !seasonId && <label className="arena-select arena-week"><Icon name="calendar" /><span><small>{currentGroup.weeks.length > 1 ? "WEEKEND" : "DATES"}</small><select aria-label="Competition weekend" value={event} onChange={(e) => { setEvent(e.target.value); setStandings({ status: "loading" }); setExpanded(null); setQuery(""); }}>{currentGroup.weeks.map((week) => <option key={week.id} value={week.slug}>{formatDateRange(week.start_date, week.end_date)}{week.skipped_at ? " · Not playing" : ""}</option>)}</select></span><Icon name="chevron" /></label>}
        {currentSeason && <span className="arena-filter-note">Combined season standings</span>}
        {currentEvent?.track_player_kills === false && !seasonId && <span className="arena-filter-note"><Icon name="trophy" /> Squad kills + placement</span>}
      </section> : <div className="arena-player-context"><Icon name="target" /><div><strong>Individual kills. Recognised.</strong><span>Only competitions recording individual player kills count here. Squad-only scrims are excluded.</span></div></div>}
      <section role="tabpanel" id="full-ranking-panel" aria-labelledby={`${kind}-ranking-tab`} tabIndex={0}>
        {kind === "squads" ? <>
          {events.status === "loading" && <Notice>Loading competitions…</Notice>}
          {events.status === "error" && <Notice retry={() => setRetry((n) => n + 1)}>{events.message}</Notice>}
          {events.status === "ready" && !events.data.length && <Notice>The next competition starts the story. Standings will appear here once squads enter.</Notice>}
          {activeContext && standings.status === "loading" && <Notice>Loading standings…</Notice>}
          {activeContext && standings.status === "error" && <Notice retry={() => setRetry((n) => n + 1)}>{standings.message}</Notice>}
          {activeContext && standings.status === "ready" && <>
            <Leaders entries={leaders} kind={kind} />
            <section className="arena-board" aria-labelledby="rankings-title">
              <div className="arena-board-heading"><div><span className="arena-kicker">THE FULL PICTURE</span><h2 id="rankings-title">Squad standings<span>{squadCount}</span></h2><p>{activeContext.title} · Ranked by points, kills and wins</p></div><a href={`/competitions/${encodeURIComponent(event)}`}>Competition <Icon name="arrow" /></a></div>
              {standings.data.uses_mixed_scoring_presets && <p className="arena-scoring-note">Games use different scoring rules. Points from every game are added together.</p>}
              <div className="arena-tools"><label className="arena-search"><Icon name="target" /><span className="sr-only">Search squads</span><input type="search" value={query} placeholder="Find your clan or squad…" onChange={(e) => setQuery(e.target.value)} /></label><label className="arena-sort"><span>Sort by</span><select aria-label="Sort standings" value={sort} onChange={(e) => setSort(e.target.value)}><option value="rank">Official rank</option><option value="kills">Most kills</option></select></label></div>
              <div className="arena-column-head" aria-hidden="true"><span>#</span><span>Squad</span><span>Games</span><span>Wins</span><span>Kills</span><span>Points</span></div>
              <ol className="arena-rankings">{rows.map((row) => <li key={row.squad.id} className={`${row.rank === 1 && row.matches_played > 0 ? "arena-rank-leader " : ""}${expanded === row.squad.id ? "arena-is-expanded" : ""}`}>
                <button className="arena-rank-row" type="button" aria-expanded={expanded === row.squad.id} aria-controls={`ranking-${row.squad.id}`} onClick={() => setExpanded(expanded === row.squad.id ? null : row.squad.id)}>
                  <span className={`arena-rank-number${row.rank <= 3 && row.matches_played > 0 ? ` arena-rank-top-${row.rank}` : ""}`}>{row.matches_played > 0 ? String(row.rank).padStart(2, "0") : "—"}<span className="sr-only">{row.matches_played > 0 ? " rank" : "Not played yet"}</span></span>
                  <span className="arena-rank-identity"><RankBadge tag={row.squad.clan.tag || row.squad.name.slice(0, 2)} /><span><strong>{row.squad.clan.name}{(row.squad.clan.squad_count ?? 1) > 1 ? ` (${row.squad.squad_number ?? 1})` : ""}</strong><small>{row.matches_played > 0 ? `${countLabel(row.matches_played, "game")} played` : "Yet to play"} <span>· View games <Icon name="chevron" /></span></small></span></span>
                  <span className="arena-stat arena-stat-games"><strong>{row.matches_played}</strong><small>games</small></span><span className="arena-stat arena-stat-wins"><strong>{row.wins}</strong><small>wins</small></span><span className="arena-stat arena-stat-kills"><strong>{row.total_kills}</strong><small>kills</small></span><span className="arena-rank-score"><strong>{row.total_points}</strong><small>PTS</small></span>
                </button>
                {expanded === row.squad.id && <div className="arena-expanded" id={`ranking-${row.squad.id}`}><SquadBreakdown row={row} /><a className="arena-profile-link" href={`/squads/${encodeURIComponent(row.squad.slug)}`}>View squad profile <Icon name="arrow" /></a></div>}
              </li>)}</ol>
              {!rows.length && <Notice>{query ? "No squads match your search." : "Squads will appear here when competition slots are assigned."}</Notice>}
              <div className="arena-board-foot"><Icon name="trophy" /><span>Every placement matters. Select a squad for the game breakdown.</span><span>{countLabel(rows.length, "squad")}</span></div>
            </section>
          </>}
        </> : <>
          {players.status === "loading" && <Notice>Loading player rankings…</Notice>}
          {players.status === "error" && <Notice retry={() => setRetry((n) => n + 1)}>{players.message}</Notice>}
          {players.status === "ready" && <>
            <Leaders entries={leaders} kind={kind} />
            <section className="arena-board" aria-labelledby="rankings-title"><div className="arena-board-heading"><div><span className="arena-kicker">THE INDIVIDUALS MAKING AN IMPACT</span><h2 id="rankings-title">Player rankings<span>{players.data.total}</span></h2><p>Total kills decide the rank. Equal kills share a place.</p></div><span className="arena-all-time">ALL TIME</span></div>
              <div className="arena-column-head" aria-hidden="true"><span>#</span><span>Player</span><span>Games</span><span>Avg / game</span><span>Best game</span><span>Kills</span></div>
              <ol className="arena-rankings">{players.data.data.map((player) => <li key={player.id} className={`${player.rank === 1 ? "arena-rank-leader " : ""}${expanded === player.id ? "arena-is-expanded" : ""}`}>
                <button type="button" className="arena-rank-row" aria-expanded={expanded === player.id} aria-controls={`ranking-${player.id}`} onClick={() => setExpanded(expanded === player.id ? null : player.id)}><span className={`arena-rank-number${player.rank <= 3 ? ` arena-rank-top-${player.rank}` : ""}`}>{String(player.rank).padStart(2, "0")}<span className="sr-only"> rank</span></span><span className="arena-rank-identity"><RankBadge tag={player.ign.slice(0, 2)} player /><span><strong>{player.ign}</strong><small>{countLabel(player.appearances, "game")} played <span>· View stats <Icon name="chevron" /></span></small></span></span><span className="arena-stat arena-stat-games"><strong>{player.appearances}</strong><small>games</small></span><span className="arena-stat arena-stat-wins"><strong>{averageKills(player.total_kills, player.appearances)}</strong><small>avg / game</small></span><span className="arena-stat arena-stat-kills"><strong>{player.best_game_kills ?? "—"}</strong><small>best game</small></span><span className="arena-rank-score"><strong>{player.total_kills}</strong><small>KILLS</small></span></button>
                {expanded === player.id && <div className="arena-expanded" id={`ranking-${player.id}`}><PlayerBreakdown playerId={player.id} /><a className="arena-profile-link" href={`/players/${encodeURIComponent(player.id)}`}>View player profile <Icon name="arrow" /></a></div>}
              </li>)}</ol>
              {!players.data.total && <Notice>Who will set the pace? Player rankings appear when results are saved for a competition with individual kills enabled.</Notice>}
              {players.data.total > 0 && <div className="arena-pagination"><span>Page {playerPage} of {players.data.lastPage} · {countLabel(players.data.total, "player")}</span><div><button type="button" disabled={playerPage === 1} onClick={() => { setPlayerPage((page) => page - 1); setExpanded(null); }}>← Previous</button><button type="button" disabled={playerPage >= players.data.lastPage} onClick={() => { setPlayerPage((page) => page + 1); setExpanded(null); }}>Next →</button></div></div>}
            </section>
          </>}
        </>}
      </section>
      <footer className="arena-footer"><Brand href="/" /><span>For the North. For the game.</span><a href="/competitions">See what’s next <Icon name="arrow" /></a></footer>
    </main>
  </div>;
}
