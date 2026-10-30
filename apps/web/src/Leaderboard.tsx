import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Brand, Icon, SquadMark } from "./ui";
import { getRankings, rankingEvents } from "./leaderboard-data";
import type { EventKey, RankingEntry, RankingKind } from "./leaderboard-data";
import "./leaderboard.css";

function Crest({
  entry,
  player = false,
}: {
  entry: RankingEntry;
  player?: boolean;
}) {
  return (
    <span
      className={`lb-crest${player ? " lb-avatar" : ""}`}
      style={{ color: entry.color }}
      aria-hidden="true"
    >
      {player ? (
        <>
          <span>{entry.name.slice(0, 2)}</span>
          <i />
        </>
      ) : entry.mark ? (
        <SquadMark id={entry.mark} />
      ) : (
        <svg viewBox="0 0 64 64">
          <path
            d="M32 4 56 17 52 43 32 59 12 43 8 17Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M18 21 32 12 46 21M21 46l11 7 11-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <text
            x="32"
            y="39"
            textAnchor="middle"
            fill="currentColor"
            fontSize="19"
            fontWeight="800"
          >
            {entry.tag}
          </text>
        </svg>
      )}
    </span>
  );
}
function RankingTabs({
  kind,
  onChange,
  compact = false,
}: {
  kind: RankingKind;
  onChange: (kind: RankingKind) => void;
  compact?: boolean;
}) {
  const tabRef = useRef<HTMLDivElement>(null);
  return (
    <div
      className={`lb-tabs${compact ? " lb-tabs-compact" : ""}`}
      role="tablist"
      aria-label="Ranking type"
      ref={tabRef}
    >
      {(["squads", "players"] as const).map((value, index) => (
        <button
          key={value}
          role="tab"
          id={`${compact ? "preview-" : ""}${value}-ranking-tab`}
          aria-selected={kind === value}
          aria-controls={
            compact ? "preview-ranking-panel" : "full-ranking-panel"
          }
          tabIndex={kind === value ? 0 : -1}
          onClick={() => onChange(value)}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? "squads"
                  : e.key === "End"
                    ? "players"
                    : value === "squads"
                      ? "players"
                      : "squads";
              onChange(next);
              tabRef.current
                ?.querySelectorAll("button")
                [next === "squads" ? 0 : 1].focus();
            }
          }}
        >
          <Icon name={index === 0 ? "trophy" : "target"} />
          {value === "squads" ? "Squads" : "Players"}
          <span>{index === 0 ? "24" : "96"}</span>
        </button>
      ))}
    </div>
  );
}
function Podium({
  entries,
  kind,
}: {
  entries: RankingEntry[];
  kind: RankingKind;
}) {
  return (
    <div
      className={`lb-podium lb-podium-${kind}`}
      aria-label={`Top three ${kind}`}
    >
      {entries.slice(0, 3).map((entry, index) => (
        <article
          className={`lb-podium-card lb-place-${index + 1}`}
          key={entry.id}
        >
          <span className="lb-podium-rank" aria-label={`Rank ${entry.rank}`}>
            0{entry.rank}
          </span>
          <span className="lb-podium-label">
            {index === 0 ? (
              <>
                <Icon name="trophy" />
                {kind === "squads" ? "TOP SQUAD" : "TOP FRAGGER"}
              </>
            ) : (
              `${index === 1 ? "SECOND" : "THIRD"} PLACE`
            )}
          </span>
          <Crest entry={entry} player={kind === "players"} />
          <h3>{entry.name}</h3>
          <p>{kind === "squads" ? entry.city : entry.squad}</p>
          <div className="lb-podium-score">
            <strong>
              {(kind === "squads"
                ? entry.points
                : entry.kills
              ).toLocaleString()}
            </strong>
            <span>{kind === "squads" ? "POINTS" : "KILLS"}</span>
          </div>
          <div className="lb-podium-bottom">
            {kind === "squads"
              ? `${entry.kills} kills · ${entry.wins} wins`
              : `${entry.average.toFixed(1)} avg · ${entry.best} best`}
          </div>
        </article>
      ))}
    </div>
  );
}
function EntryDetails({
  entry,
  kind,
}: {
  entry: RankingEntry;
  kind: RankingKind;
}) {
  const stats =
    kind === "squads"
      ? [
          ["Games", entry.appearances],
          ["Wins", entry.wins],
          ["Kill points", entry.kills],
          ["Placement pts", entry.points - entry.kills],
        ]
      : [
          ["Games played", entry.appearances],
          ["Total kills", entry.kills],
          ["Kills / game", entry.average.toFixed(2)],
          ["Best game", entry.best],
        ];
  return (
    <div className="lb-detail-content">
      <div className="lb-detail-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {kind === "players" ? (
        <figure className="lb-game-chart">
          <figcaption>
            Kills by game <span>All {entry.appearances} appearances</span>
          </figcaption>
          <div>
            {entry.games.map((kills, index) => (
              <div key={index} aria-label={`Game ${index + 1}: ${kills} kills`}>
                <strong>{kills}</strong>
                <span
                  style={{
                    height: `${Math.max(2, (kills / Math.max(1, entry.best)) * 45)}px`,
                  }}
                />
                <small>G{index + 1}</small>
              </div>
            ))}
          </div>
        </figure>
      ) : (
        <p className="lb-score-explanation">
          <Icon name="target" />
          {entry.kills} kill points + {entry.points - entry.kills} placement
          points = <strong>{entry.points} total points.</strong>
        </p>
      )}
    </div>
  );
}
function Movement({ value }: { value: number | null }) {
  if (value === null)
    return (
      <span className="hv-move hv-move-flat" aria-label="No previous rank">
        —
      </span>
    );
  if (value === 0)
    return (
      <span className="hv-move hv-move-flat" aria-label="No change in rank">
        –
      </span>
    );
  return (
    <span
      className={`hv-move ${value > 0 ? "hv-move-up" : "hv-move-down"}`}
      aria-label={
        value > 0 ? `Up ${value} places` : `Down ${Math.abs(value)} places`
      }
    >
      {value > 0 ? `↑${value}` : `↓${Math.abs(value)}`}
    </span>
  );
}

export function LeaderboardPreview() {
  const [kind, setKind] = useState<RankingKind>("squads");
  const [period, setPeriod] = useState<"weekend-005" | "season">(
    "weekend-005",
  );
  const entries = getRankings(kind, period);
  const previous = useMemo(() => {
    const ranks = new Map<string, number>();
    getRankings(kind, "weekend-004").forEach((entry) =>
      ranks.set(entry.id, entry.rank),
    );
    return ranks;
  }, [kind]);
  const [leader, ...rest] = entries;
  const chasers = rest.slice(0, 5);
  const leaderLabel = kind === "squads" ? "Points" : "Kills";
  const leaderMetric = kind === "squads" ? leader.points : leader.kills;
  const rowSecondaryLabel = kind === "squads" ? "Points" : "Avg";
  const movement = (entry: RankingEntry) => {
    if (period !== "weekend-005") return null;
    const prior = previous.get(entry.id);
    return prior === undefined ? null : prior - entry.rank;
  };
  const periodLabel =
    period === "season" ? "October season" : "Weekender 005";
  return (
    <section
      className="hv-section hv-wrap hv-board lb-preview"
      id="leaderboard"
      aria-labelledby="preview-leaderboard-title"
    >
      <div className="hv-board-head">
        <div>
          <span className="hv-kicker">
            <b>02</b>
            Standings
          </span>
          <h2 id="preview-leaderboard-title">
            The hunt for <em>number one.</em>
          </h2>
        </div>
        <div className="hv-board-controls">
          <div className="hv-segment" role="group" aria-label="Ranking period">
            <button
              type="button"
              aria-pressed={period === "weekend-005"}
              onClick={() => setPeriod("weekend-005")}
            >
              Weekend 005
            </button>
            <button
              type="button"
              aria-pressed={period === "season"}
              onClick={() => setPeriod("season")}
            >
              Season
            </button>
          </div>
          <div className="hv-segment" role="tablist" aria-label="Ranking type">
            {(["squads", "players"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`preview-${value}-ranking-tab`}
                aria-selected={kind === value}
                aria-controls="preview-ranking-panel"
                tabIndex={kind === value ? 0 : -1}
                onClick={() => setKind(value)}
                onKeyDown={(e) => {
                  if (
                    ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const next =
                      e.key === "Home"
                        ? "squads"
                        : e.key === "End"
                          ? "players"
                          : value === "squads"
                            ? "players"
                            : "squads";
                    setKind(next);
                    document
                      .getElementById(`preview-${next}-ranking-tab`)
                      ?.focus();
                  }
                }}
              >
                {value === "squads" ? "Squads" : "Players"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        id="preview-ranking-panel"
        role="tabpanel"
        aria-labelledby={`preview-${kind}-ranking-tab`}
        tabIndex={0}
      >
        <div className="hv-board-grid">
          <article className="hv-champion lb-place-1">
            {leader.mark && (
              <span className="hv-champion-watermark" aria-hidden="true">
                <SquadMark id={leader.mark} />
              </span>
            )}
            <div className="hv-champion-top">
              <span className="hv-champion-label">
                <Icon name="trophy" />
                Top {kind === "squads" ? "squad" : "fragger"} · {periodLabel}
              </span>
              <span className="hv-champion-rank">01</span>
            </div>
            <div className="hv-champion-id">
              <Crest entry={leader} player={kind === "players"} />
              <div>
                <h3>{leader.name}</h3>
                <p>
                  {kind === "squads"
                    ? `${leader.city}, Nigeria`
                    : leader.squad}
                </p>
              </div>
            </div>
            <dl className="hv-champion-stats">
              <div>
                <dt>{leaderLabel}</dt>
                <dd>{leaderMetric.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{kind === "squads" ? "Kills" : "Best game"}</dt>
                <dd>
                  {kind === "squads" ? leader.kills : leader.best}
                </dd>
              </div>
              <div>
                <dt>{kind === "squads" ? "Wins" : "Avg"}</dt>
                <dd>
                  {kind === "squads"
                    ? leader.wins
                    : leader.average.toFixed(1)}
                </dd>
              </div>
            </dl>
            <div className="hv-champion-move">
              {period === "weekend-005" ? (
                <>
                  <Movement value={movement(leader)} />
                  <span>Since Weekender 004</span>
                </>
              ) : (
                <span>12 games combined · 2 weekends</span>
              )}
            </div>
          </article>

          <div className="hv-ranks">
            <div className="hv-rank-head" aria-hidden="true">
              <span>Rank</span>
              <span />
              <span>{kind === "squads" ? "Squad" : "Player"}</span>
              <span>
                <span>Kills</span>
                <span>{rowSecondaryLabel}</span>
              </span>
            </div>
            <ol className="hv-rank-list">
              {chasers.map((entry) => (
                <li className="hv-rank-row" key={entry.id}>
                  <span className="hv-rank-num">
                    {String(entry.rank).padStart(2, "0")}
                    {period === "weekend-005" && (
                      <Movement value={movement(entry)} />
                    )}
                  </span>
                  <Crest entry={entry} player={kind === "players"} />
                  <span className="hv-rank-id">
                    <strong>{entry.name}</strong>
                    <small>
                      {kind === "squads" ? entry.city : entry.squad}
                    </small>
                  </span>
                  <span className="hv-rank-stats">
                    <span className="hv-rank-stat">
                      <small>Kills</small>
                      <strong>{entry.kills}</strong>
                    </span>
                    <span className="hv-rank-stat hv-rank-points">
                      <small>{rowSecondaryLabel}</small>
                      <strong>
                        {kind === "squads"
                          ? entry.points
                          : entry.average.toFixed(1)}
                      </strong>
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="hv-board-foot">
        <span>
          24 squads · 96 players · Ranked by{" "}
          {kind === "squads" ? "total points" : "total kills"}
        </span>
        <a
          href={`/leaderboard?type=${kind}&event=${period}`}
          className="hv-link"
        >
          View all {kind}
          <Icon name="arrow" />
        </a>
      </div>
    </section>
  );
}
export default function LeaderboardPage() {
  const params = new URLSearchParams(window.location.search);
  const [kind, setKind] = useState<RankingKind>(
    params.get("type") === "players" ? "players" : "squads",
  );
  const initial = params.get("event");
  const [event, setEvent] = useState<EventKey>(
    initial && Object.hasOwn(rankingEvents, initial)
      ? (initial as EventKey)
      : "weekend-005",
  );
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState("rank");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = getRankings(kind, event);
  const filtered = entries.filter((x) =>
    `${x.name} ${x.squad} ${x.city}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  if (sort !== "rank")
    filtered.sort(
      (a, b) =>
        Number(b[sort as "kills" | "average" | "best"]) -
          Number(a[sort as "kills" | "average" | "best"]) || a.rank - b.rank,
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  const currentEvent = rankingEvents[event];
  function goToPage(next: number) {
    setPage(next);
    setExpanded(null);
    document
      .getElementById("all-rankings-title")
      ?.focus({ preventScroll: true });
    document.querySelector(".lb-results")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }
  function changeKind(next: RankingKind) {
    setKind(next);
    setPage(1);
    setExpanded(null);
    setSort("rank");
  }
  useEffect(() => {
    const next = new URLSearchParams();
    next.set("type", kind);
    next.set("event", event);
    if (query.trim()) next.set("q", query.trim());
    window.history.replaceState(null, "", `/leaderboard?${next}`);
    document.title = `${kind === "squads" ? "Squad" : "Player"} leaderboard — ArewaVanta`;
  }, [kind, event, query]);
  return (
    <div className="lb-page">
      <a className="skip-link" href="#standings-content">
        Skip to standings
      </a>
      <header className="lb-site-header">
        <Brand href="/" />
        <nav aria-label="Main navigation">
          <a href="/">Home</a>
          <a href="/leaderboard" aria-current="page">
            Leaderboards
          </a>
          <a href="/#schedule">
            Schedule <Icon name="diagonal" />
          </a>
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
        <div className="lb-demo-note">
          DESIGN PREVIEW <span>Fictional squads, players and results.</span>
        </div>
        <section className="lb-competition-bar" aria-label="Competition filter">
          <div className="lb-event-picker">
            <Icon name="calendar" />
            <label>
              <span>COMPETITION</span>
              <select
                aria-label="Competition"
                value={event}
                onChange={(e) => {
                  setEvent(e.target.value as EventKey);
                  setPage(1);
                  setExpanded(null);
                }}
              >
                {Object.entries(rankingEvents).map(([id, e]) => (
                  <option key={id} value={id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="lb-event-context">
            <span>
              {currentEvent.type} · {currentEvent.date}
            </span>
            <strong>
              <i /> {currentEvent.games} games completed
            </strong>
          </div>
        </section>
        <RankingTabs kind={kind} onChange={changeKind} />
        <section
          role="tabpanel"
          id="full-ranking-panel"
          aria-labelledby={`${kind}-ranking-tab`}
          tabIndex={0}
        >
          <div key={`${kind}-${event}`}>
            <Podium entries={entries} kind={kind} />
          </div>
          <section className="lb-results" aria-labelledby="all-rankings-title">
            <div className="lb-results-heading">
              <div>
                <span className="lb-overline">THE COMPLETE PICTURE</span>
                <h2 id="all-rankings-title" tabIndex={-1}>
                  {kind === "squads" ? "Squad standings" : "Player rankings"}
                  <span>{entries.length}</span>
                </h2>
              </div>
              <span className="lb-rules">
                {kind === "squads"
                  ? "AGA Balanced · 1 point per kill + placement"
                  : "Ranked by total kills · Equal kills share a rank"}
              </span>
            </div>
            <div className="lb-tools">
              <label className="lb-search">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <circle cx="10" cy="10" r="6" />
                  <path d="m15 15 5 5" />
                </svg>
                <span className="sr-only">Search {kind}</span>
                <input
                  value={query}
                  placeholder={
                    kind === "squads"
                      ? "Find your squad…"
                      : "Find a player or squad…"
                  }
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                    setExpanded(null);
                  }}
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery("");
                      setPage(1);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </label>
              <label className="lb-sort">
                <span>SORT</span>
                <select
                  aria-label="Sort standings"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="rank">Official rank</option>
                  <option value="kills">Most kills</option>
                  {kind === "players" && (
                    <>
                      <option value="average">Kills per game</option>
                      <option value="best">Best game</option>
                    </>
                  )}
                </select>
              </label>
            </div>
            <p className="sr-only" role="status">
              {filtered.length} {kind} found. Page {currentPage} of {pages}.
            </p>
            <p className="lb-swipe-hint">
              Swipe sideways to see all columns <Icon name="arrow" />
            </p>
            <div
              className="lb-table-wrap"
              role="region"
              aria-label="Leaderboard table, scroll sideways if needed"
              tabIndex={0}
            >
              <table className={`lb-table lb-table-${kind}`}>
                <caption className="sr-only">
                  {currentEvent.name}.{" "}
                  {kind === "squads"
                    ? "Squads ranked by points."
                    : "Players ranked by total kills."}{" "}
                  Sample results. Select a name to expand statistics.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">
                      {kind === "squads" ? "Squad" : "Player"}
                    </th>
                    <th scope="col" className="lb-extra">
                      Games
                    </th>
                    <th scope="col" className="lb-extra">
                      {kind === "squads" ? "Wins" : "Avg kills"}
                    </th>
                    <th
                      scope="col"
                      className={
                        kind === "players" ? "lb-extra" : "lb-kills-column"
                      }
                    >
                      {kind === "squads" ? "Kills" : "Best"}
                    </th>
                    <th scope="col">
                      {kind === "squads" ? "Points" : "Kills"}
                    </th>
                  </tr>
                </thead>
                <tbody key={`${kind}-${event}-${currentPage}-${sort}`}>
                  {visible.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr
                        className={`lb-result-row${entry.rank === 1 ? " lb-row-leader" : ""}`}
                        data-expanded={expanded === entry.id}
                      >
                        <td className="lb-rank">
                          <span
                            className={entry.rank <= 3 ? "lb-rank-top" : ""}
                          >
                            {String(entry.rank).padStart(2, "0")}
                          </span>
                        </td>
                        <th scope="row">
                          <button
                            className="lb-identity"
                            aria-label={`View ${entry.name} statistics`}
                            aria-expanded={expanded === entry.id}
                            aria-controls={`detail-${entry.id}`}
                            onClick={() =>
                              setExpanded(
                                expanded === entry.id ? null : entry.id,
                              )
                            }
                          >
                            <Crest entry={entry} player={kind === "players"} />
                            <span>
                              <strong>{entry.name}</strong>
                              <small>
                                {kind === "squads" ? entry.city : entry.squad}
                              </small>
                            </span>
                            <Icon name="chevron" />
                          </button>
                        </th>
                        <td className="lb-extra" data-label="Games">
                          {entry.appearances}
                        </td>
                        <td
                          className="lb-extra"
                          data-label={kind === "squads" ? "Wins" : "Avg kills"}
                        >
                          {kind === "squads"
                            ? entry.wins
                            : entry.average.toFixed(2)}
                        </td>
                        <td
                          data-label={kind === "squads" ? "Kills" : "Best game"}
                          className={
                            kind === "players" ? "lb-extra" : "lb-kills-column"
                          }
                        >
                          {kind === "squads" ? entry.kills : entry.best}
                        </td>
                        <td
                          className="lb-score"
                          data-label={kind === "squads" ? "Points" : "Kills"}
                        >
                          <strong>
                            {(kind === "squads"
                              ? entry.points
                              : entry.kills
                            ).toLocaleString()}
                          </strong>
                        </td>
                      </tr>
                      <tr
                        id={`detail-${entry.id}`}
                        hidden={expanded !== entry.id}
                        className="lb-detail-row"
                      >
                        <td colSpan={6}>
                          <EntryDetails entry={entry} kind={kind} />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="lb-empty">
                  <Icon name="target" />
                  <h3>No {kind} found</h3>
                  <p>Try an IGN, squad name or city.</p>
                  <button
                    onClick={() => {
                      setQuery("");
                      setPage(1);
                    }}
                  >
                    Clear search <Icon name="arrow" />
                  </button>
                </div>
              )}
            </div>
            <div className="lb-pagination">
              <span>
                {filtered.length
                  ? `${(currentPage - 1) * 12 + 1}–${Math.min(currentPage * 12, filtered.length)}`
                  : "0"}{" "}
                of {filtered.length} {kind}
              </span>
              <div>
                <button
                  aria-label="Previous page"
                  disabled={currentPage === 1}
                  onClick={() => {
                    goToPage(currentPage - 1);
                  }}
                >
                  <Icon name="arrow" />
                </button>
                <span>
                  {currentPage} <em>/ {pages}</em>
                </span>
                <button
                  aria-label="Next page"
                  disabled={currentPage === pages}
                  onClick={() => {
                    goToPage(currentPage + 1);
                  }}
                >
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
            <p className="lb-table-note">
              Tap a {kind === "squads" ? "squad" : "player"} name for the
              breakdown.{" "}
              {sort !== "rank"
                ? "Rank numbers always show the official overall position."
                : kind === "squads"
                  ? "One point per kill, plus placement points."
                  : "Only games the player participated in count."}
            </p>
          </section>
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
