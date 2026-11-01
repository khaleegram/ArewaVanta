import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ClanPlayer, ManageClan, RosterMember } from "./api/types";
import { Icon } from "./ui";
import { matchesPlayerSearch } from "./playerSearch";
import "./clan-players.css";

type Squad = ManageClan["squads"][number];
type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };
const errorText = (error: unknown) => error instanceof ApiError
  ? [...new Set([error.message, ...Object.values(error.errors).flat()])].join(" ")
  : "Couldn’t save your changes. Please try again.";

function useClanPlayers(token: string, clanId: string, revision: number) {
  const [players, setPlayers] = useState<Load<ClanPlayer[]>>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setPlayers({ status: "loading" });
    api.clanPlayers(token, clanId, controller.signal)
      .then(({ data }) => setPlayers({ status: "ready", data }))
      .catch((error) => { if (!controller.signal.aborted) setPlayers({ status: "error", message: errorText(error) }); });
    return () => controller.abort();
  }, [token, clanId, revision]);
  return players;
}

function NewPlayerForm({ onCreate, onCancel }: { onCreate: (ign: string, uid: string | null) => Promise<void>; onCancel: () => void }) {
  const [ign, setIgn] = useState("");
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ign.trim() || busy) return;
    setBusy(true); setError("");
    try { await onCreate(ign.trim(), uid.trim() || null); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <form className="clan-new-player" onSubmit={submit}>
    <label>Player IGN<input autoFocus required maxLength={100} value={ign} onChange={(event) => setIgn(event.target.value)} disabled={busy} /></label>
    <label>CODM UID <span>Optional · private</span><input maxLength={64} value={uid} onChange={(event) => setUid(event.target.value)} disabled={busy} /></label>
    {error && <p className="clan-player-error" role="alert">{error}</p>}
    <div className="clan-player-form-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="clan-player-primary" disabled={busy || !ign.trim()}>{busy ? "Adding…" : "Save new player"}</button></div>
  </form>;
}

export function ClanPlayerPool({ token, clan, onRosterChange }: { token: string; clan: ManageClan; onRosterChange: () => void }) {
  const [revision, setRevision] = useState(0);
  const players = useClanPlayers(token, clan.id, revision);
  const [creating, setCreating] = useState(false);
  const [selectedSquadId, setSelectedSquadId] = useState(clan.squads[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const unassigned = players.status === "ready" ? players.data.filter((player) => player.squads.length === 0) : [];
  const targetSquad = clan.squads.find((squad) => squad.id === selectedSquadId) ?? clan.squads[0];
  async function assign(player: ClanPlayer) {
    if (!targetSquad || busy) return;
    setBusy(player.id); setError(""); setNotice("");
    try {
      await api.addRosterPlayer(token, targetSquad.id, player.id);
      setNotice(`${player.current_ign} added to ${targetSquad.name}.`);
      setRevision((value) => value + 1); onRosterChange();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(""); }
  }
  return <section className="clan-players clan-player-pool" aria-label={`${clan.name} unassigned players`}>
    <div className="clan-players-heading"><div><h3>Unassigned players {players.status === "ready" && <span>{unassigned.length}</span>}</h3><p>In this clan, ready to join a squad.</p></div><button type="button" className="clan-player-add" onClick={() => setCreating(true)} disabled={creating || !!busy}><Icon name="plus" />Add new player</button></div>
    {creating && <NewPlayerForm onCancel={() => setCreating(false)} onCreate={async (ign, uid) => {
      await api.createClanPlayer(token, clan.id, ign, uid);
      setCreating(false); setNotice(`${ign} added to this clan.`); setRevision((value) => value + 1);
    }} />}
    {error && <p className="clan-player-error" role="alert">{error}</p>}
    {notice && <p className="clan-player-notice" role="status">{notice}</p>}
    {players.status === "loading" ? <p className="clan-player-empty">Loading clan players…</p> : players.status === "error" ? <div className="clan-player-empty" role="alert">{players.message}<button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : unassigned.length ? <>
      {targetSquad ? <div className="clan-pool-target"><label htmlFor={`clan-${clan.id}-pool-target`}>Add players to</label><select id={`clan-${clan.id}-pool-target`} value={targetSquad.id} onChange={(event) => setSelectedSquadId(event.target.value)} disabled={!!busy}>{clan.squads.map((squad) => <option key={squad.id} value={squad.id}>{squad.name}</option>)}</select></div> : <p className="clan-player-empty">Create a squad to assign these players.</p>}
      <ul className="clan-player-items">{unassigned.map((player) => <li key={player.id}><strong>{player.current_ign}</strong>{targetSquad && <button type="button" disabled={!!busy} onClick={() => assign(player)} aria-label={`Add ${player.current_ign} to ${targetSquad.name}`}>{busy === player.id ? "Adding…" : "Add to squad"}<Icon name="plus" /></button>}</li>)}</ul>
    </> : <p className="clan-player-empty">No unassigned players. New players added here will appear in this list.</p>}
  </section>;
}

export function ClanRoster({ token, clan, squad, onBack }: { token: string; clan: ManageClan; squad: Squad; onBack: () => void }) {
  const [revision, setRevision] = useState(0);
  const players = useClanPlayers(token, clan.id, revision);
  const [roster, setRoster] = useState<Load<RosterMember[]>>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setRoster({ status: "loading" });
    api.roster(token, squad.id, controller.signal).then(({ data }) => setRoster({ status: "ready", data }))
      .catch((error) => { if (!controller.signal.aborted) setRoster({ status: "error", message: errorText(error) }); });
    return () => controller.abort();
  }, [token, squad.id, revision]);
  const currentIds = new Set(roster.status === "ready" ? roster.data.map((member) => member.player_id) : []);
  const available = players.status === "ready" ? players.data.filter((player) => !currentIds.has(player.id) && matchesPlayerSearch(player.current_ign, query)) : [];
  async function changePlayer(id: string, ign: string, remove: boolean) {
    if (busy || roster.status !== "ready") return;
    setBusy(id); setError(""); setNotice("");
    try {
      if (remove) await api.removeRosterPlayer(token, squad.id, id);
      else await api.addRosterPlayer(token, squad.id, id);
      setNotice(`${ign} ${remove ? "removed from" : "added to"} ${squad.name}.`);
      setRevision((value) => value + 1);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(""); }
  }
  return <div className="clan-players clan-roster-editor">
    <button type="button" className="manage-back" onClick={onBack}>← Clans & players</button>
    <div className="manage-form-heading"><p className="manage-eyebrow">{clan.name}</p><h1>{squad.name}<span>.</span></h1><p>Choose players from your clan. You can update the lineup on either match day.</p></div>
    {error && <p className="clan-player-error" role="alert">{error}</p>}
    {notice && <p className="clan-player-notice" role="status">{notice}</p>}
    <div className="clan-roster-columns">
      <section className="clan-roster-panel" aria-label="Current squad players"><div className="clan-players-heading"><div><h2>In this squad {roster.status === "ready" && <span>{roster.data.length}</span>}</h2><p>Removed players stay in your clan.</p></div></div>
        {roster.status === "loading" ? <p className="clan-player-empty">Loading squad…</p> : roster.status === "error" ? <div className="clan-player-empty" role="alert">{roster.message}<button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : roster.data.length ? <ul className="clan-player-items">{roster.data.map((member) => <li key={member.membership_id}><strong>{member.ign}</strong><button type="button" disabled={!!busy} onClick={() => changePlayer(member.player_id, member.ign, true)} aria-label={`Remove ${member.ign} from ${squad.name}`}>{busy === member.player_id ? "Saving…" : "Remove"}<Icon name="close" /></button></li>)}</ul> : <p className="clan-player-empty">No players in this squad yet. Add them from your clan list.</p>}
      </section>
      <section className="clan-roster-panel" aria-label="Clan players available to add"><div className="clan-players-heading"><div><h2>Clan players</h2><p>{clan.name} only.</p></div><button type="button" className="clan-player-add" onClick={() => setCreating(true)} disabled={creating || !!busy || roster.status !== "ready"}><Icon name="plus" />Add new player</button></div>
        {creating && <NewPlayerForm onCancel={() => setCreating(false)} onCreate={async (ign, uid) => {
          await api.addNewRosterPlayer(token, squad.id, ign, uid);
          setCreating(false); setNotice(`${ign} created and added to ${squad.name}.`); setRevision((value) => value + 1);
        }} />}
        <label className="clan-player-search"><span className="sr-only">Search this clan’s players</span><input placeholder="Player name (no clan tag needed)" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {players.status === "loading" || roster.status === "loading" ? <p className="clan-player-empty">Loading clan players…</p> : players.status === "error" ? <div className="clan-player-empty" role="alert">{players.message}<button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : roster.status === "error" ? <p className="clan-player-empty">Reload the squad before adding players.</p> : available.length ? <ul className="clan-player-items">{available.map((player) => <li key={player.id}><div><strong>{player.current_ign}</strong><small>{player.squads.length ? player.squads.map((entry) => entry.name).join(", ") : "Unassigned"}</small></div><button type="button" disabled={!!busy} onClick={() => changePlayer(player.id, player.current_ign, false)} aria-label={`Add ${player.current_ign} to ${squad.name}`}>{busy === player.id ? "Saving…" : "Add"}<Icon name="plus" /></button></li>)}</ul> : <p className="clan-player-empty">{query.trim() ? "No matching players in this clan." : "All your clan players are in this squad. Use Add new player for someone new."}</p>}
      </section>
    </div>
  </div>;
}
