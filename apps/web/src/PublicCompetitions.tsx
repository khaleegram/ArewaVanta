import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { allPublicEvents } from "./api/events";
import type {
  EventSummary,
  EventStandings,
  PublicEvent,
  PublicMatchResult,
} from "./api/types";
import { Brand, Icon } from "./ui";
import "./public-competitions.css";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  enabled = true,
): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ status: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [key, retry, enabled]);
  return [state, () => setRetry((value) => value + 1)];
}
export const dateText = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`))
    : "Date to be announced";
const dates = (event: EventSummary) =>
  event.end_date && event.end_date !== event.start_date
    ? `${dateText(event.start_date)} – ${dateText(event.end_date)}`
    : dateText(event.start_date);
function today(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}
const eventUrl = (slug: string) => `/competitions/${encodeURIComponent(slug)}`;
const competitionLabel = (event: EventSummary) =>
  event.competition_type
    ? event.competition_type.toUpperCase()
    : (event.season?.name ?? "AREWA CODM");
const matchUrl = (slug: string, id: string) =>
  `${eventUrl(slug)}/games/${encodeURIComponent(id)}`;
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-page">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="public-header">
        <div className="public-wrap public-header-inner">
          <Brand href="/" />
          <nav aria-label="Main navigation">
            <a href="/">Home</a>
            <a
              href="/competitions"
              aria-current={
                location.pathname.startsWith("/competitions")
                  ? "page"
                  : undefined
              }
            >
              Competitions
            </a>
            <a href="/leaderboard">Rankings</a>
            <a
              href="/clans"
              aria-current={
                location.pathname.startsWith("/clans") ||
                location.pathname.startsWith("/squads")
                  ? "page"
                  : undefined
              }
            >
              Clans
            </a>
            <a
              href="/players"
              aria-current={
                location.pathname.startsWith("/players") ? "page" : undefined
              }
            >
              Players
            </a>
          </nav>
        </div>
      </header>
      <main id="content" className="public-wrap">
        {children}
      </main>
      <footer className="public-footer">
        <div className="public-wrap">
          <Brand href="/" />
          <span>Arewa CODM · Battle Royale</span>
          <a href="/leaderboard">
            Rankings <Icon name="arrow" />
          </a>
        </div>
      </footer>
    </div>
  );
}
export function Notice({
  state,
  retry,
  empty,
}: {
  state: Load<unknown>;
  retry: () => void;
  empty?: string;
}) {
  if (state.status === "ready" && !empty) return null;
  return (
    <div className="public-notice" role="status">
      <p>
        {state.status === "loading"
          ? "Loading…"
          : state.status === "error"
            ? state.message
            : empty}
      </p>
      {state.status === "error" && (
        <button onClick={retry}>
          Try again <Icon name="arrow" />
        </button>
      )}
    </div>
  );
}
export function CompetitionListing() {
  const [events, retry] = useLoad(
    (signal) => allPublicEvents(signal),
    "events",
  );
  const [filter, setFilter] = useState<
    "upcoming" | "results" | "previous" | "all"
  >("all");
  const filtered =
    events.status === "ready"
      ? events.data
          .filter((event) => {
            const end = event.end_date ?? event.start_date;
            const isPrevious = !!end && end < today(event.timezone);
            if (filter === "upcoming")
              return (
                !!event.start_date &&
                (event.end_date ?? event.start_date) >= today(event.timezone)
              );
            if (filter === "previous") return isPrevious;
            if (filter === "results") return event.scored_match_count > 0;
            return true;
          })
          .sort((a, b) =>
            filter === "upcoming"
              ? (a.start_date ?? "").localeCompare(b.start_date ?? "")
              : (b.start_date ?? "").localeCompare(a.start_date ?? ""),
          )
      : [];
  return (
    <Shell>
      <div className="public-intro">
        <p className="public-kicker">AREWA CODM · BATTLE ROYALE</p>
        <h1>
          Competitions<span>.</span>
        </h1>
        <p>Find the games, results and standings from across the community.</p>
      </div>
      <div className="public-filters" aria-label="Filter competitions">
        {(
          [
            ["all", "All"],
            ["upcoming", "Upcoming"],
            ["results", "With results"],
            ["previous", "Previous"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <Notice
        state={events}
        retry={retry}
        empty={
          events.status === "ready" && !filtered.length
            ? "No competitions to show here yet."
            : undefined
        }
      />
      <div className="public-list">
        {filtered.map((event) => (
          <a
            className="public-event-row"
            href={eventUrl(event.slug)}
            key={event.id}
          >
            <div>
              <span className="public-row-label">
                {competitionLabel(event)}
              </span>
              <h2>{event.title}</h2>
              <p>
                {dates(event)} <span>·</span> {event.match_count} games
                {event.squad_count !== undefined && (
                  <>
                    {" "}
                    <span>·</span> {event.squad_count} squads
                  </>
                )}
              </p>
              <small>
                {event.scored_match_count > 0
                  ? `${event.scored_match_count} ${event.scored_match_count === 1 ? "game" : "games"} with results`
                  : "Results not yet available"}
              </small>
            </div>
            <Icon name="arrow" />
          </a>
        ))}
      </div>
    </Shell>
  );
}
function StandingTable({ data }: { data: EventStandings }) {
  const rows = data.standings.filter((row) => row.matches_played > 0);
  if (!rows.length)
    return (
      <div className="public-notice">
        No standings yet. Results appear after a game is saved.
      </div>
    );
  return (
    <>
      {data.uses_mixed_scoring_presets && (
        <p className="public-note">
          Games use different scoring presets; totals combine the points awarded
          in each game.
        </p>
      )}
      <div className="public-table-scroll">
        <table className="public-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Squad</th>
              <th>Games</th>
              <th>Kills</th>
              <th>Wins</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.squad.id}>
                <td className="public-rank">{row.rank}</td>
                <th scope="row">
                  <strong>
                    <a
                      className="public-inline-link"
                      href={`/squads/${encodeURIComponent(row.squad.slug)}`}
                    >
                      {row.squad.name}
                    </a>
                  </strong>
                  <small>{row.squad.clan.name}</small>
                </th>
                <td>{row.matches_played}</td>
                <td>{row.total_kills}</td>
                <td>{row.wins}</td>
                <td className="public-points">{row.total_points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function CompetitionDetail({ slug }: { slug: string }) {
  const [event, retryEvent] = useLoad(
    (signal) => api.event(slug, signal).then((response) => response.data),
    slug,
  );
  const [standings, retryStandings] = useLoad(
    (signal) =>
      api.eventStandings(slug, signal).then((response) => response.data),
    `${slug}-standings`,
  );
  const [tab, setTab] = useState<"schedule" | "standings" | "squads">(
    "schedule",
  );
  const [dayId, setDayId] = useState("");
  const data =
    event.status === "ready" && event.data.slug === slug
      ? event.data
      : undefined;
  const days = data
    ? [...data.days].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const day = days.find((item) => item.id === dayId) ?? days[0];
  return (
    <Shell>
      <a className="public-back" href="/competitions">
        ← All competitions
      </a>
      <Notice state={event} retry={retryEvent} />
      {data && (
        <>
          <div className="public-intro public-detail-intro">
            <p className="public-kicker">
              {competitionLabel(data)} · COMPETITION
            </p>
            <h1>
              {data.title}
              <span>.</span>
            </h1>
            <p>{dates(data)}</p>
            {data.description && <p>{data.description}</p>}
            <div className="public-facts">
              <span>
                <strong>{data.squads.length}</strong> squads
              </span>
              <span>
                <strong>{data.match_count}</strong> games
              </span>
              <span>
                Scoring:{" "}
                <strong>
                  {data.default_scoring.preset_name ?? "Not specified"}
                </strong>
              </span>
            </div>
          </div>
          <div
            className="public-filters public-detail-tabs"
            aria-label="Competition sections"
          >
            {(
              [
                ["schedule", "Games"],
                ["standings", "Standings"],
                ["squads", `Squads (${data.squads.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "schedule" && (
            <section className="public-section">
              <div className="public-section-title">
                <div>
                  <p className="public-kicker">DATES & MAPS</p>
                  <h2>
                    Game schedule<span>.</span>
                  </h2>
                </div>
              </div>
              {days.length ? (
                <>
                  <div className="public-days" aria-label="Competition day">
                    {days.map((item) => (
                      <button
                        key={item.id}
                        aria-pressed={day?.id === item.id}
                        onClick={() => setDayId(item.id)}
                      >
                        <strong>{item.label}</strong>
                        <span>{dateText(item.date)}</span>
                      </button>
                    ))}
                  </div>
                  {day?.matches.length ? (
                    <div className="public-list">
                      {[...day.matches]
                        .sort((a, b) => a.match_index - b.match_index)
                        .map((match) => (
                          <a
                            className="public-game"
                            key={match.id}
                            href={matchUrl(slug, match.id)}
                          >
                            <span className="public-game-number">
                              {String(match.match_index).padStart(2, "0")}
                            </span>
                            <span className="public-game-info">
                              <strong>{match.map_label}</strong>
                              <small>
                                Game {match.match_index}
                                {match.is_scoring_override
                                  ? " · Different scoring"
                                  : ""}
                              </small>
                            </span>
                            <span
                              className={
                                match.has_results
                                  ? "public-game-status scored"
                                  : "public-game-status"
                              }
                            >
                              {match.has_results
                                ? "View results"
                                : "Awaiting results"}
                            </span>
                            <Icon name="arrow" />
                          </a>
                        ))}
                    </div>
                  ) : (
                    <div className="public-notice">
                      No games scheduled for this day.
                    </div>
                  )}
                </>
              ) : (
                <div className="public-notice">
                  No games have been scheduled yet.
                </div>
              )}
            </section>
          )}
          {tab === "standings" && (
            <section className="public-section">
              <div className="public-section-title">
                <div>
                  <p className="public-kicker">COMPETITION RESULTS</p>
                  <h2>
                    Overall standings<span>.</span>
                  </h2>
                </div>
                <a
                  className="public-text-link"
                  href={`/leaderboard?type=squads&event=${encodeURIComponent(slug)}`}
                >
                  Full rankings →
                </a>
              </div>
              <Notice state={standings} retry={retryStandings} />
              {standings.status === "ready" && (
                <StandingTable data={standings.data} />
              )}
            </section>
          )}
          {tab === "squads" && (
            <section className="public-section">
              <div className="public-section-title">
                <div>
                  <p className="public-kicker">THE FIELD</p>
                  <h2>
                    Participating squads<span>.</span>
                  </h2>
                </div>
              </div>
              {data.squads.length ? (
                <div className="public-squads">
                  {data.squads.map((squad) => (
                    <a
                      href={`/squads/${encodeURIComponent(squad.slug)}`}
                      key={squad.id}
                    >
                      <span className="public-squad-mark">
                        {(squad.tag || squad.name).slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{squad.name}</strong>
                        <small>{squad.clan.name}</small>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="public-notice">
                  No squads have been added yet.
                </div>
              )}
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
export function MatchPage({
  slug,
  matchId,
}: {
  slug: string;
  matchId: string;
}) {
  const [event, retryEvent] = useLoad(
    (signal) => api.event(slug, signal).then((response) => response.data),
    slug,
  );
  const data =
    event.status === "ready" && event.data.slug === slug
      ? event.data
      : undefined;
  const day = data?.days.find((item) =>
    item.matches.some((match) => match.id === matchId),
  );
  const match = day?.matches.find((item) => item.id === matchId);
  const [result, retryResult] = useLoad(
    (signal) =>
      api.matchResults(matchId, signal).then((response) => response.data),
    matchId,
    !!match?.has_results,
  );
  const saved =
    result.status === "ready" &&
    result.data.match.event.slug === slug &&
    result.data.match.id === matchId
      ? result.data
      : undefined;
  return (
    <Shell>
      <a className="public-back" href={eventUrl(slug)}>
        ← Competition
      </a>
      <Notice state={event} retry={retryEvent} />
      {data && !match && (
        <div className="public-notice">
          This game is not part of this competition.
        </div>
      )}
      {data && match && day && (
        <>
          <div className="public-intro public-detail-intro">
            <p className="public-kicker">
              {data.title} · {day.label}
            </p>
            <h1>
              Game {match.match_index}
              <span>.</span>
            </h1>
            <p>
              {match.map_label} · {dateText(day.date)}
            </p>
            <div className="public-facts">
              <span>
                Scoring:{" "}
                <strong>
                  {typeof match.scoring.preset_name === "string"
                    ? match.scoring.preset_name
                    : match.is_scoring_override
                      ? "Game-specific rules"
                      : (data.default_scoring.preset_name ?? "Not specified")}
                </strong>
              </span>
            </div>
          </div>
          <section className="public-section">
            <div className="public-section-title">
              <div>
                <p className="public-kicker">
                  {match.has_results ? "SAVED RESULTS" : "GAME SCHEDULE"}
                </p>
                <h2>
                  Match results<span>.</span>
                </h2>
              </div>
              <a className="public-text-link" href={eventUrl(slug)}>
                All games →
              </a>
            </div>
            {!match.has_results ? (
              <div className="public-notice">
                Results have not been saved for this game yet.
              </div>
            ) : (
              <>
                <Notice state={result} retry={retryResult} />
                {result.status === "ready" && !saved && (
                  <div className="public-notice">
                    Results could not be matched to this competition.
                  </div>
                )}
                {saved &&
                  (saved.result.results.length ? (
                    <div className="public-result-list">
                      {[...saved.result.results]
                        .sort(
                          (a, b) =>
                            (a.placement ?? Infinity) -
                            (b.placement ?? Infinity),
                        )
                        .map((row) => (
                          <article className="public-result" key={row.squad_id}>
                            <div className="public-result-heading">
                              <div>
                                <span className="public-row-label">
                                  {row.participation_status === "absent"
                                    ? "ABSENT"
                                    : `PLACEMENT #${row.placement ?? "—"}`}
                                </span>
                                <h3>
                                  {row.squad_slug ? (
                                    <a
                                      href={`/squads/${encodeURIComponent(row.squad_slug)}`}
                                    >
                                      {row.squad_name}
                                    </a>
                                  ) : (
                                    row.squad_name
                                  )}
                                </h3>
                                {row.clan_name && (
                                  <small>{row.clan_name}</small>
                                )}
                              </div>
                              <div className="public-result-points">
                                <strong>{row.total_points}</strong>
                                <span>POINTS</span>
                              </div>
                            </div>
                            {row.participation_status === "present" && (
                              <>
                                <div className="public-score-grid">
                                  <div>
                                    <span>Squad kills</span>
                                    <strong>{row.team_kills}</strong>
                                  </div>
                                  <div>
                                    <span>Kill points</span>
                                    <strong>{row.kill_points ?? "—"}</strong>
                                  </div>
                                  <div>
                                    <span>
                                      {row.placement_multiplier !== null
                                        ? "Multiplier"
                                        : "Placement pts"}
                                    </span>
                                    <strong>
                                      {row.placement_multiplier !== null
                                        ? `×${row.placement_multiplier}`
                                        : (row.placement_points ?? "—")}
                                    </strong>
                                  </div>
                                </div>
                                <table className="public-player-table">
                                  <thead>
                                    <tr>
                                      <th>Player</th>
                                      <th>Kills</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.players.map((player) => (
                                      <tr key={player.player_id}>
                                        <th scope="row">
                                          <a
                                            className="public-inline-link"
                                            href={`/players/${encodeURIComponent(player.player_id)}`}
                                          >
                                            {player.ign}
                                          </a>
                                        </th>
                                        <td>{player.kills}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </article>
                        ))}
                    </div>
                  ) : (
                    <div className="public-notice">
                      No squad results were recorded for this game.
                    </div>
                  ))}
              </>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
