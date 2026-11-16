import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ClanPlayer, ManageClan, RosterMember } from "./api/types";
import { Icon } from "./ui";
import { matchesPlayerSearch } from "./playerSearch";
import "./clan-players.css";

type Squad = ManageClan["squads"][number];
type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? [...new Set([error.message, ...Object.values(error.errors).flat()])].join(
        " ",
      )
    : "Couldn’t save your changes. Please try again.";

function useClanPlayers(token: string, clanId: string, revision: number) {
  const [players, setPlayers] = useState<Load<ClanPlayer[]>>({
    status: "loading",
  });
  useEffect(() => {
    const controller = new AbortController();
    setPlayers({ status: "loading" });
    api
      .clanPlayers(token, clanId, controller.signal)
      .then(({ data }) => setPlayers({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setPlayers({ status: "error", message: errorText(error) });
      });
    return () => controller.abort();
  }, [token, clanId, revision]);
  return players;
}

function NewPlayerForm({
  onCreate,
  onCancel,
}: {
  onCreate: (ign: string, uid: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [ign, setIgn] = useState("");
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ign.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(ign.trim(), uid.trim() || null);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="clan-new-player" onSubmit={submit}>
      <label>
        Player IGN
        <input
          autoFocus
          required
          maxLength={100}
          value={ign}
          onChange={(event) => setIgn(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        CODM UID <span>Optional · private</span>
        <input
          maxLength={64}
          value={uid}
          onChange={(event) => setUid(event.target.value)}
          disabled={busy}
        />
      </label>
      {error && (
        <p className="clan-player-error" role="alert">
          {error}
        </p>
      )}
      <div className="clan-player-form-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="clan-player-primary" disabled={busy || !ign.trim()}>
          {busy ? "Adding…" : "Save new player"}
        </button>
      </div>
    </form>
  );
}

function EditPlayerForm({
  player,
  onSave,
  onCancel,
}: {
  player: ClanPlayer;
  onSave: (body: { current_ign: string; uid?: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [ign, setIgn] = useState(player.current_ign);
  const [uid, setUid] = useState("");
  const [clearUid, setClearUid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ign.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        current_ign: ign.trim(),
        ...(clearUid ? { uid: null } : uid.trim() ? { uid: uid.trim() } : {}),
      });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="clan-new-player clan-edit-player" onSubmit={submit}>
      <label>
        Player IGN
        <input
          autoFocus
          required
          maxLength={100}
          value={ign}
          onChange={(event) => setIgn(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        New CODM UID <span>Optional · leave blank to keep the current UID</span>
        <input
          maxLength={64}
          value={uid}
          onChange={(event) => setUid(event.target.value)}
          disabled={busy || clearUid}
        />
      </label>
      <label className="clan-player-clear">
        <input
          type="checkbox"
          checked={clearUid}
          onChange={(event) => setClearUid(event.target.checked)}
          disabled={busy}
        />
        Remove the stored CODM UID
      </label>
      {error && (
        <p className="clan-player-error" role="alert">
          {error}
        </p>
      )}
      <div className="clan-player-form-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="clan-player-primary" disabled={busy || !ign.trim()}>
          {busy ? "Saving…" : "Save player"}
        </button>
      </div>
    </form>
  );
}

export function ClanPlayerPool({ token, clan }: { token: string; clan: ManageClan }) {
  const [revision, setRevision] = useState(0);
  const players = useClanPlayers(token, clan.id, revision);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClanPlayer | null>(null);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const visible = players.status === "ready" ? players.data.filter((player) => matchesPlayerSearch(player.current_ign, query)) : [];
  async function removePlayer(player: ClanPlayer) {
    if (busy) return;
    if (
      !window.confirm(
        `Remove ${player.current_ign} from ${clan.name}? Their past match records will stay intact.`,
      )
    )
      return;
    setBusy(player.id);
    setError("");
    try {
      await api.deleteClanPlayer(token, clan.id, player.id);
      if (editing?.id === player.id) setEditing(null);
      setNotice(`${player.current_ign} removed from ${clan.name}. Past match records were kept.`);
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  }
  return <section className="clan-players clan-player-pool" aria-label={`${clan.name} players`}>
    <div className="clan-players-heading"><div><h3>Clan players {players.status === "ready" && <span>{players.data.length}</span>}</h3><p>Players can play in any of this clan’s slots.</p></div><button type="button" className="clan-player-add" onClick={() => { setCreating(true); setEditing(null); setError(""); }} disabled={creating || !!editing}><Icon name="plus" />Add new player</button></div>
    {creating && <NewPlayerForm onCancel={() => setCreating(false)} onCreate={async (ign, uid) => { await api.createClanPlayer(token, clan.id, ign, uid); setCreating(false); setNotice(`${ign} added to this clan.`); setRevision((value) => value + 1); }} />}
    {editing && <EditPlayerForm key={editing.id} player={editing} onCancel={() => setEditing(null)} onSave={async (body) => { await api.updateClanPlayer(token, clan.id, editing.id, body); setEditing(null); setNotice(`${body.current_ign} updated.`); setRevision((value) => value + 1); }} />}
    {notice && <p className="clan-player-notice" role="status">{notice}</p>}
    {error && <p className="clan-player-error" role="alert">{error}</p>}
    <label className="clan-player-search"><span className="sr-only">Search clan players</span><input type="search" placeholder="Search player names" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {players.status === "loading" ? <p className="clan-player-empty">Loading clan players…</p> : players.status === "error" ? <div className="clan-player-empty" role="alert">{players.message}<button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : visible.length ? <ul className="clan-player-items">{visible.map((player) => <li key={player.id}><div><strong>{player.current_ign}</strong>{player.squads?.length ? <small>Also in a saved lineup</small> : null}</div><div className="clan-player-row-actions"><button type="button" disabled={!!busy || creating} aria-label={`Edit ${player.current_ign}`} onClick={() => { setEditing(player); setCreating(false); setError(""); }}>Edit</button><button type="button" disabled={!!busy || creating} aria-label={`Remove ${player.current_ign}`} onClick={() => void removePlayer(player)}>{busy === player.id ? "Removing…" : "Remove"}</button></div></li>)}</ul> : <p className="clan-player-empty">{query ? "No matching clan players." : "No players added yet."}</p>}
  </section>;
}

export function ClanRoster({
  token,
  clan,
  squad,
  onBack,
}: {
  token: string;
  clan: ManageClan;
  squad: Squad;
  onBack: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const players = useClanPlayers(token, clan.id, revision);
  const [roster, setRoster] = useState<Load<RosterMember[]>>({
    status: "loading",
  });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setRoster({ status: "loading" });
    api
      .roster(token, squad.id, controller.signal)
      .then(({ data }) => setRoster({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setRoster({ status: "error", message: errorText(error) });
      });
    return () => controller.abort();
  }, [token, squad.id, revision]);
  const currentIds = new Set(
    roster.status === "ready"
      ? roster.data.map((member) => member.player_id)
      : [],
  );
  const available =
    players.status === "ready"
      ? players.data.filter(
          (player) =>
            !currentIds.has(player.id) &&
            matchesPlayerSearch(player.current_ign, query),
        )
      : [];
  async function changePlayer(
    id: string,
    ign: string,
    remove: boolean,
    fromSquad?: { id: string; name: string },
  ) {
    if (busy || roster.status !== "ready") return;
    if (
      !remove &&
      fromSquad &&
      !window.confirm(
        `Move ${ign} from ${fromSquad.name} to ${squad.name}? They will leave the old squad. Previous match results stay unchanged.`,
      )
    )
      return;
    setBusy(id);
    setError("");
    setNotice("");
    try {
      if (remove) await api.removeRosterPlayer(token, squad.id, id);
      else await api.addRosterPlayer(token, squad.id, id, fromSquad?.id);
      setNotice(
        `${ign} ${remove ? "removed from" : fromSquad ? "moved to" : "added to"} ${squad.name}.`,
      );
      setRevision((value) => value + 1);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="clan-players clan-roster-editor">
      <button type="button" className="manage-back" onClick={onBack}>
        ← Clans & players
      </button>
      <div className="manage-form-heading">
        <p className="manage-eyebrow">{clan.name}</p>
        <h1>
          {squad.name}
          <span>.</span>
        </h1>
        <p>
          Choose players from your clan. You can update the lineup on either
          match day.
        </p>
      </div>
      {error && (
        <p className="clan-player-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="clan-player-notice" role="status">
          {notice}
        </p>
      )}
      <div className="clan-roster-columns">
        <section
          className="clan-roster-panel"
          aria-label="Current squad players"
        >
          <div className="clan-players-heading">
            <div>
              <h2>
                In this squad{" "}
                {roster.status === "ready" && <span>{roster.data.length}</span>}
              </h2>
              <p>Removed players stay in your clan.</p>
            </div>
          </div>
          {roster.status === "loading" ? (
            <p className="clan-player-empty">Loading squad…</p>
          ) : roster.status === "error" ? (
            <div className="clan-player-empty" role="alert">
              {roster.message}
              <button
                type="button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : roster.data.length ? (
            <ul className="clan-player-items">
              {roster.data.map((member) => (
                <li key={member.membership_id}>
                  <strong>{member.ign}</strong>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      changePlayer(member.player_id, member.ign, true)
                    }
                    aria-label={`Remove ${member.ign} from ${squad.name}`}
                  >
                    {busy === member.player_id ? "Saving…" : "Remove"}
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="clan-player-empty">
              No players in this squad yet. Add them from your clan list.
            </p>
          )}
        </section>
        <section
          className="clan-roster-panel"
          aria-label="Clan players available to add"
        >
          <div className="clan-players-heading">
            <div>
              <h2>Clan players</h2>
              <p>
                {clan.name} only. One squad per player; use Move here to switch.
              </p>
            </div>
            <button
              type="button"
              className="clan-player-add"
              onClick={() => setCreating(true)}
              disabled={creating || !!busy || roster.status !== "ready"}
            >
              <Icon name="plus" />
              Add new player
            </button>
          </div>
          {creating && (
            <NewPlayerForm
              onCancel={() => setCreating(false)}
              onCreate={async (ign, uid) => {
                await api.addNewRosterPlayer(token, squad.id, ign, uid);
                setCreating(false);
                setNotice(`${ign} created and added to ${squad.name}.`);
                setRevision((value) => value + 1);
              }}
            />
          )}
          <label className="clan-player-search">
            <span className="sr-only">Search this clan’s players</span>
            <input
              placeholder="Player name (no clan tag needed)"
              maxLength={100}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {players.status === "loading" || roster.status === "loading" ? (
            <p className="clan-player-empty">Loading clan players…</p>
          ) : players.status === "error" ? (
            <div className="clan-player-empty" role="alert">
              {players.message}
              <button
                type="button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : roster.status === "error" ? (
            <p className="clan-player-empty">
              Reload the squad before adding players.
            </p>
          ) : available.length ? (
            <ul className="clan-player-items">
              {available.map((player) => (
                <li key={player.id}>
                  <div>
                    <strong>{player.current_ign}</strong>
                    <small>
                      {player.squads.length
                        ? player.squads.map((entry) => entry.name).join(", ")
                        : "Unassigned"}
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      changePlayer(
                        player.id,
                        player.current_ign,
                        false,
                        player.squads[0],
                      )
                    }
                    aria-label={`${player.squads.length ? "Move" : "Add"} ${player.current_ign} to ${squad.name}`}
                  >
                    {busy === player.id
                      ? "Saving…"
                      : player.squads.length
                        ? "Move here"
                        : "Add"}
                    <Icon name={player.squads.length ? "arrow" : "plus"} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="clan-player-empty">
              {query.trim()
                ? "No matching players in this clan."
                : "All your clan players are in this squad. Use Add new player for someone new."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
