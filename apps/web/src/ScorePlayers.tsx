import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiError } from "./api/client";
import { matchesPlayerSearch } from "./playerSearch";
import {
  knownKills,
  totalKills,
  type Candidate,
  type ScoreRow,
  type ScoreRows,
  type ScoreSquad,
} from "./scoreEntry";

export function ScorePlayers({
  token,
  matchId,
  squad,
  row,
  rows,
  onChange,
  onSelect,
}: {
  token: string;
  matchId: string;
  squad: ScoreSquad;
  row: ScoreRow;
  rows: ScoreRows;
  onChange: (change: (row: ScoreRow) => ScoreRow) => void;
  onSelect: (player: Candidate, replace?: string) => boolean;
}) {
  const [pool, setPool] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [added, setAdded] = useState<Candidate[]>([]);
  const [replacing, setReplacing] = useState<string | undefined>();
  const [pending, setPending] = useState<Candidate | null>(null);
  const [guest, setGuest] = useState(false);
  const [guestQuery, setGuestQuery] = useState("");
  const [guests, setGuests] = useState<Candidate[]>([]);
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState("");
  const [guestMore, setGuestMore] = useState(false);
  const [newName, setNewName] = useState("");
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const search = useRef<HTMLInputElement>(null);
  const poolElement = useRef<HTMLDivElement>(null);
  const actualIds = new Set(row.players.map((p) => p.id));
  const suggestions: Candidate[] = [];
  const lineup = [
    ...row.players,
    ...suggestions
      .slice(0, Math.max(0, 4 - row.players.length))
      .map((p) => ({ ...p, kills: "" })),
  ];
  const lineupIds = new Set(lineup.map((p) => p.id));
  const allPool: Candidate[] = [
    ...new Map(
      [...squad.eligible_players, ...suggestions, ...pool, ...added].map(
        (p) => [p.id, p],
      ),
    ).values(),
  ];
  const available = allPool.filter(
    (p) => !lineupIds.has(p.id) && matchesPlayerSearch(p.ign, query),
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    api
      .clanPlayers(token, squad.clan_id, c.signal)
      .then(({ data }) =>
        setPool(
          data.map((p) => ({ id: p.id, ign: p.current_ign, squads: p.squads })),
        ),
      )
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof ApiError ? e.message : "Could not load clan players.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [token, squad.clan_id, retry]);
  useEffect(() => {
    if (!guest || !guestQuery.trim()) {
      setGuests([]);
      setGuestMore(false);
      setGuestError("");
      setGuestLoading(false);
      return;
    }
    const c = new AbortController();
    setGuestLoading(true);
    const timer = window.setTimeout(
      () =>
        api
          .matchParticipants(
            token,
            matchId,
            guestQuery.trim(),
            undefined,
            c.signal,
          )
          .then((result) => {
            setGuests(result.data);
            setGuestMore(result.meta.has_more);
            setGuestError("");
          })
          .catch((e) => {
            if (!c.signal.aborted)
              setGuestError(
                e instanceof ApiError ? e.message : "Could not search guests.",
              );
          })
          .finally(() => {
            if (!c.signal.aborted) setGuestLoading(false);
          }),
      250,
    );
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [token, matchId, guest, guestQuery]);
  function select(player: Candidate, replace = replacing) {
    if (!actualIds.has(player.id) && row.players.length >= 4 && !replace) {
      setPending(player);
      return;
    }
    let selected = false;
    flushSync(() => {
      selected = onSelect(player, replace);
      if (selected) {
        setAdded((old) => [...old.filter((p) => p.id !== player.id), player]);
        if (replace) setHidden((old) => [...old, replace]);
        setReplacing(undefined);
        setPending(null);
        setNewName("");
      }
    });
    if (selected) {
      const input = inputs.current.get(player.id);
      input?.focus();
      input?.select();
    }
  }
  function remove(id: string) {
    const player = row.players.find((p) => p.id === id);
    if (
      player?.kills &&
      !window.confirm(
        `Remove ${player.ign} and their ${player.kills} recorded kills from this match lineup?`,
      )
    )
      return;
    if (player) setAdded((old) => [...old.filter((p) => p.id !== id), player]);
    setHidden((old) => [...old, id]);
    onChange((old) => ({
      ...old,
      players: old.players.filter((p) => p.id !== id),
    }));
  }
  const otherSquad = (id: string) =>
    Object.entries(rows).find(
      ([squadId, r]) =>
        squadId !== squad.id &&
        r.status === "present" &&
        r.players.some((p) => p.id === id),
    )?.[0];
  const sum = knownKills(row);
  return (
    <div className="score-players">
      <div className="score-section-title">
        <div>
          <h3>
            Players in this game <span>{row.players.length}/4</span>
          </h3>
          <p>Tap a name, type kills. Blank means unknown.</p>
        </div>
        <span className="score-auto-total">
          <b>{sum}</b> player kills
        </span>
      </div>
      <div className="score-lineup">
        {lineup.map((player, index) => {
          const actual = actualIds.has(player.id);
          return (
            <div
              className={`score-player${actual ? " is-actual" : ""}`}
              key={player.id}
            >
              <span className="score-player-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <button
                className="score-player-name"
                type="button"
                onClick={() => select(player)}
              >
                <strong>{player.ign}</strong>
                <small>
                  {actual
                    ? "Playing"
                    : otherSquad(player.id)
                      ? "Recorded in another slot · tap to move"
                      : "Tap to score"}
                </small>
              </button>
              <label className="score-player-kills">
                <span>Kills</span>
                <input
                  aria-label={`Kills for ${player.ign}`}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  placeholder="—"
                  value={actual ? player.kills : ""}
                  ref={(el) => {
                    if (el) inputs.current.set(player.id, el);
                    else inputs.current.delete(player.id);
                  }}
                  onFocus={(e) => {
                    if (!actual) {
                      let selected = false;
                      flushSync(() => {
                        selected = onSelect(player);
                      });
                      if (!selected) e.currentTarget.blur();
                      else inputs.current.get(player.id)?.focus();
                    }
                  }}
                  onChange={(e) =>
                    onChange((old) => ({
                      ...old,
                      status: "present",
                      players: old.players.map((p) =>
                        p.id === player.id
                          ? { ...p, kills: e.target.value }
                          : p,
                      ),
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const next = lineup[index + 1];
                      if (next) select(next);
                    }
                  }}
                />
              </label>
              <div className="score-player-actions">
                <button
                  type="button"
                  aria-label={`Change ${player.ign}`}
                  onClick={() => {
                    setReplacing(player.id);
                    poolElement.current?.scrollIntoView({
                      block: "nearest",
                      behavior: "smooth",
                    });
                    search.current?.focus();
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${player.ign}`}
                  onClick={() => remove(player.id)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        {lineup.length < 4 && (
          <p className="score-empty-lineup">
            {4 - lineup.length} player{4 - lineup.length === 1 ? "" : "s"} to
            add. Choose below or save what you know.
          </p>
        )}
      </div>
      {pending && (
        <div
          className="score-swap"
          role="group"
          aria-label="Choose player to replace"
        >
          <strong>Who is {pending.ign} replacing?</strong>
          <p>Four players are already selected. Choose a player to swap out.</p>
          <div>
            {row.players.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => select(pending, p.id)}
              >
                {p.ign}
                {p.kills !== "" ? ` · ${p.kills} kills` : ""}
              </button>
            ))}
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="score-pool" ref={poolElement}>
        <div className="score-section-title">
          <div>
            <h3>
              {replacing ? "Choose the replacement" : "More clan players"}{" "}
              <span>{available.length}</span>
            </h3>
            <p>Choose anyone from {squad.clan}.</p>
          </div>
          {replacing && (
            <button type="button" onClick={() => setReplacing(undefined)}>
              Cancel swap
            </button>
          )}
        </div>
        <input
          className="score-search"
          ref={search}
          type="search"
          maxLength={100}
          placeholder="Find a player — no clan tag needed"
          aria-label="Search clan players"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <p role="status">Loading clan players…</p>}
        {error && (
          <p className="score-error" role="alert">
            {error}{" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </p>
        )}
        <div className="score-pool-list">
          {available.map((player) => (
            <button
              type="button"
              key={player.id}
              onClick={() => select(player)}
            >
              <span>
                <strong>{player.ign}</strong>
                <small>
                  {otherSquad(player.id)
                    ? "Recorded in another slot · move to this slot"
                    : "Available in clan"}
                </small>
              </span>
              <span aria-hidden="true">＋</span>
            </button>
          ))}
        </div>
        {!loading && !error && !available.length && (
          <p className="score-muted">
            {query
              ? "No matching clan player. Add a new name below."
              : "All available clan players are shown above."}
          </p>
        )}
        <div className="score-new-player">
          <label htmlFor={`new-${squad.id}`}>Someone new played?</label>
          <div>
            <input
              id={`new-${squad.id}`}
              type="text"
              maxLength={100}
              placeholder="New player’s name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (newName.trim())
                    select({
                      id: `new:${crypto.randomUUID()}`,
                      ign: newName.trim(),
                    });
                }
              }}
            />
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() =>
                select({
                  id: `new:${crypto.randomUUID()}`,
                  ign: newName.trim(),
                })
              }
            >
              Add & score
            </button>
          </div>
          <small>
            Saving creates their player profile in this clan.
          </small>
        </div>
        <details onToggle={(e) => setGuest(e.currentTarget.open)}>
          <summary>Guest from another clan</summary>
          <p className="score-muted">
            Match substitution only. Their permanent clan stays unchanged.
          </p>
          <input
            className="score-search"
            type="search"
            maxLength={100}
            aria-label="Search guest players"
            placeholder="Search guest name"
            value={guestQuery}
            onChange={(e) => setGuestQuery(e.target.value)}
          />
          {guestLoading && <p role="status">Searching…</p>}
          {guestError && (
            <p className="score-error" role="alert">
              {guestError}
            </p>
          )}
          <div className="score-pool-list">
            {guests
              .filter((p) => !actualIds.has(p.id))
              .map((p) => (
                <button type="button" key={p.id} onClick={() => select(p)}>
                  {p.ign}
                  <span>＋</span>
                </button>
              ))}
          </div>
          {guestMore && (
            <small>Showing 40 matches. Refine the name to find more.</small>
          )}
        </details>
      </div>
      <details
        className="score-known-total"
        open={row.teamKills !== "" || undefined}
      >
        <summary>
          Known team total{" "}
          {row.teamKills !== "" ? `· ${row.teamKills}` : "(optional)"}
        </summary>
        <p>Leave blank to calculate automatically from player kills.</p>
        <label>
          Team kills{" "}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Auto"
            value={row.teamKills}
            onChange={(e) =>
              onChange((old) => ({
                ...old,
                status: "present",
                teamKills: e.target.value,
              }))
            }
          />
        </label>
        {row.teamKills !== "" && (
          <button
            type="button"
            onClick={() => onChange((old) => ({ ...old, teamKills: "" }))}
          >
            Use player total
          </button>
        )}
      </details>
      {row.teamKills !== "" && (
        <p className="score-warning">
          {sum > Number(row.teamKills)
            ? `Player kills (${sum}) exceed the known total (${row.teamKills}). ${sum} will be scored; check these figures when ready.`
            : `${sum} assigned to players · ${totalKills(row) - sum} kills still to attribute. Known team total is preserved.`}
        </p>
      )}
    </div>
  );
}
