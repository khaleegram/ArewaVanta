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
import { pageMetadata, SITE_ORIGIN, usePageSeo } from "./seo";
import {
  competitionLabel as displayCompetitionLabel,
  countLabel,
  formatDate,
  formatDateRange,
  placementLabel,
  scoringLabel,
  squadIdentity,
} from "./presentation";
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
export const dateText = (date: string | null) => formatDate(date);
const dates = (event: EventSummary) =>
  formatDateRange(event.start_date, event.end_date);
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
  displayCompetitionLabel(event);
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
  usePageSeo(pageMetadata.competitions);
  const filtered = events.status === "ready"
    ? [...new Set(events.data.map((event) => event.series_id ?? event.id))]
        .map((seriesKey) => {
          const weeks = events.data.filter((event) => (event.series_id ?? event.id) === seriesKey);
          const firstDate = (event: EventSummary) => event.start_date ?? "";
          const isUpcoming = (event: EventSummary) => !event.skipped_at && !!event.start_date && (event.end_date ?? event.start_date) >= today(event.timezone);
          const eligible = filter === "upcoming"
            ? weeks.filter(isUpcoming)
            : filter === "previous"
              ? weeks.filter((event) => !!(event.end_date ?? event.start_date) && (event.end_date ?? event.start_date)! < today(event.timezone))
              : filter === "results"
                ? weeks.filter((event) => event.scored_match_count > 0)
                : weeks;
          if (!eligible.length) return undefined;
          const ordered = [...eligible].sort((a, b) => firstDate(a).localeCompare(firstDate(b)));
          if (filter === "upcoming") return ordered[0];
          if (filter === "all") return ordered.find(isUpcoming) ?? ordered.at(-1);
          return ordered.at(-1);
        })
        .filter((event): event is EventSummary => !!event)
        .sort((a, b) => filter === "upcoming"
          ? (a.start_date ?? "").localeCompare(b.start_date ?? "")
          : (b.start_date ?? "").localeCompare(a.start_date ?? ""))
    : [];
  return (
    <Shell>
      <div className="competition-listing">
        <header className="competition-listing-heading">
          <p className="public-kicker">AREWA CODM · BATTLE ROYALE</p>
          <h1>Competitions<span>.</span></h1>
          <p>Weekend scrims, leagues and tournaments across the community.</p>
        </header>
        <div className="competition-listing-filters" aria-label="Filter competitions">
          {(
            [
              ["all", "All"],
              ["upcoming", "Upcoming"],
              ["results", "With results"],
              ["previous", "Previous"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <Notice
          state={events}
          retry={retry}
          empty={events.status === "ready" && !filtered.length ? "No competitions to show here yet." : undefined}
        />
        <div className="competition-listing-items">
          {filtered.map((event) => (
            <a className="competition-listing-item" href={eventUrl(event.slug)} key={event.id}>
              <span className="competition-listing-date"><Icon name="calendar" /><span>{dates(event)}</span></span>
              <span className="competition-listing-copy">
                <span className="competition-listing-type">
                  <span>{event.series_id ? "Weekly CODM scrims" : competitionLabel(event)}</span>
                  {event.series_id && <span>Every week</span>}
                  {event.skipped_at && <span className="competition-listing-paused">Not playing</span>}
                </span>
                <strong className="competition-listing-name">{event.title}</strong>
                <span className="competition-listing-facts">
                  <span>{countLabel(event.match_count, "game")}</span>
                  {event.squad_capacity ? <span>{event.squad_count ?? 0} / {event.squad_capacity} squads</span> : null}
                  {event.scored_match_count > 0 ? <span>{countLabel(event.scored_match_count, "game")} with results</span> : null}
                </span>
              </span>
              <span className="competition-listing-arrow" aria-hidden="true"><Icon name="arrow" /></span>
            </a>
          ))}
        </div>
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
          Games use different scoring rules. Points from every game are added
          together.
        </p>
      )}
      <div className="public-table-scroll">
        <table className="public-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Squad</th>
              <th className="public-col-games">Games</th>
              <th>Kills</th>
              <th className="public-col-wins">Wins</th>
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
                      {squadIdentity({
                        name: row.squad.name,
                        squadNumber: row.squad.squad_number,
                        clanTag: row.squad.clan.tag,
                        clanName: row.squad.clan.name,
                        clanSquadCount: row.squad.clan.squad_count,
                      })}
                    </a>
                  </strong>
                  <small className="public-mobile-meta">
                    {countLabel(row.matches_played, "game")} ·{" "}
                    {countLabel(row.wins, "win")}
                  </small>
                </th>
                <td className="public-col-games">{row.matches_played}</td>
                <td>{row.total_kills}</td>
                <td className="public-col-wins">{row.wins}</td>
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
  const detailDescription = data?.description?.trim() || (data
    ? `${data.title} is an Arewa CODM Battle Royale competition in Nigeria. ${data.series_id ? "This weekly scrim series brings squads back every weekend. " : ""}See the ${dates(data)} schedule, participating squads, standings and match results.`
    : "View Arewa CODM Battle Royale competition schedules, participating squads, standings and match results.");
  const detailTitle = data
    ? `${data.series_id ? "Weekly Arewa CODM Scrims" : data.title} — ${dates(data)} | ArewaVanta`
    : "Arewa CODM Competition Schedule & Results | ArewaVanta";
  usePageSeo({
    title: detailTitle,
    description: detailDescription,
    path: `/competitions/${encodeURIComponent(slug)}`,
    schema: data ? {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Competitions", item: `${SITE_ORIGIN}/competitions` },
        { "@type": "ListItem", position: 3, name: data.title, item: `${SITE_ORIGIN}/competitions/${encodeURIComponent(slug)}` },
      ],
    } : undefined,
  });
  return (
    <Shell>
      <div className="public-event-detail">
        <a className="public-back" href="/competitions">
          <Icon name="arrow" /> All competitions
        </a>
        <Notice state={event} retry={retryEvent} />
        {data && (
          <>
            <section className="public-detail-overview" aria-labelledby="public-event-title">
              <div className="public-detail-heading">
                <span className="public-detail-emblem" aria-hidden="true"><Icon name="trophy" /></span>
                <div className="public-detail-heading-copy">
                  <p className="public-kicker">{competitionLabel(data)} <span>· AREWA CODM</span></p>
                  <h1 id="public-event-title">{data.title}<span>.</span></h1>
                  <div className="public-detail-meta">
                    <span><Icon name="calendar" />{dates(data)}</span>
                    {data.skipped_at && <span className="public-detail-week-off" role="status">Not playing this week</span>}
                  </div>
                  {data.description && <p className="public-detail-description">{data.description}</p>}
                  {data.skipped_at && data.skip_reason && <p className="public-detail-skip-reason">{data.skip_reason}</p>}
                </div>
              </div>
              <div className="public-detail-facts">
                <div><strong>{data.squads.length}{data.squad_capacity ? <span> / {data.squad_capacity}</span> : null}</strong><small>Squads entered</small></div>
                <div><strong>{data.match_count}</strong><small>Games scheduled</small></div>
                <div><strong className="public-detail-scoring">{scoringLabel(data.default_scoring.preset_name)}</strong><small>Scoring preset</small></div>
              </div>
            </section>
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
            <section className="public-section public-detail-section">
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
                                  ? " · Custom scoring"
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
                                : "Results pending"}
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
            <section className="public-section public-detail-section">
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
            <section className="public-section public-detail-section">
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
                        {(squad.clan.tag || squad.name).slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{squadIdentity({
                          name: squad.name,
                          squadNumber: squad.squad_number,
                          clanTag: squad.clan.tag,
                          clanName: squad.clan.name,
                          clanSquadCount: squad.clan.squad_count,
                        })}</strong>
                        <small>{squad.slot_number ? `Game slot ${squad.slot_number}` : "Registered squad"}</small>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="public-notice">
                  Squads appear here after the organizer assigns competition slots.
                </div>
              )}
            </section>
          )}
        </>
      )}
      </div>
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
  const matchDescription = match && day && data
    ? `${match.map_label} Game ${match.match_index} in ${data.title}, played ${dateText(day.date)}. ${match.has_results ? "See squad placements, kills and player match statistics." : "The match schedule and results status are available here."}`
    : "View Arewa CODM Battle Royale game schedules, squad placements, kills and match results.";
  usePageSeo({
    title: match && data
      ? `${data.title} Game ${match.match_index} on ${match.map_label} | ArewaVanta`
      : "Arewa CODM Game Results | ArewaVanta",
    description: matchDescription,
    path: `/competitions/${encodeURIComponent(slug)}/games/${encodeURIComponent(matchId)}`,
    schema: data && match ? {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Competitions", item: `${SITE_ORIGIN}/competitions` },
        { "@type": "ListItem", position: 3, name: data.title, item: `${SITE_ORIGIN}/competitions/${encodeURIComponent(slug)}` },
        { "@type": "ListItem", position: 4, name: `Game ${match.match_index}`, item: `${SITE_ORIGIN}/competitions/${encodeURIComponent(slug)}/games/${encodeURIComponent(matchId)}` },
      ],
    } : undefined,
  });
  return (
    <Shell>
      <div className="public-match-page">
        <a className="public-back" href={eventUrl(slug)}>
          <Icon name="arrow" /> Competition
        </a>
        <Notice state={event} retry={retryEvent} />
        {data && !match && (
          <div className="public-match-empty">This game is not part of this competition.</div>
        )}
        {data && match && day && (
          <>
            <header className="public-match-hero">
              <div className="public-match-context">
                <p className="public-kicker">
                  <a href={eventUrl(slug)}>{data.title}</a><span>· {day.label}</span>
                </p>
                <span className={`public-match-state${match.has_results ? " is-complete" : ""}`}>
                  <i />{match.has_results ? "Results available" : "Awaiting results"}
                </span>
              </div>
              <div className="public-match-title-row">
                <span className="public-match-index">{String(match.match_index).padStart(2, "0")}</span>
                <div>
                  <h1>{match.map_label}<span>.</span></h1>
                  <p><Icon name="calendar" />{dateText(day.date)}<span>·</span>Game {match.match_index}</p>
                </div>
              </div>
              <div className="public-match-scoring">
                <span>Scoring preset</span>
                <strong>
                  {typeof match.scoring.preset_name === "string"
                    ? match.scoring.preset_name
                    : match.is_scoring_override
                      ? "Custom scoring"
                      : scoringLabel(data.default_scoring.preset_name)}
                </strong>
              </div>
            </header>
            <section className="public-match-results">
              <div className="public-match-section-head">
                <div>
                  <p className="public-kicker">{match.has_results ? "FINAL SCORES" : "MATCH"}</p>
                  <h2>Squad results<span>.</span></h2>
                </div>
                <a href={eventUrl(slug)}>All games <Icon name="arrow" /></a>
              </div>
              {!match.has_results ? (
                <div className="public-match-empty">Results are not available for this game yet.</div>
              ) : (
                <>
                  <Notice state={result} retry={retryResult} />
                  {result.status === "ready" && !saved && (
                    <div className="public-match-empty" role="alert">
                      We couldn’t load the results for this game. Please try again.
                    </div>
                  )}
                  {saved && (saved.result.results.length ? (
                    <div className="public-result-list">
                      {[...saved.result.results]
                        .sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity))
                        .map((row) => (
                          <article className="public-result" key={row.squad_id}>
                            <div className="public-result-heading">
                              <div>
                                <span className="public-row-label">
                                  {row.participation_status === "absent" ? "ABSENT" : placementLabel(row.placement)}
                                </span>
                                <h3>
                                  {row.squad_slug ? (
                                    <a href={`/squads/${encodeURIComponent(row.squad_slug)}`}>
                                      {squadIdentity({ name: row.squad_name, squadNumber: row.squad_number, clanTag: row.clan_tag, clanName: row.clan_name, clanSquadCount: row.clan_squad_count })}
                                    </a>
                                  ) : squadIdentity({ name: row.squad_name, squadNumber: row.squad_number, clanTag: row.clan_tag, clanName: row.clan_name, clanSquadCount: row.clan_squad_count })}
                                </h3>
                              </div>
                              <div className="public-result-points">
                                <strong>{row.total_points}</strong>
                                <span>POINTS</span>
                              </div>
                            </div>
                            {row.participation_status === "present" && (
                              <>
                                <div className="public-score-grid">
                                  <div><span>Squad kills</span><strong>{row.team_kills}</strong></div>
                                  <div><span>Kill points</span><strong>{row.kill_points ?? "—"}</strong></div>
                                  <div>
                                    <span>{row.placement_multiplier !== null ? "Placement bonus" : "Placement points"}</span>
                                    <strong>{row.placement_multiplier !== null ? `×${row.placement_multiplier}` : (row.placement_points ?? "—")}</strong>
                                  </div>
                                </div>
                                <div className="public-match-players">
                                  <table className="public-player-table">
                                    <thead><tr><th>Player</th><th>Kills</th></tr></thead>
                                    <tbody>
                                      {row.players.map((player) => (
                                        <tr key={player.player_id}>
                                          <th scope="row"><a className="public-inline-link" href={`/players/${encodeURIComponent(player.player_id)}`}>{player.ign}</a></th>
                                          <td>{player.kills}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                          </article>
                        ))}
                    </div>
                  ) : (
                    <div className="public-match-empty">No squad results were recorded for this game.</div>
                  ))}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
