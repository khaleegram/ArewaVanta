import { useEffect, useRef, useState } from "react";
import { competitions, games, squads } from "./data";
import type { Competition } from "./data";
import { Brand, Icon, SquadMark } from "./ui";
import { LeaderboardPreview } from "./Leaderboard";

const tickerItems = [
  "Kano Reapers — Weekender 005 champions",
  "176 points",
  "128 squad kills",
  "24 squads",
  "6 games",
  "Arewa CODM",
  "Northern roots · relentless game",
];

function CompetitionDialog({
  competition,
  onClose,
}: {
  competition: Competition | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!competition) return;
    ref.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [competition]);
  const event = competitions[competition ?? "upcoming"];
  return (
    <dialog
      ref={ref}
      className="competition-dialog"
      aria-labelledby="dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="dialog-art">
        <span className="eyebrow">COMPETITION PREVIEW</span>
        <button
          className="icon-button dialog-close"
          onClick={() => ref.current?.close()}
          aria-label="Close competition details"
        >
          <Icon name="close" />
        </button>
        <span className="dialog-edition">0{event.edition.slice(-1)}</span>
      </div>
      <div className="dialog-content">
        <span className="status">
          <span />
          {event.status}
        </span>
        <h2 id="dialog-title">
          {event.title}
          <span> / {event.edition}</span>
        </h2>
        <p>{event.description}</p>
        <div className="dialog-meta">
          <span>
            <Icon name="calendar" />
            {event.date}
          </span>
          <span>
            <Icon name="pin" />
            ONLINE · AFRICA / LAGOS
          </span>
        </div>
        <div className="dialog-facts">
          <div>
            <strong>24</strong>
            <span>SQUADS</span>
          </div>
          <div>
            <strong>06</strong>
            <span>GAMES</span>
          </div>
          <div>
            <strong>02</strong>
            <span>DAYS</span>
          </div>
        </div>
        <h3>The format</h3>
        <p>
          Three games each day: Isolated, Isolated, Blackout. ArewaVanta
          Balanced scoring awards one point per elimination plus placement
          points.
        </p>
        <div className="scoring-example">
          <Icon name="target" />
          <span>
            10 eliminations + 2nd place <strong>= 19 points</strong>
          </span>
        </div>
        <p className="dialog-disclaimer">
          Design prototype. Competitions, squads and results are illustrative.
          This preview does not register players or connect to the API.
        </p>
        <button
          className="hv-btn hv-btn-primary dialog-done"
          onClick={() => ref.current?.close()}
        >
          Back to the arena
          <Icon name="arrow" />
        </button>
      </div>
    </dialog>
  );
}

function HomepageHero() {
  return (
    <section className="hv-hero" aria-labelledby="hero-title">
      <div className="hv-hero-media" aria-hidden="true">
        <img
          src="/images/northern-force.webp"
          alt=""
          width="1536"
          height="1024"
          fetchPriority="high"
        />
      </div>

      <div className="hv-hero-inner">
        <div className="hv-hero-top">
          <span className="hv-hero-tag">
            <i />
            Arewa CODM · Battle Royale
          </span>
          <span className="hv-hero-note">Design preview · Sample data</span>
        </div>

        <div className="hv-hero-main">
          <h1 id="hero-title">
            <span className="hv-line">Weekend</span>
            <span className="hv-line hv-line-accent">war.</span>
            <span className="hv-line hv-line-alt">Northern pride.</span>
          </h1>

          <div className="hv-hero-aside">
            <p>
              Scrims, leagues and tournaments for Nigeria’s Arewa CODM
              community. Twenty-four squads. Six games. One weekend to prove it.
            </p>
            <div className="hv-hero-actions">
              <a className="hv-btn hv-btn-primary" href="#competitions">
                Enter the arena
                <Icon name="arrow" />
              </a>
              <a className="hv-btn hv-btn-ghost" href="#leaderboard">
                See standings
                <Icon name="diagonal" />
              </a>
            </div>
          </div>
        </div>

        <div className="hv-hero-foot">
          <div className="hv-hero-next">
            <span className="hv-status">
              <i />
              Up next
            </span>
            <span className="hv-hero-next-title">Arewa Weekender 006</span>
            <span className="hv-hero-next-meta">
              31 Oct — 01 Nov · Online · ArewaVanta Placement + Kills
            </span>
          </div>
          <div className="hv-hero-facts">
            <div>
              <strong>24</strong>
              <span>Squads</span>
            </div>
            <div>
              <strong>06</strong>
              <span>Games</span>
            </div>
            <div>
              <strong>01</strong>
              <span>North</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [day, setDay] = useState<0 | 1>(0);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [expandedGame, setExpandedGame] = useState<number | null>(null);

  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="hv-page" id="home">
        <header className="hv-header">
          <div className="hv-header-inner">
            <Brand />
            <nav
              id="main-navigation"
              className={`hv-nav${menuOpen ? " is-open" : ""}`}
              aria-label="Main navigation"
            >
              <a href="#competitions" onClick={() => setMenuOpen(false)}>
                The arena<span>01</span>
              </a>
              <a href="/leaderboard" onClick={() => setMenuOpen(false)}>
                Rankings<span>02</span>
              </a>
              <a href="#squads" onClick={() => setMenuOpen(false)}>
                Squads<span>03</span>
              </a>
              <a href="#community" onClick={() => setMenuOpen(false)}>
                Community<span>04</span>
              </a>
            </nav>
            <a className="hv-header-cta" href="#competitions">
              Find a scrim
              <Icon name="arrow" />
            </a>
            <button
              className="hv-menu"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="main-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </header>

        <main id="main">
          <HomepageHero />

          <div className="hv-ticker" aria-hidden="true">
            <div className="hv-ticker-track">
              {[0, 1].map((copy) => (
                <div className="hv-ticker-group" key={copy}>
                  {tickerItems.map((item) => (
                    <span className="hv-ticker-item" key={`${copy}-${item}`}>
                      {item}
                      <i>✳</i>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <section
            className="hv-section hv-wrap"
            id="competitions"
            aria-labelledby="featured-title"
          >
            <div className="hv-event">
              <figure className="hv-event-media">
                <img
                  src="/images/the-battleground.webp"
                  width="1536"
                  height="1024"
                  alt="Original battle royale environment artwork of an island and hydroelectric dam"
                  loading="lazy"
                />
                <span className="hv-event-num" aria-hidden="true">
                  006
                </span>
                <figcaption>
                  <span className="hv-status">
                    <i />
                    Up next
                  </span>
                  <span>31 OCT — 01 NOV</span>
                </figcaption>
              </figure>

              <div className="hv-event-copy">
                <span className="hv-kicker">
                  <b>01</b>
                  The next drop
                </span>
                <h2 id="featured-title">
                  Arewa
                  <br />
                  Weekender <em>006</em>
                </h2>
                <p>
                  Six Battle Royale games across Isolated and Blackout.
                  Twenty-four squads, one weekend, and every elimination
                  counted the ArewaVanta way.
                </p>
                <div className="hv-event-meta">
                  <div>
                    <span>Dates</span>
                    <strong>31 Oct — 01 Nov</strong>
                  </div>
                  <div>
                    <span>Format</span>
                    <strong>BR · Squads</strong>
                  </div>
                  <div>
                    <span>Mode</span>
                    <strong>Online</strong>
                  </div>
                </div>
                <button
                  className="hv-btn hv-btn-primary"
                  aria-label="View Arewa Weekender 006 details"
                  onClick={() => setCompetition("upcoming")}
                >
                  Event details
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          </section>

          <LeaderboardPreview />

          <section
            className="hv-section hv-wrap"
            id="squads"
            aria-labelledby="squads-title"
          >
            <div className="hv-section-head">
              <div>
                <span className="hv-kicker">
                  <b>03</b>
                  Know the contenders
                </span>
                <h2 id="squads-title">
                  Different flags.
                  <br />
                  <em>Same fire.</em>
                </h2>
              </div>
              <p>
                The names setting the pace.
                <br />
                The squads worth watching.
              </p>
            </div>

            <div className="hv-rosters">
              {squads.slice(0, 3).map((squad, index) => (
                <article
                  className={`hv-team hv-team-${squad.color}`}
                  key={squad.id}
                >
                  <div className="hv-team-top">
                    <span>0{index + 1} — Squad spotlight</span>
                    <span>{squad.tag}</span>
                  </div>
                  <div className="hv-team-art">
                    <span className="hv-team-word" aria-hidden="true">
                      {squad.tag}
                    </span>
                    <SquadMark id={squad.id} />
                  </div>
                  <div className="hv-team-id">
                    <h3>{squad.name}</h3>
                    <span>
                      <Icon name="pin" />
                      {squad.city}, Nigeria
                    </span>
                  </div>
                  <dl className="hv-team-stats">
                    <div>
                      <dt>Points</dt>
                      <dd>{squad.points}</dd>
                    </div>
                    <div>
                      <dt>Kills</dt>
                      <dd>{squad.kills}</dd>
                    </div>
                    <div>
                      <dt>Wins</dt>
                      <dd>{String(squad.wins).padStart(2, "0")}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section
            className="hv-section hv-wrap"
            aria-labelledby="player-title"
          >
            <div className="hv-spotlight">
              <div className="hv-spotlight-media">
                <img
                  src="/images/northern-force.webp"
                  alt="Illustrative masked operator avatar for the featured player"
                  width="1536"
                  height="1024"
                  loading="lazy"
                />
                <span className="hv-spotlight-index" aria-hidden="true">
                  01
                </span>
                <span className="hv-spotlight-label">
                  <Icon name="target" />
                  Player in focus
                </span>
                <div className="hv-spotlight-who">
                  <span>KRP / Kano Reapers</span>
                  <h3>
                    Musa
                    <em>“Reaper”</em>
                  </h3>
                </div>
              </div>
              <div className="hv-spotlight-copy">
                <span className="hv-kicker">
                  <b>04</b>
                  The one to watch
                </span>
                <h2 id="player-title">
                  Some play.
                  <br />
                  Some <em>set the pace.</em>
                </h2>
                <p>
                  Six games. Eighty-four eliminations. A weekend that speaks for
                  itself.
                </p>
                <div className="hv-spotlight-stats">
                  <div>
                    <strong>
                      84<span>↗</span>
                    </strong>
                    <span>Total kills</span>
                  </div>
                  <div>
                    <strong>14.0</strong>
                    <span>Kills / game</span>
                  </div>
                  <div>
                    <strong>24</strong>
                    <span>Best game</span>
                  </div>
                </div>
                <div className="hv-spotlight-foot">
                  <span>
                    <Icon name="trophy" />
                    Top fragger
                  </span>
                  <span>Weekender 005</span>
                </div>
              </div>
            </div>
          </section>

          <section
            className="hv-section hv-wrap"
            id="schedule"
            aria-labelledby="schedule-title"
          >
            <div className="hv-fixtures-head">
              <div>
                <span className="hv-kicker">
                  <b>05</b>
                  On the horizon
                </span>
                <h2 id="schedule-title">
                  Clear your <em>weekend.</em>
                </h2>
              </div>
              <span className="hv-tz">
                <Icon name="calendar" />
                Weekender 006 · All times WAT · UTC+1
              </span>
            </div>

            <div className="hv-fixtures">
              <div
                className="hv-days"
                aria-label="Choose a competition day"
              >
                <button
                  className="hv-day"
                  aria-pressed={day === 0}
                  onClick={() => {
                    setDay(0);
                    setExpandedGame(null);
                  }}
                >
                  <span>
                    DAY 01 <span>SATURDAY</span>
                  </span>
                  <strong>
                    31<small>OCT</small>
                  </strong>
                  <Icon name="arrow" />
                </button>
                <button
                  className="hv-day"
                  aria-pressed={day === 1}
                  onClick={() => {
                    setDay(1);
                    setExpandedGame(null);
                  }}
                >
                  <span>
                    DAY 02 <span>SUNDAY</span>
                  </span>
                  <strong>
                    01<small>NOV</small>
                  </strong>
                  <Icon name="arrow" />
                </button>
              </div>

              <div className="hv-games">
                {games.map((game, index) => {
                  const number = day * 3 + index + 1;
                  const expanded = expandedGame === index;
                  return (
                    <article
                      className={`hv-game${expanded ? " is-open" : ""}`}
                      key={`${day}-${index}`}
                    >
                      <button
                        className="hv-game-summary"
                        aria-expanded={expanded}
                        aria-controls={`game-detail-${index}`}
                        onClick={() => setExpandedGame(expanded ? null : index)}
                      >
                        <span className="hv-time">
                          {game.time}
                          <small>WAT</small>
                        </span>
                        <span className="hv-thumb">
                          <img
                            src="/images/the-battleground.webp"
                            alt=""
                            style={{ objectPosition: game.imagePosition }}
                            loading="lazy"
                            width="120"
                            height="80"
                          />
                        </span>
                        <span className="game-name">
                          <small>
                            GAME {String(number).padStart(2, "0")} / BATTLE
                            ROYALE
                          </small>
                          <strong>{game.map}</strong>
                          <span>{game.terrain}</span>
                        </span>
                        <span className="hv-game-count">24 squads</span>
                        <span className="hv-expand">
                          <Icon name="plus" />
                        </span>
                      </button>
                      <div
                        className="hv-game-detail"
                        id={`game-detail-${index}`}
                        hidden={!expanded}
                      >
                        <span>
                          <Icon name="check" />
                          ArewaVanta Placement + Kills
                        </span>
                        <p>
                          24 squads · 4 players per squad ·{" "}
                          {day === 0
                            ? "Saturday, 31 October"
                            : "Sunday, 1 November"}{" "}
                          2026 at {game.time} WAT. One point per elimination
                          plus placement points. This is an illustrative
                          schedule.
                        </p>
                      </div>
                    </article>
                  );
                })}
                <div className="hv-fixtures-foot">
                  <span>
                    <i />
                    The weekend belongs to the squad.
                  </span>
                  <button
                    className="hv-link"
                    onClick={() => setCompetition("upcoming")}
                  >
                    Competition details
                    <Icon name="diagonal" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section
            className="hv-manifesto"
            id="community"
            aria-labelledby="community-title"
          >
            <span className="hv-manifesto-star" aria-hidden="true">
              ✳
            </span>
            <div className="hv-manifesto-inner">
              <div>
                <span className="hv-kicker">
                  <b>06</b>
                  Our community
                </span>
                <h2 id="community-title">
                  Northern roots.
                  <em>Relentless game.</em>
                </h2>
              </div>
              <div className="hv-manifesto-copy">
                <p>
                  From Kano to Kaduna. From Zaria to Jos. A home for the squads,
                  the rivalries, and the next name everyone remembers.
                </p>
                <a className="hv-btn hv-btn-ghost" href="#competitions">
                  Find your place in the arena
                  <Icon name="diagonal" />
                </a>
              </div>
            </div>
          </section>
        </main>

        <footer className="hv-footer">
          <div className="hv-footer-inner">
            <div className="hv-footer-top">
              <div>
                <Brand light />
                <p className="hv-footer-tag">
                  Northern roots. Relentless game.
                </p>
              </div>
              <nav className="hv-footer-nav" aria-label="Footer navigation">
                <a href="#competitions">The arena</a>
                <a href="/leaderboard">Rankings</a>
                <a href="#squads">Squads</a>
                <a href="#home">Back to top ↑</a>
              </nav>
            </div>
            <div className="hv-wordmark" aria-hidden="true">
              ArewaVanta<span>®</span>
            </div>
            <div className="hv-footer-bottom">
              <span>© 2026 ArewaVanta. Built for the Arewa community.</span>
              <span className="hv-footer-meta">
                Independent community · Not affiliated with Activision.
              </span>
            </div>
            <div className="hv-prototype-note">
              <i />
              Homepage design prototype · All competitions, teams, players and
              statistics are sample data.
            </div>
          </div>
        </footer>
      </div>
      {competition && (
        <CompetitionDialog
          competition={competition}
          onClose={() => setCompetition(null)}
        />
      )}
    </>
  );
}
