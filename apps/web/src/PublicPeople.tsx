import { useState } from "react";
import { api } from "./api/client";
import { allPublicEvents } from "./api/events";
import type { EventStandings, EventSummary } from "./api/types";
import { Shell, Notice, dateText, useLoad } from "./PublicCompetitions";
import { Icon } from "./ui";

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
  return (
    <Shell>
      <div className="public-intro">
        <p className="public-kicker">AREWA CODM COMMUNITY</p>
        <h1>
          Clans<span>.</span>
        </h1>
        <p>Explore clans and their squads.</p>
      </div>
      <DirectorySearch
        label="Search clans"
        onSearch={(value) => {
          setPage(1);
          setSearch(value);
        }}
      />
      <Notice
        state={clans}
        retry={retry}
        empty={
          clans.status === "ready" && !clans.data.data.length
            ? "No clans found."
            : undefined
        }
      />
      <div className="public-list">
        {clans.status === "ready" &&
          clans.data.data.map((clan) => (
            <a
              key={clan.id}
              href={clanUrl(clan.slug)}
              className="public-person-row"
            >
              <span className="public-squad-mark">
                {(clan.tag || clan.name).slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{clan.name}</strong>
                <small>
                  {clan.tag ? `${clan.tag} · ` : ""}
                  {clan.squads.length}{" "}
                  {clan.squads.length === 1 ? "squad" : "squads"}
                </small>
              </span>
              <Icon name="arrow" />
            </a>
          ))}
      </div>
      {clans.status === "ready" && (
        <Pager
          page={clans.data.meta.current_page}
          last={clans.data.meta.last_page}
          onChange={setPage}
        />
      )}
    </Shell>
  );
}
export function ClanPage({ slug }: { slug: string }) {
  const [clan, retry] = useLoad(
    (signal) => api.clan(slug, signal).then((response) => response.data),
    slug,
  );
  return (
    <Shell>
      <a className="public-back" href="/clans">
        ← All clans
      </a>
      <Notice state={clan} retry={retry} />
      {clan.status === "ready" && (
        <>
          <div className="public-intro public-detail-intro">
            <p className="public-kicker">
              CLAN {clan.data.tag ? `· ${clan.data.tag}` : ""}
            </p>
            <h1>
              {clan.data.name}
              <span>.</span>
            </h1>
            {clan.data.bio && <p>{clan.data.bio}</p>}
          </div>
          <section className="public-section">
            <div className="public-section-title">
              <div>
                <p className="public-kicker">THE ROSTER</p>
                <h2>
                  Squads<span>.</span>
                </h2>
              </div>
            </div>
            {clan.data.squads.length ? (
              <div className="public-list">
                {clan.data.squads.map((squad) => (
                  <a
                    key={squad.id}
                    href={squadUrl(squad.slug)}
                    className="public-person-row"
                  >
                    <span className="public-squad-mark">
                      {(squad.tag || squad.name).slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong>{squad.name}</strong>
                      <small>{squad.tag ?? "Squad"}</small>
                    </span>
                    <Icon name="arrow" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="public-notice">No squads registered yet.</div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
type SquadHistory = { event: EventSummary; standings: EventStandings }[];
async function squadHistory(
  id: string,
  signal: AbortSignal,
): Promise<SquadHistory> {
  const events = (await allPublicEvents(signal)).filter(
    (event) => event.scored_match_count > 0,
  );
  const collected: SquadHistory = [];
  for (let index = 0; index < events.length; index += 4) {
    const batch = events.slice(index, index + 4);
    const responses = await Promise.all(
      batch.map((event) => api.eventStandings(event.slug, signal)),
    );
    responses.forEach((response, offset) => {
      if (
        response.data.standings.some(
          (row) => row.squad.id === id && row.matches_played > 0,
        )
      )
        collected.push({ event: batch[offset], standings: response.data });
    });
  }
  return collected.sort((a, b) =>
    (b.event.end_date ?? "").localeCompare(a.event.end_date ?? ""),
  );
}
function SquadPerformance({ id }: { id: string }) {
  const [history, retry] = useLoad((signal) => squadHistory(id, signal), id);
  return (
    <section className="public-section">
      <div className="public-section-title">
        <div>
          <p className="public-kicker">PUBLIC RESULTS</p>
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
          {history.data.map(({ event, standings }) => {
            const row = standings.standings.find(
              (item) => item.squad.id === id,
            )!;
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
                    Rank {row.rank} · {row.matches_played} games ·{" "}
                    {row.total_kills} kills · {row.wins} wins
                  </p>
                  <small>
                    {row.total_points} points
                    {standings.uses_mixed_scoring_presets
                      ? " · Mixed scoring"
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
  return (
    <Shell>
      <a className="public-back" href="/clans">
        ← Clans
      </a>
      <Notice state={squad} retry={retry} />
      {squad.status === "ready" && (
        <>
          <div className="public-intro public-detail-intro">
            <p className="public-kicker">
              SQUAD {squad.data.tag ? `· ${squad.data.tag}` : ""}
            </p>
            <h1>
              {squad.data.name}
              <span>.</span>
            </h1>
            <p>
              Clan:{" "}
              <a
                className="public-inline-link"
                href={clanUrl(squad.data.clan.slug)}
              >
                {squad.data.clan.name}
              </a>
            </p>
          </div>
          <section className="public-section">
            <div className="public-section-title">
              <div>
                <p className="public-kicker">CURRENT MEMBERS</p>
                <h2>
                  Roster<span>.</span>
                </h2>
              </div>
            </div>
            {squad.data.roster.length ? (
              <div className="public-list">
                {squad.data.roster.map((player) => (
                  <a
                    href={playerUrl(player.id)}
                    key={player.id}
                    className="public-person-row"
                  >
                    <span className="public-squad-mark">
                      {player.ign.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong>{player.ign}</strong>
                      <small>Player</small>
                    </span>
                    <Icon name="arrow" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="public-notice">No current roster members.</div>
            )}
          </section>
          <SquadPerformance id={squad.data.id} />
        </>
      )}
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
  return (
    <Shell>
      <div className="public-intro">
        <p className="public-kicker">AREWA CODM COMMUNITY</p>
        <h1>
          Players<span>.</span>
        </h1>
        <p>Find players and see their match history.</p>
      </div>
      <DirectorySearch
        label="Search player IGN"
        onSearch={(value) => {
          setPage(1);
          setSearch(value);
        }}
      />
      <Notice
        state={players}
        retry={retry}
        empty={
          players.status === "ready" && !players.data.data.length
            ? "No players found."
            : undefined
        }
      />
      <div className="public-list">
        {players.status === "ready" &&
          players.data.data.map((player) => (
            <a
              key={player.id}
              href={playerUrl(player.id)}
              className="public-person-row"
            >
              <span className="public-squad-mark">
                {player.current_ign.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{player.current_ign}</strong>
                <small>Player</small>
              </span>
              <Icon name="arrow" />
            </a>
          ))}
      </div>
      {players.status === "ready" && (
        <Pager
          page={players.data.meta.current_page}
          last={players.data.meta.last_page}
          onChange={setPage}
        />
      )}
    </Shell>
  );
}
export function PlayerPage({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [player, retry] = useLoad(
    (signal) => api.player(id, page, signal).then((response) => response.data),
    `${id}:${page}`,
  );
  return (
    <Shell>
      <a className="public-back" href="/players">
        ← All players
      </a>
      <Notice state={player} retry={retry} />
      {player.status === "ready" && (
        <>
          <div className="public-intro public-detail-intro">
            <p className="public-kicker">PLAYER PROFILE</p>
            <h1>
              {player.data.current_ign}
              <span>.</span>
            </h1>
            {player.data.uid && <p>CODM UID: {player.data.uid}</p>}
            {!!player.data.current_squads?.length && (
              <div className="public-facts">
                {player.data.current_squads.map((squad) => (
                  <span key={squad.id}>
                    <a
                      className="public-inline-link"
                      href={squadUrl(squad.slug)}
                    >
                      {squad.name}
                    </a>{" "}
                    ·{" "}
                    <a
                      className="public-inline-link"
                      href={clanUrl(squad.clan.slug)}
                    >
                      {squad.clan.name}
                    </a>
                  </span>
                ))}
              </div>
            )}
            <div className="public-player-stats">
              <div>
                <strong>{player.data.appearances}</strong>
                <span>Games</span>
              </div>
              <div>
                <strong>{player.data.total_kills}</strong>
                <span>Kills</span>
              </div>
              <div>
                <strong>{player.data.kills_per_appearance ?? "—"}</strong>
                <span>Avg kills</span>
              </div>
              <div>
                <strong>{player.data.best_game_kills ?? "—"}</strong>
                <span>Best game</span>
              </div>
            </div>
          </div>
          <section className="public-section">
            <div className="public-section-title">
              <div>
                <p className="public-kicker">SAVED PUBLIC RESULTS</p>
                <h2>
                  Match history<span>.</span>
                </h2>
              </div>
            </div>
            {player.data.match_history.length ? (
              <div className="public-list">
                {player.data.match_history.map((match, index) => (
                  <a
                    key={`${match.match_id}-${index}`}
                    href={`/competitions/${encodeURIComponent(match.event_slug)}/games/${encodeURIComponent(match.match_id)}`}
                    className="public-event-row"
                  >
                    <div>
                      <span className="public-row-label">
                        {dateText(match.event_date)} · GAME {match.match_index}{" "}
                        · {match.map_label}
                      </span>
                      <h2>{match.event_title}</h2>
                      <p>
                        Played for {match.squad_name_snapshot} · {match.kills}{" "}
                        kills
                      </p>
                      {match.ign_snapshot !== player.data.current_ign && (
                        <small>Played as {match.ign_snapshot}</small>
                      )}
                    </div>
                    <Icon name="arrow" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="public-notice">
                No public match appearances yet.
              </div>
            )}
            <Pager
              page={player.data.history_meta.current_page}
              last={player.data.history_meta.last_page}
              onChange={setPage}
            />
          </section>
        </>
      )}
    </Shell>
  );
}
