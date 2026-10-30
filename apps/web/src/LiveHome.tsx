import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api/client";
import { allPublicEvents } from "./api/events";
import type { EventStandings, EventSummary, PublicEvent } from "./api/types";
import { Brand, Icon } from "./ui";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
function localToday(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch {
    return localToday("Africa/Lagos");
  }
}
function formatDate(date: string | null) {
  if (!date) return "Date to be announced";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
function dateRange(event: EventSummary) {
  const first = formatDate(event.start_date);
  return event.end_date && event.end_date !== event.start_date
    ? `${first} – ${formatDate(event.end_date)}`
    : first;
}
function selectNext(events: EventSummary[]) {
  return [...events]
    .filter(
      (event) =>
        event.start_date &&
        (event.end_date ?? event.start_date) >= localToday(event.timezone),
    )
    .sort(
      (a, b) =>
        a.start_date!.localeCompare(b.start_date!) ||
        a.title.localeCompare(b.title),
    )[0];
}
function selectLatestScored(events: EventSummary[]) {
  return [...events]
    .filter((event) => event.scored_match_count > 0)
    .sort(
      (a, b) =>
        (b.end_date ?? b.start_date ?? "").localeCompare(
          a.end_date ?? a.start_date ?? "",
        ) || b.id.localeCompare(a.id),
    )[0];
}
function StateMessage({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="home-state" role="status">
      <p>{text}</p>
      {retry && (
        <button type="button" onClick={retry}>
          Try again <Icon name="arrow" />
        </button>
      )}
    </div>
  );
}
function Header() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <header className="hv-header">
      <div className="hv-header-inner">
        <Brand />
        <nav
          id="main-navigation"
          className={`hv-nav${open ? " is-open" : ""}`}
          aria-label="Main navigation"
        >
          <a href="/" onClick={() => setOpen(false)}>
            Home
          </a>
          <a href="/competitions" onClick={() => setOpen(false)}>
            All competitions
          </a>
          <a href="/leaderboard" onClick={() => setOpen(false)}>
            Rankings
          </a>
          <a href="/clans" onClick={() => setOpen(false)}>
            Clans
          </a>
          <a href="/players" onClick={() => setOpen(false)}>
            Players
          </a>
        </nav>
        <a className="hv-header-cta" href="/leaderboard">
          View rankings <Icon name="arrow" />
        </a>
        <button
          className="hv-menu"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="main-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
      </div>
    </header>
  );
}
export default function LiveHome() {
  const [events, setEvents] = useState<Load<EventSummary[]>>({
    status: "loading",
  });
  const [details, setDetails] = useState<Load<PublicEvent>>({
    status: "loading",
  });
  const [results, setResults] = useState<Load<EventStandings>>({
    status: "loading",
  });
  const [eventRetry, setEventRetry] = useState(0);
  const [detailsRetry, setDetailsRetry] = useState(0);
  const [resultsRetry, setResultsRetry] = useState(0);
  const [day, setDay] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setEvents({ status: "loading" });
    allPublicEvents(controller.signal)
      .then((data) => setEvents({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setEvents({ status: "error", message: errorText(error) });
      });
    return () => controller.abort();
  }, [eventRetry]);
  const next = useMemo(
    () => (events.status === "ready" ? selectNext(events.data) : undefined),
    [events],
  );
  const latest = useMemo(
    () =>
      events.status === "ready" ? selectLatestScored(events.data) : undefined,
    [events],
  );
  useEffect(() => {
    if (!next) return;
    const controller = new AbortController();
    setDay(0);
    setDetails({ status: "loading" });
    api
      .event(next.slug, controller.signal)
      .then(({ data }) => setDetails({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setDetails({ status: "error", message: errorText(error) });
      });
    return () => controller.abort();
  }, [next?.slug, detailsRetry]);
  useEffect(() => {
    if (!latest) return;
    const controller = new AbortController();
    setResults({ status: "loading" });
    api
      .eventStandings(latest.slug, controller.signal)
      .then(({ data }) => setResults({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setResults({ status: "error", message: errorText(error) });
      });
    return () => controller.abort();
  }, [latest?.slug, resultsRetry]);
  const days =
    details.status === "ready" && details.data.slug === next?.slug
      ? [...details.data.days].sort((a, b) => a.sort_order - b.sort_order)
      : [];
  const selected = days[day] ?? days[0];
  const rows =
    results.status === "ready" && results.data.event.slug === latest?.slug
      ? results.data.standings
          .filter((row) => row.matches_played > 0)
          .slice(0, 5)
      : [];
  return (
    <div className="hv-page home-live" id="home">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <section className="home-hero" aria-labelledby="hero-title">
          <div className="home-hero-art" aria-hidden="true" />
          <div className="home-wrap home-hero-content">
            <p className="home-eyebrow">
              <span /> AREWA CODM · BATTLE ROYALE
            </p>
            <h1 id="hero-title">
              Weekend scrims.
              <br />
              <em>Northern pride.</em>
            </h1>
            <p className="home-hero-description">
              Your home for Arewa CODM scrims, leagues and tournaments.
            </p>
            <div className="home-hero-actions">
              <a href="#schedule" className="home-button home-button-primary">
                View schedule <Icon name="arrow" />
              </a>
              <a href="#standings" className="home-button home-button-outline">
                Latest standings <Icon name="arrow" />
              </a>
            </div>
          </div>
        </section>
        <section
          className="home-wrap home-event"
          id="competition"
          aria-labelledby="event-title"
        >
          <div className="home-section-heading">
            <div>
              <p className="home-label">THE NEXT COMPETITION</p>
              <h2 id="event-title">
                Up next<span>.</span>
              </h2>
            </div>
            <a href="#schedule" className="home-link">
              View schedule <Icon name="arrow" />
            </a>
          </div>
          {events.status === "loading" && (
            <StateMessage text="Loading competitions…" />
          )}
          {events.status === "error" && (
            <StateMessage
              text={events.message}
              retry={() => setEventRetry((n) => n + 1)}
            />
          )}
          {events.status === "ready" && !next && (
            <StateMessage text="No upcoming competitions yet. Check back for the next scrim." />
          )}
          {next && (
            <article className="home-event-card">
              <div className="home-event-mark" aria-hidden="true">
                <Icon name="trophy" />
              </div>
              <div className="home-event-main">
                <span className="home-event-type">
                  AREWA CODM · BATTLE ROYALE
                </span>
                <h3>
                  <a href={`/competitions/${encodeURIComponent(next.slug)}`}>
                    {next.title}
                  </a>
                </h3>
                <p>
                  <Icon name="calendar" />
                  {dateRange(next)}
                </p>
              </div>
              <div className="home-event-count">
                <strong>{next.match_count}</strong>
                <span>GAMES</span>
              </div>
            </article>
          )}
        </section>
        <section
          className="home-wrap home-section"
          id="schedule"
          aria-labelledby="schedule-title"
        >
          <div className="home-section-heading">
            <div>
              <p className="home-label">DATES &amp; MAPS</p>
              <h2 id="schedule-title">
                Game schedule<span>.</span>
              </h2>
            </div>
            {next && <span className="home-context">{next.title}</span>}
          </div>
          {events.status === "loading" && (
            <StateMessage text="Loading schedule…" />
          )}
          {events.status === "error" && (
            <StateMessage
              text="The schedule is unavailable while competitions cannot be loaded."
              retry={() => setEventRetry((n) => n + 1)}
            />
          )}
          {events.status === "ready" && !next && (
            <StateMessage text="No upcoming games have been announced." />
          )}
          {next &&
            (details.status === "loading" ||
              (details.status === "ready" &&
                details.data.slug !== next.slug)) && (
              <StateMessage text="Loading games…" />
            )}
          {next && details.status === "error" && (
            <StateMessage
              text={details.message}
              retry={() => setDetailsRetry((n) => n + 1)}
            />
          )}
          {next &&
            details.status === "ready" &&
            details.data.slug === next.slug &&
            (days.length === 0 ? (
              <StateMessage text="No games have been scheduled for this competition." />
            ) : (
              <div className="home-schedule">
                <div
                  className="home-days"
                  role="group"
                  aria-label="Competition day"
                >
                  {days.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={day === index}
                      onClick={() => setDay(index)}
                    >
                      <span>{item.label}</span>
                      <strong>{formatDate(item.date)}</strong>
                    </button>
                  ))}
                </div>
                {selected?.matches.length ? (
                  <ol className="home-games">
                    {selected.matches.map((match) => (
                      <li key={match.id}>
                        <span className="home-game-number">
                          {String(match.match_index).padStart(2, "0")}
                        </span>
                        <span className="home-game-map">
                          <small>GAME {match.match_index}</small>
                          <strong>{match.map_label}</strong>
                          {match.is_scoring_override && (
                            <small>Different scoring rules</small>
                          )}
                        </span>
                        <span className="home-game-status">
                          {match.has_results
                            ? "Results saved"
                            : "Awaiting results"}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <StateMessage text="No games scheduled for this day." />
                )}
                <div className="home-schedule-foot">
                  <span>
                    Dates shown for {next.timezone.replaceAll("_", " ")}
                  </span>
                  <a
                    href={`/leaderboard?type=squads&event=${encodeURIComponent(next.slug)}`}
                    className="home-link"
                  >
                    Event standings <Icon name="arrow" />
                  </a>
                </div>
              </div>
            ))}
        </section>
        <section
          className="home-wrap home-section home-standings"
          id="standings"
          aria-labelledby="standings-title"
        >
          <div className="home-section-heading">
            <div>
              <p className="home-label">SQUAD RANKINGS</p>
              <h2 id="standings-title">
                Latest standings<span>.</span>
              </h2>
            </div>
            <a
              href={
                latest
                  ? `/leaderboard?type=squads&event=${encodeURIComponent(latest.slug)}`
                  : "/leaderboard"
              }
              className="home-link"
            >
              Full rankings <Icon name="arrow" />
            </a>
          </div>
          {events.status === "loading" && (
            <StateMessage text="Loading standings…" />
          )}
          {events.status === "error" && (
            <StateMessage
              text="Standings are unavailable while competitions cannot be loaded."
              retry={() => setEventRetry((n) => n + 1)}
            />
          )}
          {events.status === "ready" && !latest && (
            <StateMessage text="No results yet. Standings appear after the first games are saved." />
          )}
          {latest &&
            (results.status === "loading" ||
              (results.status === "ready" &&
                results.data.event.slug !== latest.slug)) && (
              <StateMessage text="Loading standings…" />
            )}
          {latest && results.status === "error" && (
            <StateMessage
              text={results.message}
              retry={() => setResultsRetry((n) => n + 1)}
            />
          )}
          {latest &&
            results.status === "ready" &&
            results.data.event.slug === latest.slug && (
              <>
                <div className="home-result-context">
                  <div>
                    <strong>{latest.title}</strong>
                    <span>
                      {latest.scored_match_count} of {latest.match_count} games
                      scored
                    </span>
                  </div>
                  {results.data.uses_mixed_scoring_presets && (
                    <span className="home-rules-note">Mixed scoring rules</span>
                  )}
                </div>
                {rows.length ? (
                  <div className="home-table-wrap">
                    <table className="home-table">
                      <caption className="sr-only">
                        {latest.title} squad standings
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Rank</th>
                          <th scope="col">Squad</th>
                          <th scope="col">Kills</th>
                          <th scope="col">Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.squad.id}>
                            <td className="home-rank">
                              {String(row.rank).padStart(2, "0")}
                            </td>
                            <th scope="row">
                              <span className="home-squad-tag">
                                {(row.squad.tag || row.squad.name)
                                  .slice(0, 3)
                                  .toUpperCase()}
                              </span>
                              <span className="home-squad-name">
                                {row.squad.name}
                              </span>
                            </th>
                            <td>{row.total_kills}</td>
                            <td className="home-points">{row.total_points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <StateMessage text="No saved squad results are available yet." />
                )}
                <div className="home-standings-foot">
                  <span>Showing up to 5 squads</span>
                  <a
                    href={`/leaderboard?type=squads&event=${encodeURIComponent(latest.slug)}`}
                    className="home-link"
                  >
                    View full table <Icon name="arrow" />
                  </a>
                </div>
              </>
            )}
        </section>
        <section className="home-community">
          <div className="home-wrap">
            <p className="home-label">OUR COMMUNITY</p>
            <h2>
              Built for the north<span>.</span>
            </h2>
            <p>
              One place for the squads, players and competitions bringing Arewa
              CODM together.
            </p>
            <a href="/leaderboard?type=players" className="home-link">
              View player rankings <Icon name="arrow" />
            </a>
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <div className="home-wrap home-footer-inner">
          <div>
            <Brand />
            <p>CODM Battle Royale · Arewa community</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#competition">Competition</a>
            <a href="/competitions">All competitions</a>
            <a href="/clans">Clans</a>
            <a href="/players">Players</a>
            <a href="/manage/competitions">Organizer access</a>
            <a href="#schedule">Schedule</a>
            <a href="/leaderboard">Rankings</a>
          </nav>
          <small>© 2026 ArewaVanta · Independent community</small>
        </div>
      </footer>
    </div>
  );
}
