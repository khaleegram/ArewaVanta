import { useState } from "react";
import { api } from "./api/client";
import type { SquadHistoryEntry } from "./api/types";
import { Shell, Notice, dateText, useLoad } from "./PublicCompetitions";
import { countLabel, squadIdentity } from "./presentation";
import { Icon } from "./ui";
import { pageMetadata, SITE_ORIGIN, usePageSeo } from "./seo";

const clanUrl = (slug: string) => `/clans/${encodeURIComponent(slug)}`;
const squadUrl = (slug: string) => `/squads/${encodeURIComponent(slug)}`;
const playerUrl = (id: string) => `/players/${encodeURIComponent(id)}`;
function Pager({
  page,
  last,
  onChange,
}: {
  page: number;
  last: number;
  onChange: (page: number) => void;
}) {
  if (last <= 1) return null;
  return (
    <div className="public-pager">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Previous
      </button>
      <span>
        Page {page} of {last}
      </span>
      <button disabled={page >= last} onClick={() => onChange(page + 1)}>
        Next →
      </button>
    </div>
  );
}
function DirectorySearch({
  label,
  onSearch,
}: {
  label: string;
  onSearch: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="public-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value.trim());
      }}
    >
      <label>
        <span className="sr-only">{label}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={label}
          maxLength={100}
        />
      </label>
      <button type="submit">Search</button>
    </form>
  );
}
export function ClanListing() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [clans, retry] = useLoad(
    (signal) => api.clans(page, search, signal),
    `${page}:${search}`,
  );
  usePageSeo(pageMetadata.clans);
  return (
    <Shell>
      <div className="public-clans-index">
        <header className="public-clans-heading">
          <div><p className="public-kicker">AREWA CODM COMMUNITY</p><h1>Clans<span>.</span></h1><p>Find a clan and see the squads representing it.</p></div>
          {clans.status === "ready" && <span className="public-clans-count">{clans.data.meta.total} registered</span>}
        </header>
        <DirectorySearch label="Search clans" onSearch={(value) => { setPage(1); setSearch(value); }} />
        <Notice state={clans} retry={retry} empty={clans.status === "ready" && !clans.data.data.length ? "No clans found." : undefined} />
        <div className="public-clans-list">
          {clans.status === "ready" && clans.data.data.map((clan) => (
            <a key={clan.id} href={clanUrl(clan.slug)} className="public-clan-index-row">
              <span className="public-clan-index-tag">{clan.tag || "CLAN"}</span>
              <span className="public-clan-index-copy"><strong>{clan.name}</strong><small>{clan.squads.length} {clan.squads.length === 1 ? "squad" : "squads"}</small></span>
              <span className="public-clan-index-open">View <Icon name="arrow" /></span>
            </a>
          ))}
        </div>
        {clans.status === "ready" && <Pager page={clans.data.meta.current_page} last={clans.data.meta.last_page} onChange={setPage} />}
      </div>
    </Shell>
  );
}
export function ClanPage({ slug }: { slug: string }) {
  const [clan, retry] = useLoad(
    (signal) => api.clan(slug, signal).then((response) => response.data),
    slug,
  );
  const clanName = clan.status === "ready" ? clan.data.name : "Arewa CODM Clan";
  const clanDescription = clan.status === "ready"
    ? `${clan.data.name}${clan.data.tag ? ` (${clan.data.tag})` : ""} is an Arewa CODM clan in Nigeria. View its ${clan.data.squads.length} squads and their players on ArewaVanta.`
    : "View an Arewa CODM clan’s squads, players and competition history in Nigeria.";
  usePageSeo({
    title: `${clanName} — Arewa CODM Clan & Squads | ArewaVanta`,
    description: clanDescription,
    path: clan.status === "ready" ? clanUrl(clan.data.slug) : `/clans/${encodeURIComponent(slug)}`,
    schema: clan.status === "ready" ? {
      "@context": "https://schema.org",
      "@type": "SportsOrganization",
      name: clan.data.name,
      alternateName: clan.data.tag || undefined,
      description: clan.data.bio || clanDescription,
      sport: "Call of Duty: Mobile Battle Royale",
      url: `${SITE_ORIGIN}${clanUrl(clan.data.slug)}`,
      member: clan.data.squads.map((squad) => ({ "@type": "SportsTeam", name: squad.name, url: `${SITE_ORIGIN}${squadUrl(squad.slug)}` })),
    } : undefined,
  });
  return (
    <Shell>
      <div className="public-clan-profile">
        <a className="public-back" href="/clans">← All clans</a>
        <Notice state={clan} retry={retry} />
        {clan.status === "ready" && (
        <>
          <header className="public-clan-hero">
            <span className="public-clan-hero-tag">{clan.data.tag || "CLAN"}</span>
            <div><p className="public-kicker">AREWA CLAN</p><h1>{clan.data.name}<span>.</span></h1>{clan.data.bio && <p>{clan.data.bio}</p>}</div>
            <span className="public-clan-hero-count">{clan.data.squads.length}<small>{clan.data.squads.length === 1 ? "SQUAD" : "SQUADS"}</small></span>
          </header>
          <section className="public-clan-squads">
            <div className="public-clan-section-head"><div><p className="public-kicker">THE LINEUP</p><h2>Clan squads<span>.</span></h2></div><span>{clan.data.squads.length}</span></div>
            <div className="public-clan-squad-list">
              {clan.data.squads.length ? (
              <>
              {clan.data.squads.map((squad) => (
                <a key={squad.id} href={squadUrl(squad.slug)} className="public-clan-squad-row">
                  <span className="public-clan-squad-no">{squad.squad_number == null ? "—" : String(squad.squad_number).padStart(2, "0")}</span>
                  <span><strong>{squadIdentity({ name: squad.name, squadNumber: squad.squad_number, clanTag: clan.data.tag, clanName: clan.data.name, clanSquadCount: clan.data.squad_count ?? clan.data.squads.length })}</strong><small>{clan.data.tag} · {clan.data.name}</small></span>
                  <Icon name="arrow" />
                </a>
              ))}
              </>
              ) : (
                <div className="public-notice">No squads registered yet.</div>
              )}
            </div>
          </section>
        </>
      )}
      </div>
    </Shell>
  );
}
function SquadPerformance({ slug }: { slug: string }) {
  const [history, retry] = useLoad(
    (signal) => api.squadHistory(slug, signal).then((response) => response.data),
    slug,
  );
  return (
    <section className="public-section public-squad-performance">
      <div className="public-section-title">
        <div>
          <p className="public-kicker">RESULTS</p>
          <h2>
            Competition history<span>.</span>
          </h2>
        </div>
      </div>
      <Notice
        state={history}
        retry={retry}
        empty={
          history.status === "ready" && !history.data.length
            ? "No recorded competition results yet."
            : undefined
        }
      />
      {history.status === "ready" && (
        <div className="public-list">
          {history.data.map((item) => {
            const { event } = item;
            return (
              <a
                className="public-event-row"
                href={`/competitions/${encodeURIComponent(event.slug)}`}
                key={event.id}
              >
                <div>
                  <span className="public-row-label">
                    {dateText(event.start_date)}
                  </span>
                  <h2>{event.title}</h2>
                  <p>
                    Rank {item.rank} · {countLabel(item.matches_played, "game")}{" "}
                    · {countLabel(item.total_kills, "kill")} ·{" "}
                    {countLabel(item.wins, "win")}
                  </p>
                  <small>
                    {item.total_points} points
                    {item.uses_mixed_scoring_presets
                      ? " · Scoring varies by game"
                      : ""}
                  </small>
                </div>
                <Icon name="arrow" />
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
export function SquadPage({ slug }: { slug: string }) {
  const [squad, retry] = useLoad(
    (signal) => api.squad(slug, signal).then((response) => response.data),
    slug,
  );
  const squadName = squad.status === "ready"
    ? squadIdentity({ name: squad.data.name, squadNumber: squad.data.squad_number, clanTag: squad.data.clan.tag, clanName: squad.data.clan.name, clanSquadCount: squad.data.clan.squad_count })
    : "Arewa CODM Squad";
  const squadDescription = squad.status === "ready"
    ? `${squadName} represents ${squad.data.clan.name} (${squad.data.clan.tag || "Arewa CODM clan"}) in Call of Duty: Mobile Battle Royale competitions. View its players and results.`
    : "View this Arewa CODM Battle Royale squad’s players and competition history.";
  usePageSeo({
    title: `${squadName} — CODM Squad & Players | ArewaVanta`,
    description: squadDescription,
    path: squad.status === "ready" ? squadUrl(squad.data.slug) : `/squads/${encodeURIComponent(slug)}`,
    schema: squad.status === "ready" ? {
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      name: squadName,
      sport: "Call of Duty: Mobile Battle Royale",
      url: `${SITE_ORIGIN}${squadUrl(squad.data.slug)}`,
      member: squad.data.roster.map((player) => ({ "@type": "Person", name: player.ign })),
      parentOrganization: { "@type": "SportsOrganization", name: squad.data.clan.name, url: `${SITE_ORIGIN}${clanUrl(squad.data.clan.slug)}` },
    } : undefined,
  });
  return (
    <Shell>
      <div className="public-squad-profile">
        <a className="public-back" href={squad.status === "ready" ? clanUrl(squad.data.clan.slug) : "/clans"}>← Clan</a>
        <Notice state={squad} retry={retry} />
        {squad.status === "ready" && (
        <>
          <header className="public-squad-hero">
            <div className="public-squad-hero-top"><a href={clanUrl(squad.data.clan.slug)}>{squad.data.clan.tag} · {squad.data.clan.name}<Icon name="arrow" /></a><span>TEAM {squad.data.squad_number ?? "—"}</span></div>
            <h1>{squadIdentity({ name: squad.data.name, squadNumber: squad.data.squad_number, clanTag: squad.data.clan.tag, clanName: squad.data.clan.name, clanSquadCount: squad.data.clan.squad_count })}<span>.</span></h1>
            <p>Players representing this squad.</p>
          </header>
          <section className="public-squad-players">
            <div className="public-squad-section-head"><div><p className="public-kicker">SQUAD PLAYERS</p><h2>Players<span>.</span></h2></div><span>{squad.data.roster.length}</span></div>
            {squad.data.roster.length ? (
              <ol className="public-squad-player-list">
                {squad.data.roster.map((player, index) => (
                  <li key={player.id}><span>{String(index + 1).padStart(2, "0")}</span><a href={playerUrl(player.id)}><strong>{player.ign}</strong><Icon name="arrow" /></a></li>
                ))}
              </ol>
            ) : (
              <div className="public-notice">No players listed yet.</div>
            )}
          </section>
          <SquadPerformance slug={squad.data.slug} />
        </>
      )}
      </div>
    </Shell>
  );
}
export function PlayerListing() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [players, retry] = useLoad(
    (signal) => api.players(page, search, signal),
    `${page}:${search}`,
  );
  usePageSeo(pageMetadata.players);
  return (
    <Shell>
      <div className="public-player-directory">
        <header className="public-player-directory-heading"><div><p className="public-kicker">AREWA CODM COMMUNITY</p><h1>Players<span>.</span></h1><p>Search by in-game name and open a player’s match history.</p></div>{players.status === "ready" && <span>{players.data.meta.total} players</span>}</header>
        <DirectorySearch label="Search player IGN" onSearch={(value) => { setPage(1); setSearch(value); }} />
        <Notice state={players} retry={retry} empty={players.status === "ready" && !players.data.data.length ? "No players found." : undefined} />
        <div className="public-player-directory-list">
          {players.status === "ready" && players.data.data.map((player) => (
            <a key={player.id} href={playerUrl(player.id)} className="public-player-directory-row">
              <span className="public-player-directory-avatar">{player.current_ign.slice(0, 2).toUpperCase()}</span>
              <strong>{player.current_ign}</strong>
              <Icon name="arrow" />
            </a>
          ))}
        </div>
        {players.status === "ready" && <Pager page={players.data.meta.current_page} last={players.data.meta.last_page} onChange={setPage} />}
      </div>
    </Shell>
  );
}
export function PlayerPage({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [player, retry] = useLoad(
    (signal) => api.player(id, page, signal).then((response) => response.data),
    `${id}:${page}`,
  );
  const playerName = player.status === "ready" ? player.data.current_ign : "Arewa CODM Player";
  const playerDescription = player.status === "ready"
    ? `${playerName} is a Call of Duty: Mobile Battle Royale player in the Arewa community. View squad affiliations, match appearances, kills and competition history.`
    : "View an Arewa CODM player’s squad affiliations, match appearances and competition statistics.";
  usePageSeo({
    title: `${playerName} — Arewa CODM Player Profile | ArewaVanta`,
    description: playerDescription,
    path: player.status === "ready" ? playerUrl(player.data.id) : `/players/${encodeURIComponent(id)}`,
    schema: player.status === "ready" ? {
      "@context": "https://schema.org",
      "@type": "Person",
      name: player.data.current_ign,
      url: `${SITE_ORIGIN}${playerUrl(player.data.id)}`,
      description: playerDescription,
      memberOf: player.data.current_squads?.map((squad) => ({ "@type": "SportsTeam", name: squad.name, url: `${SITE_ORIGIN}${squadUrl(squad.slug)}` })),
    } : undefined,
  });
  return (
    <Shell>
      <div className="public-player-profile">
        <a className="public-back" href="/players">← Players</a>
        <Notice state={player} retry={retry} />
        {player.status === "ready" && (
          <>
            <header className="public-player-hero">
              <span className="public-player-crest" aria-hidden="true">{player.data.current_ign.slice(0, 2).toUpperCase()}</span>
              <div className="public-player-identity">
                <p className="public-kicker">PLAYER PROFILE · AREWA CODM</p>
                <h1>{player.data.current_ign}<span>.</span></h1>
                {player.data.uid && <p className="public-player-uid">CODM UID <strong>{player.data.uid}</strong></p>}
              </div>
              {!!player.data.current_squads?.length && (
                <div className="public-player-affiliations">
                  <small>PLAYING WITH</small>
                  {player.data.current_squads.map((squad) => (
                    <a key={squad.id} href={squadUrl(squad.slug)}>
                      {squad.clan.tag && <b>{squad.clan.tag}</b>}
                      <span>{squad.clan.name}{squad.clan.squad_count != null && squad.clan.squad_count > 1 && squad.squad_number ? ` (${squad.squad_number})` : ""}</span>
                      <Icon name="arrow" />
                    </a>
                  ))}
                </div>
              )}
            </header>
            <section className="public-player-statline" aria-label="Player statistics">
              <div><strong>{player.data.appearances}</strong><span>Games</span></div>
              <div><strong>{player.data.total_kills}</strong><span>Total kills</span></div>
              <div><strong>{player.data.kills_per_appearance ?? "—"}</strong><span>Average kills</span></div>
              <div><strong>{player.data.best_game_kills ?? "—"}</strong><span>Best game</span></div>
            </section>
            <section className="public-player-history">
              <header><div><p className="public-kicker">RECENT MATCHES</p><h2>Game history<span>.</span></h2></div><span>{player.data.history_meta.total} games</span></header>
              {player.data.match_history.length ? (
                <div className="public-player-match-list">
                  {player.data.match_history.map((match, index) => (
                    <a key={`${match.match_id}-${index}`} href={`/competitions/${encodeURIComponent(match.event_slug)}/games/${encodeURIComponent(match.match_id)}`} className="public-player-match-row">
                      <span className="public-player-match-date">{dateText(match.event_date)}</span>
                      <span className="public-player-match-info">
                        <strong>{match.event_title}</strong>
                        <small>Game {match.match_index} · {match.map_label} · {squadIdentity({ name: match.squad_name, squadNumber: match.squad_number, clanTag: match.clan_tag, clanName: match.clan_name, clanSquadCount: match.clan_squad_count })}</small>
                        {match.ign_snapshot !== player.data.current_ign && <small>Played as {match.ign_snapshot}</small>}
                      </span>
                      <span className="public-player-match-kills"><strong>{match.kills}</strong><small>KILLS</small></span>
                      <Icon name="arrow" />
                    </a>
                  ))}
                </div>
              ) : <div className="public-notice">No public games played yet.</div>}
              <Pager page={player.data.history_meta.current_page} last={player.data.history_meta.last_page} onChange={setPage} />
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
