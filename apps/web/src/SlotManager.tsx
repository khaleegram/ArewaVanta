import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type { CompetitionSlots, ManageEvent, SlotAssignment, SlotSquad } from "./api/types";
import { Icon } from "./ui";
import "./slot-manager.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CompetitionSlots };
const errorText = (error: unknown) => error instanceof ApiError
  ? [...new Set([error.message, ...Object.values(error.errors).flat()])].join(" ") : "Couldn’t save slots. Please try again.";
const squadLabel = (squad: SlotSquad) => `${squad.clan.name} · ${squad.number ? `Squad ${squad.number}` : squad.name}`;
const slotValue = (slot: SlotAssignment) => slot.squad_id ?? (slot.reserved_clan_id ? `reserve:${slot.reserved_clan_id}` : "");

export default function SlotManager({ token, event }: { token: string; event: ManageEvent }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "open">("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    api.competitionSlots(token, event.id, controller.signal).then(({ data }) => setLoad({ status: "ready", data }))
      .catch((error) => { if (!controller.signal.aborted) setLoad({ status: "error", message: errorText(error) }); });
    return () => controller.abort();
  }, [token, event.id, refresh]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible" && editing === null) setRefresh((value) => value + 1); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [editing]);
  const data = load.status === "ready" ? load.data : null;
  const permanent = data?.event.permanent ?? !!event.recurrence;
  const assigned = data?.slots.filter((slot) => slot.squad_id).length ?? 0;
  const reserved = data?.slots.filter((slot) => !slot.squad_id && slot.reserved_clan_id).length ?? 0;
  const open = (data?.event.capacity ?? 0) - assigned - reserved;
  const search = query.trim().toLocaleLowerCase();
  const visible = data?.slots.filter((slot) => {
    if (filter === "assigned" && !slot.squad_id) return false;
    if (filter === "open" && (slot.squad_id || slot.reserved_clan_id)) return false;
    return !search || `${slot.slot} ${slot.squad ? squadLabel(slot.squad) : ""} ${slot.reserved_clan?.name ?? ""} ${slot.squad?.clan.tag ?? ""} ${slot.squad?.players.map((player) => player.ign).join(" ") ?? ""}`.toLocaleLowerCase().includes(search);
  }) ?? [];
  return <div className="slots-page" data-unsaved={editing !== null ? "true" : undefined}>
    <a className="slots-back" href={`/manage/competitions/${encodeURIComponent(event.id)}`}>← {event.title}</a>
    <header className="slots-heading"><div><p>{permanent ? "STANDING LOBBY" : "COMPETITION LOBBY"}</p><h1>{permanent ? "Permanent slots" : "Team slots"}<span>.</span></h1><p>{permanent ? "Same squad. Same slot. Every week, until an organizer changes it." : "Assign squads directly to this competition’s slots."}</p></div>
      <a className="slots-print" href={`/manage/competitions/${encodeURIComponent(event.id)}/check-in`}><Icon name="print" />Print lineups</a>
    </header>
    {notice && <div className="manage-success" role="status">{notice}</div>}
    {load.status === "loading" ? <p className="manage-notice" role="status">Loading assigned slots…</p> : load.status === "error" ? <div className="manage-error" role="alert">{load.message}<button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div> : data && <>
      <section className="slots-summary" aria-label="Lobby capacity"><div><strong>{assigned}<small> / {data.event.capacity}</small></strong><span>Assigned squads</span></div><div><strong>{open}</strong><span>Open slots</span></div><div><strong>{reserved}</strong><span>Clan reservations</span></div><p><Icon name="check" />{permanent ? "Carries forward automatically" : "Ready for this competition"}</p></section>
      {!data.event.can_edit && <p className="manage-notice">This competition has saved games. Its recorded slot list is preserved.</p>}
      <div className="slots-toolbar"><label><span className="sr-only">Find a slot, squad or player</span><input type="search" placeholder="Find slot, clan, squad or player…" value={query} onChange={(change) => setQuery(change.target.value)} /></label><div className="slots-filters" aria-label="Filter slots">{([['all', 'All slots'], ['assigned', 'Assigned'], ['open', 'Open']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      <div className="slots-grid">{visible.map((slot) => <article className={`slot-card ${slot.squad_id ? "is-assigned" : slot.reserved_clan_id ? "is-reserved" : "is-open"}`} key={slot.slot} aria-label={`Slot ${slot.slot}`}>
        <div className="slot-card-top"><span className="slot-number"><small>SLOT</small><strong>{String(slot.slot).padStart(2, "0")}</strong></span><div className="slot-identity">{slot.squad ? <><strong>{slot.squad.clan.name}</strong><span>{slot.squad.clan.tag && <b>{slot.squad.clan.tag}</b>}{slot.squad.number ? `Squad ${slot.squad.number}` : slot.squad.name}</span></> : slot.squad_id ? <><strong>Assigned squad unavailable</strong><span>Review this assignment</span></> : slot.reserved_clan ? <><strong>{slot.reserved_clan.name}</strong><span>Reserved for this clan</span></> : <><strong>Open slot</strong><span>Ready for a squad</span></>}</div>
          {data.event.can_edit && <button type="button" className="slot-edit" aria-label={`${slot.squad_id || slot.reserved_clan_id ? "Change" : "Assign"} slot ${slot.slot}`} onClick={() => setEditing(slot.slot)}>{slot.squad_id || slot.reserved_clan_id ? "Change" : "Assign"}<Icon name="arrow" /></button>}
        </div>
        {slot.squad && <div className="slot-lineup">{slot.squad.players.length ? <ul aria-label={`Players in ${squadLabel(slot.squad)}`}>{slot.squad.players.map((player) => <li key={player.id}>{player.ign}</li>)}</ul> : <p>Players can be added to this squad anytime.</p>}</div>}
      </article>)}</div>
      {!visible.length && <p className="manage-notice">No slots match your search.</p>}
      {permanent && <p className="slots-footnote">Changing players or missing a game doesn’t release a slot. Organizer changes carry into upcoming unscored weekends; saved games keep their original records.</p>}
    </>}
    {data && editing !== null && <SlotEditor key={`${editing}-${data.version}`} data={data} number={editing} token={token} onClose={() => setEditing(null)} onReload={() => { setEditing(null); setRefresh((value) => value + 1); }} onSaved={(updated) => { setLoad({ status: "ready", data: updated }); setEditing(null); setNotice(updated.event.permanent ? "Permanent slots updated. Upcoming unscored weekends use this list automatically." : "Team slots updated."); }} />}
  </div>;
}

function SlotEditor({ data, number, token, onClose, onSaved, onReload }: { data: CompetitionSlots; number: number; token: string; onClose: () => void; onSaved: (data: CompetitionSlots) => void; onReload: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = data.slots.find((slot) => slot.slot === number)!;
  const [choice, setChoice] = useState(slotValue(current));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const squad = data.squads.find((squad) => squad.id === choice);
  const reservation = choice.startsWith("reserve:") ? data.clans.find((clan) => clan.id === choice.slice(8)) : null;
  const source = squad ? data.slots.find((slot) => slot.squad_id === squad.id && slot.slot !== number) : null;
  const changed = choice !== slotValue(current);
  const options = data.squads.filter((candidate) => candidate.id === choice || `${squadLabel(candidate)} ${candidate.clan.tag} ${candidate.players.map((player) => player.ign).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => squadLabel(a).localeCompare(squadLabel(b)));
  const explanation = source
    ? `Move ${squadLabel(squad!)} from slot ${source.slot} to slot ${number}.${current.squad ? ` ${squadLabel(current.squad)} moves to slot ${source.slot}.` : current.reserved_clan ? ` The ${current.reserved_clan.name} reservation moves to slot ${source.slot}.` : ` Slot ${source.slot} becomes open.`}`
    : reservation ? `Reserve slot ${number} for ${reservation.name}.${current.squad ? ` ${squadLabel(current.squad)} will no longer have this slot.` : ""}`
    : squad ? `Assign ${squadLabel(squad)} to slot ${number}.${current.squad && current.squad_id !== squad.id ? ` ${squadLabel(current.squad)} will no longer have a slot.` : ""}`
    : `Release slot ${number}.${current.squad ? ` ${squadLabel(current.squad)} will no longer have this permanent slot.` : ""}`;
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!changed || busy) return;
    setBusy(true); setError(""); setConflict(false);
    const slots: SlotAssignment[] = data.slots.map((slot) => ({ slot: slot.slot, squad_id: slot.squad_id, reserved_clan_id: slot.reserved_clan_id }));
    const target = slots.find((slot) => slot.slot === number)!;
    if (source) {
      const previous = slots.find((slot) => slot.slot === source.slot)!;
      previous.squad_id = target.squad_id; previous.reserved_clan_id = target.reserved_clan_id;
    }
    target.squad_id = squad?.id ?? null; target.reserved_clan_id = reservation?.id ?? null;
    try { const response = await api.saveCompetitionSlots(token, data.event.id, slots, data.version); onSaved(response.data); }
    catch (reason) { setError(errorText(reason)); setConflict(reason instanceof ApiError && reason.status === 409); }
    finally { setBusy(false); }
  }
  return <dialog className="slot-dialog" ref={dialog} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="slot-editor-title"><form onSubmit={save}>
    <header><div><p>{data.event.permanent ? "PERMANENT ASSIGNMENT" : "TEAM ASSIGNMENT"}</p><h2 id="slot-editor-title">Slot {String(number).padStart(2, "0")}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close slot editor"><Icon name="close" /></button></header>
    <label>Find a squad or player<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clans, squads or players" /></label>
    <label>Assignment<select aria-label={`Assignment for slot ${number}`} value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}><option value="">Open slot — release assignment</option><optgroup label="Squads">{options.map((squad) => { const at = data.slots.find((slot) => slot.squad_id === squad.id)?.slot; return <option key={squad.id} value={squad.id}>{squadLabel(squad)}{at ? ` · slot ${at}` : " · unassigned"}</option>; })}</optgroup>{data.event.permanent && <optgroup label="Reserve for a clan">{data.clans.map((clan) => <option key={clan.id} value={`reserve:${clan.id}`}>{clan.name}</option>)}</optgroup>}</select></label>
    {changed ? <p className="slot-change-preview">{explanation}</p> : <p className="slot-editor-help">Choose another squad to move or swap it here. Choose an open slot to release the assignment.</p>}
    {error && <div className="manage-error" role="alert">{error}{conflict && <button type="button" onClick={onReload}>Reload latest slots</button>}</div>}
    <footer><button type="button" className="slot-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="slot-save" disabled={!changed || busy}>{busy ? "Saving…" : source && current.squad_id ? "Save swap" : "Save assignment"}<Icon name="check" /></button></footer>
  </form></dialog>;
}
