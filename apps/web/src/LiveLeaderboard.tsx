import { Fragment, useEffect, useState } from "react";
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
  gamesWithResults,
  placementLabel,
  squadIdentity,
} from "./presentation";
import { Brand, Icon } from "./ui";
import "./leaderboard.css";

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

function RankCrest({
  label,
  player = false,
}: {
  label: string;
  player?: boolean;
}) {
  return (
    <span
      className={`lb-crest lb-live-crest${player ? " lb-avatar" : ""}`}
      aria-hidden="true"
    >
      {label.slice(0, 3).toUpperCase()}
    </span>
  );
}
function Notice({
  children,
  retry,
}: {
  children: React.ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="lb-empty" role="status">
      <p>{children}</p>
      {retry && (
        <button onClick={retry}>
          Try again <Icon name="arrow" />
        </button>
      )}
    </div>
  );
}
function Tabs({
  kind,
  onChange,
}: {
  kind: Kind;
  onChange: (kind: Kind) => void;
}) {
  return (
    <div className="lb-tabs" role="tablist" aria-label="Ranking type">
      {(["squads", "players"] as const).map((item) => (
        <button
          key={item}
          type="button"
          id={`${item}-ranking-tab`}
          role="tab"
          aria-selected={kind === item}
          aria-controls="full-ranking-panel"
          tabIndex={kind === item ? 0 : -1}
          onClick={() => onChange(item)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "squads"
                : event.key === "End"
                  ? "players"
                  : item === "squads"
                    ? "players"
                    : "squads";
            onChange(next);
            document.getElementById(`${next}-ranking-tab`)?.focus();
          }}
        >
          <Icon name={item === "squads" ? "trophy" : "target"} />
          {item === "squads" ? "Squads" : "Players"}
        </button>
      ))}
    </div>
  );
}
function SquadPodium({ standings }: { standings: SquadStanding[] }) {
  if (!standings.length) return null;
  return (
    <section className="lb-leaders" aria-label="Top ranked squads">
      <div className="lb-leaders-heading">
        <span><Icon name="trophy" /> TOP OF THE TABLE</span>
        <small>Squad leaders</small>
      </div>
      <div className="lb-podium">
        {standings.slice(0, 3).map((row, index) => (
          <article className={`lb-podium-card lb-place-${index + 1}`} key={row.squad.id}>
            <span className="lb-podium-rank">#{row.rank}</span>
            <RankCrest label={row.squad.clan.tag || row.squad.name} />
            <div className="lb-podium-identity">
              <small>{index === 0 ? "CURRENT LEADERS" : `RANK ${row.rank}`}</small>
              <strong>{squadIdentity({
                name: row.squad.name,
                squadNumber: row.squad.squad_number,
                clanTag: row.squad.clan.tag,
                clanName: row.squad.clan.name,
                clanSquadCount: row.squad.clan.squad_count,
              })}</strong>
              <span>{countLabel(row.total_kills, "kill")} · {countLabel(row.wins, "win")}</span>
            </div>
            <div className="lb-podium-score"><strong>{row.total_points}</strong><span>PTS</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}
function PlayerPodium({ players }: { players: PlayerRanking[] }) {
  if (!players.length) return null;
  return (
    <section className="lb-leaders" aria-label="Top ranked players">
      <div className="lb-leaders-heading">
        <span><Icon name="target" /> TOP FRAGGERS</span>
        <small>Player leaders</small>
      </div>
      <div className="lb-podium lb-podium-players">
        {players.slice(0, 3).map((player, index) => (
          <article className={`lb-podium-card lb-place-${index + 1}`} key={player.id}>
            <span className="lb-podium-rank">#{player.rank}</span>
            <RankCrest label={player.ign} player />
            <div className="lb-podium-identity">
              <small>{index === 0 ? "CURRENT LEADER" : `RANK ${player.rank}`}</small>
              <strong>{player.ign}</strong>
              <span>{countLabel(player.appearances, "game")} · {averageKills(player.total_kills, player.appearances)} avg</span>
            </div>
            <div className="lb-podium-score"><strong>{player.total_kills}</strong><span>KILLS</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}
function SquadBreakdown({ row }: { row: SquadStanding }) {
  if (!row.match_results.length)
    return (
      <div className="lb-detail-content">
        <p className="lb-table-note">No game results for this squad yet.</p>
      </div>
    );
  return (
    <div className="lb-detail-content">
      <p className="lb-detail-title">
        Game results · {countLabel(row.matches_played, "game")} ·{" "}
        {countLabel(row.wins, "win")}
      </p>
      <div className="lb-live-matches">
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
    return <div className="lb-detail-content">Loading player statistics…</div>;
  if (state.status === "error")
    return (
      <div className="lb-detail-content">
        <p>{state.message}</p>
        <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </div>
    );
  const p = state.data;
  return (
    <div className="lb-detail-content">
      <div className="lb-detail-stats">
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
      <p className="lb-detail-title">
        Recent games{" "}
        {p.history_meta.total > p.match_history.length
          ? `(showing ${p.match_history.length} of ${p.history_meta.total})`
          : ""}
      </p>
      <div className="lb-live-matches">
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
  const [bestGames, setBestGames] = useState<Record<string, number | null>>({});
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
    if (kind !== "players" || players.status !== "ready") return;
    const controller = new AbortController();
    const queue = [...players.data.data];
    setBestGames({});
    async function loadProfiles() {
      while (queue.length && !controller.signal.aborted) {
        const player = queue.shift()!;
        try {
          const { data } = await api.player(player.id, 1, controller.signal);
          if (!controller.signal.aborted)
            setBestGames((current) => ({
              ...current,
              [player.id]: data.best_game_kills,
            }));
        } catch {
          if (!controller.signal.aborted)
            setBestGames((current) => ({ ...current, [player.id]: null }));
        }
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, loadProfiles),
    );
    return () => controller.abort();
  }, [kind, players]);
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("type", kind);
    if (seasonId) p.set("season", seasonId);
    else if (event) p.set("event", event);
    if (kind === "players" && playerPage > 1) p.set("page", String(playerPage));
    if (kind === "squads" && query.trim()) p.set("q", query.trim());
    window.history.replaceState(null, "", `/leaderboard?${p}`);
    document.title = `${kind === "squads" ? "Squad" : "Player"} leaderboard — ArewaVanta`;
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
  return (
    <div className="lb-page">
      <a className="skip-link" href="#standings-content">
        Skip to standings
      </a>
      <header className="lb-site-header">
        <Brand href="/" />
        <nav aria-label="Main navigation">
          <a href="/">Home</a>
          <a href="/competitions">Competitions</a>
          <a href="/leaderboard" aria-current="page">
            Leaderboards
          </a>
          <a href="/clans">Clans</a>
          <a href="/players">Players</a>
        </nav>
      </header>
      <main className="lb-main" id="standings-content">
        <div className="lb-page-title">
          <div>
            <span className="lb-overline">NIGERIA / AREWA CODM COMMUNITY</span>
            <h1>
              LEADERBOARDS<span>.</span>
            </h1>
            <p>Weekend scrims. Every squad. Every player.</p>
          </div>
          <div className="lb-title-emblem" aria-hidden="true">
            <Icon name="trophy" />
            <span>
              THE NORTH
              <br />
              KEEPS SCORE.
            </span>
          </div>
        </div>
        <Tabs kind={kind} onChange={changeKind} />
        {kind === "squads" && (
          <section
            className="lb-competition-bar"
            aria-label="Competition filter"
          >
            <div className="lb-event-picker">
              <Icon name="calendar" />
              <label>
                <span>COMPETITION OR SEASON</span>
                <select
                  aria-label="Competition or season"
                  value={seasonId ? `season:${seasonId}` : event}
                  disabled={
                    events.status !== "ready" || events.data.length === 0
                  }
                  onChange={(e) => {
                    setStandings({ status: "loading" });
                    if (e.target.value.startsWith("season:")) {
                      setSeasonId(e.target.value.slice(7));
                    } else {
                      setSeasonId("");
                      setEvent(e.target.value);
                    }
                    setExpanded(null);
                    setQuery("");
                  }}
                >
                  {events.status !== "ready" || events.data.length === 0 ? (
                    <option value="">
                      {events.status === "loading"
                        ? "Loading competitions…"
                        : "No competitions available"}
                    </option>
                  ) : (
                    <>
                      <optgroup label="Competitions">
                        {events.data.map((item) => (
                          <option key={item.id} value={item.slug}>
                            {item.title}
                          </option>
                        ))}
                      </optgroup>
                      {seasons.length > 0 && (
                        <optgroup label="Seasons">
                          {seasons.map((item) => (
                            <option key={item.id} value={`season:${item.id}`}>
                              {item.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  )}
                </select>
              </label>
            </div>
            {currentEvent && !seasonId && (
              <div className="lb-event-context">
                <span>
                  {formatDateRange(
                    currentEvent.start_date,
                    currentEvent.end_date,
                  )}
                </span>
                <strong>
                  {gamesWithResults(
                    currentEvent.scored_match_count,
                    currentEvent.match_count,
                  )}
                </strong>
              </div>
            )}
            {currentSeason && (
              <div className="lb-event-context">
                <span>{currentSeason.name}</span>
                <strong>Combined season standings</strong>
              </div>
            )}
          </section>
        )}
        {kind === "players" && (
          <p className="lb-live-context">
            Player rankings cover all public competitions.
          </p>
        )}
        <section
          role="tabpanel"
          id="full-ranking-panel"
          aria-labelledby={`${kind}-ranking-tab`}
          tabIndex={0}
        >
          {kind === "squads" ? (
            <>
              {events.status === "loading" && (
                <Notice>Loading competitions…</Notice>
              )}
              {events.status === "error" && (
                <Notice retry={() => setRetry((n) => n + 1)}>
                  {events.message}
                </Notice>
              )}
              {events.status === "ready" && events.data.length === 0 && (
                <Notice>
                  No competitions yet. Standings will appear when an organizer
                  creates an event.
                </Notice>
              )}
              {activeContext && standings.status === "loading" && (
                <Notice>Loading standings…</Notice>
              )}
              {activeContext && standings.status === "error" && (
                <Notice retry={() => setRetry((n) => n + 1)}>
                  {standings.message}
                </Notice>
              )}
              {activeContext && standings.status === "ready" && (
                <>
                  <SquadPodium
                    standings={standings.data.standings.filter(
                      (row) => row.matches_played > 0,
                    )}
                  />
                  <section
                    className="lb-results"
                    aria-labelledby="all-rankings-title"
                  >
                    <div className="lb-results-heading">
                      <div>
                        <span className="lb-overline">
                          {activeContext.title}
                        </span>
                        <h2 id="all-rankings-title">
                          Squad standings{" "}
                          <span>
                            {countLabel(
                              standings.data.standings.length,
                              "squad",
                            )}
                          </span>
                        </h2>
                      </div>
                      <span className="lb-rules">
                        {standings.data.uses_mixed_scoring_presets
                          ? "Games use different scoring rules. Points from every game are added together."
                          : "Ranked by points, kills and wins."}
                      </span>
                    </div>
                    <div className="lb-tools">
                      <label className="lb-search">
                        <span className="sr-only">Search squads</span>
                        <input
                          value={query}
                          placeholder="Find your squad…"
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <label className="lb-sort">
                        <span>SORT</span>
                        <select
                          aria-label="Sort standings"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="rank">Official rank</option>
                          <option value="kills">Most kills</option>
                        </select>
                      </label>
                    </div>
                    <p className="lb-swipe-hint">
                      Swipe sideways to see all columns <Icon name="arrow" />
                    </p>
                    <div
                      className="lb-table-wrap"
                      role="region"
                      aria-label="Squad standings table"
                      tabIndex={0}
                    >
                      <table className="lb-table">
                        <caption className="sr-only">
                          {activeContext.title} squad standings
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Squad</th>
                            <th scope="col" className="lb-col-games">Games</th>
                            <th scope="col" className="lb-col-wins">Wins</th>
                            <th scope="col">Kills</th>
                            <th scope="col">Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <Fragment key={row.squad.id}>
                              <tr
                                className={`lb-result-row lb-rank-${row.rank <= 3 ? row.rank : "other"}${row.rank === 1 ? " lb-row-leader" : ""}`}
                              >
                                <td className="lb-rank">{row.rank}</td>
                                <th scope="row">
                                  <button
                                    className="lb-identity"
                                    aria-expanded={expanded === row.squad.id}
                                    onClick={() =>
                                      setExpanded(
                                        expanded === row.squad.id
                                          ? null
                                          : row.squad.id,
                                      )
                                    }
                                  >
                                    <RankCrest
                                      label={row.squad.clan.tag || row.squad.name}
                                    />
                                    <span>
                                      <strong>{squadIdentity({
                                        name: row.squad.name,
                                        squadNumber: row.squad.squad_number,
                                        clanTag: row.squad.clan.tag,
                                        clanName: row.squad.clan.name,
                                        clanSquadCount: row.squad.clan.squad_count,
                                      })}</strong>
                                    </span>
                                    <Icon name="chevron" />
                                  </button>
                                </th>
                                <td className="lb-col-games">
                                  {row.matches_played}
                                </td>
                                <td className="lb-col-wins">{row.wins}</td>
                                <td>{row.total_kills}</td>
                                <td className="lb-score">
                                  <strong>{row.total_points}</strong>
                                </td>
                              </tr>
                              {expanded === row.squad.id && (
                                <tr className="lb-detail-row">
                                  <td colSpan={6}>
                                    <SquadBreakdown row={row} />
                                    <a
                                      className="lb-profile-link"
                                      href={`/squads/${encodeURIComponent(row.squad.slug)}`}
                                    >
                                      View squad profile →
                                    </a>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                      {!rows.length && (
                        <Notice>
                          {query
                            ? "No squads match your search."
                            : "No squads have entered this competition yet."}
                        </Notice>
                      )}
                    </div>
                    <p className="lb-table-note">
                      Select a squad to see its game-by-game results.
                    </p>
                  </section>
                </>
              )}
            </>
          ) : (
            <>
              {players.status === "loading" && (
                <Notice>Loading player rankings…</Notice>
              )}
              {players.status === "error" && (
                <Notice retry={() => setRetry((n) => n + 1)}>
                  {players.message}
                </Notice>
              )}
              {players.status === "ready" && (
                <>
                  {playerPage === 1 && <PlayerPodium players={players.data.data} />}
                  <section
                    className="lb-results"
                    aria-labelledby="all-rankings-title"
                  >
                    <div className="lb-results-heading">
                      <div>
                        <span className="lb-overline">
                          ALL PUBLIC COMPETITIONS
                        </span>
                        <h2 id="all-rankings-title">
                          Player rankings{" "}
                          <span>
                            {countLabel(players.data.total, "player")}
                          </span>
                        </h2>
                      </div>
                      <span className="lb-rules">
                        Ranked by total kills. Equal kills share a rank.
                      </span>
                    </div>
                    <p className="lb-swipe-hint">
                      Swipe sideways to see all columns <Icon name="arrow" />
                    </p>
                    <div
                      className="lb-table-wrap"
                      role="region"
                      aria-label="Player rankings table"
                      tabIndex={0}
                    >
                      <table className="lb-table">
                        <caption className="sr-only">
                          Player rankings across public competitions
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Player</th>
                            <th scope="col" className="lb-col-games">Games</th>
                            <th scope="col">Avg kills</th>
                            <th scope="col" className="lb-col-best">Best game</th>
                            <th scope="col">Kills</th>
                          </tr>
                        </thead>
                        <tbody>
                          {players.data.data.map((player) => (
                            <Fragment key={player.id}>
                              <tr
                                className={`lb-result-row lb-rank-${player.rank <= 3 ? player.rank : "other"}${player.rank === 1 ? " lb-row-leader" : ""}`}
                              >
                                <td className="lb-rank">{player.rank}</td>
                                <th scope="row">
                                  <button
                                    className="lb-identity"
                                    aria-expanded={expanded === player.id}
                                    onClick={() =>
                                      setExpanded(
                                        expanded === player.id
                                          ? null
                                          : player.id,
                                      )
                                    }
                                  >
                                    <RankCrest label={player.ign} player />
                                    <span>
                                      <strong>{player.ign}</strong>
                                    </span>
                                    <Icon name="chevron" />
                                  </button>
                                </th>
                                <td>{player.appearances}</td>
                                <td>
                                  {averageKills(
                                    player.total_kills,
                                    player.appearances,
                                  )}
                                </td>
                                <td className="lb-col-best">
                                  {Object.hasOwn(bestGames, player.id)
                                    ? (bestGames[player.id] ?? "—")
                                    : "…"}
                                </td>
                                <td className="lb-score">
                                  <strong>{player.total_kills}</strong>
                                </td>
                              </tr>
                              {expanded === player.id && (
                                <tr className="lb-detail-row">
                                  <td colSpan={6}>
                                    <PlayerBreakdown playerId={player.id} />
                                    <a
                                      className="lb-profile-link"
                                      href={`/players/${encodeURIComponent(player.id)}`}
                                    >
                                      View player profile →
                                    </a>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                      {players.data.total === 0 && (
                        <Notice>
                          No player rankings yet. They will appear after results
                          are saved.
                        </Notice>
                      )}
                    </div>
                    {players.data.total > 0 && (
                      <div className="lb-pagination">
                        <span>
                          Page {playerPage} of {players.data.lastPage} ·{" "}
                          {countLabel(players.data.total, "player")}
                        </span>
                        <div>
                          <button
                            aria-label="Previous page"
                            disabled={playerPage === 1}
                            onClick={() => {
                              setPlayerPage((p) => p - 1);
                              setExpanded(null);
                            }}
                          >
                            <Icon name="arrow" />
                          </button>
                          <button
                            aria-label="Next page"
                            disabled={playerPage >= players.data.lastPage}
                            onClick={() => {
                              setPlayerPage((p) => p + 1);
                              setExpanded(null);
                            }}
                          >
                            <Icon name="arrow" />
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="lb-table-note">
                      Select a player to see their recent games.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
        </section>
        <footer className="lb-footer">
          <Brand href="/" />
          <p>For the north. For the game.</p>
          <a href="/#schedule">
            Next weekend’s games <Icon name="arrow" />
          </a>
        </footer>
      </main>
    </div>
  );
}
