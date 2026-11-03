import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type { CompetitionSlots, ManageEvent, SlotAssignment } from "./api/types";
import { Icon } from "./ui";
import "./slot-manager.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CompetitionSlots };
const errorText = (error: unknown) => error instanceof ApiError ? [...new Set([error.message, ...Object.values(error.errors).flat()])].join(" ") : "Couldn’t save slots. Please try again.";

export default function SlotManager({ token, event }: { token: string; event: ManageEvent }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "open">("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoad({ status: "loading" });
    api.competitionSlots(token, event.id, controller.signal).then(({ data }) => setLoad({ status: "ready", data })).catch((error) => { if (!controller.signal.aborted) setLoad({ status: "error", message: errorText(error) }); });
    return () => controller.abort();
  }, [token, event.id, refresh]);
  useEffect(() => { const visible = () => { if (document.visibilityState === "visible" && editing === null) setRefresh((value) => value + 1); }; document.addEventListener("visibilitychange", visible); return () => document.removeEventListener("visibilitychange", visible); }, [editing]);
  const data = load.status === "ready" ? load.data : null;
  const assigned = data?.slots.filter((slot) => slot.squad_id).length ?? 0;
  const reserved = data?.slots.filter((slot) => !slot.squad_id && slot.reserved_clan_id).length ?? 0;
  const open = (data?.event.capacity ?? 0) - assigned - reserved;
  const visible = data?.slots.filter((slot) => {
    if (filter === "assigned" && !slot.squad_id) return false;
    if (filter === "open" && (slot.squad_id || slot.reserved_clan_id)) return false;
    return `${slot.slot} ${slot.squad?.clan.name ?? ""} ${slot.squad?.clan.tag ?? ""} ${slot.reserved_clan?.name ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }) ?? [];
  return <div className="slots-page" data-unsaved={editing !== null ? "true" : undefined}>
    <a className="slots-back" href={`/manage/competitions/${encodeURIComponent(event.id)}`}>← {event.title}</a>
    <header className="slots-heading"><div><p>{data?.event.permanent ? "STANDING LOBBY" : "COMPETITION LOBBY"}</p><h1>Clan slots<span>.</span></h1><p>Assign slots to clans. Players can play in any of their clan’s slots.</p></div><a className="slots-print" href={`/manage/competitions/${encodeURIComponent(event.id)}/check-in`}><Icon name="print" />Print slots</a></header>
    {notice && <div className="manage-success" role="status">{notice}</div>}
    {load.status === "loading" ? <p className="manage-notice" role="status">Loading slots…</p> : load.status === "error" ? <div className="manage-error" role="alert">{load.message}<button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div> : data && <>
      <section className="slots-summary" aria-label="Lobby capacity"><div><strong>{assigned}<small> / {data.event.capacity}</small></strong><span>Assigned slots</span></div><div><strong>{open}</strong><span>Open slots</span></div><div><strong>{reserved}</strong><span>Clan reservations</span></div><p><Icon name="check" />{data.event.permanent ? "Carries forward automatically" : "Ready for this competition"}</p></section>
      {!data.event.can_edit && <p className="manage-notice">This competition has saved games. Its recorded slot list is preserved.</p>}
      <div className="slots-toolbar"><label><span className="sr-only">Find a slot or clan</span><input type="search" placeholder="Find a slot or clan…" value={query} onChange={(change) => setQuery(change.target.value)} /></label><div className="slots-filters" aria-label="Filter slots">{([['all', 'All slots'], ['assigned', 'Assigned'], ['open', 'Open']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      <div className="slots-grid">{visible.map((slot) => <article className={`slot-card ${slot.squad_id ? "is-assigned" : slot.reserved_clan_id ? "is-reserved" : "is-open"}`} key={slot.slot} aria-label={`Slot ${slot.slot}`}><div className="slot-card-top"><span className="slot-number"><small>SLOT</small><strong>{String(slot.slot).padStart(2, "0")}</strong></span><div className="slot-identity">{slot.squad ? <><strong>{slot.squad.clan.name}</strong><span>{slot.squad.clan.tag}</span></> : slot.squad_id ? <><strong>Assigned clan unavailable</strong><span>Review this assignment</span></> : slot.reserved_clan ? <><strong>{slot.reserved_clan.name}</strong><span>Reserved for this clan</span></> : <><strong>Open slot</strong><span>Ready for a clan</span></>}</div>{data.event.can_edit && <button type="button" className="slot-edit" aria-label={`${slot.squad_id || slot.reserved_clan_id ? "Change" : "Assign"} slot ${slot.slot}`} onClick={() => setEditing(slot.slot)}>{slot.squad_id || slot.reserved_clan_id ? "Change" : "Assign"}<Icon name="arrow" /></button>}</div></article>)}</div>
      {!visible.length && <p className="manage-notice">No slots match your search.</p>}
      {data.event.permanent && <p className="slots-footnote">Slots carry forward until an organizer changes them. Saved games keep their original records.</p>}
    </>}
    {data && editing !== null && <SlotEditor key={`${editing}-${data.version}`} data={data} number={editing} token={token} onClose={() => setEditing(null)} onReload={() => { setEditing(null); setRefresh((value) => value + 1); }} onSaved={(updated) => { setLoad({ status: "ready", data: updated }); setEditing(null); setNotice("Slot assignments updated."); }} />}
  </div>;
}

function SlotEditor({ data, number, token, onClose, onSaved, onReload }: { data: CompetitionSlots; number: number; token: string; onClose: () => void; onSaved: (data: CompetitionSlots) => void; onReload: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = data.slots.find((slot) => slot.slot === number)!;
  const [choice, setChoice] = useState("current");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const clan = choice.startsWith("new:") ? data.clans.find((item) => item.id === choice.slice(4)) : null;
  const alreadyAssigned = !!clan && current.squad?.clan.id === clan.id;
  const reservation = choice.startsWith("reserve:") ? data.clans.find((item) => item.id === choice.slice(8)) : null;
  const source = choice.startsWith("move:") ? data.slots.find((slot) => String(slot.slot) === choice.slice(5)) : null;
  const options = data.clans.filter((item) => `${item.name} ${item.tag}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (choice === "current" || busy) return;
    setBusy(true); setError(""); setConflict(false);
    const slots: SlotAssignment[] = data.slots.map((slot) => ({ slot: slot.slot, squad_id: slot.squad_id, reserved_clan_id: slot.reserved_clan_id }));
    const target = slots.find((slot) => slot.slot === number)!;
    if (source) { const previous = slots.find((slot) => slot.slot === source.slot)!; previous.squad_id = target.squad_id; previous.reserved_clan_id = target.reserved_clan_id; target.squad_id = source.squad_id; target.reserved_clan_id = source.reserved_clan_id; }
    else { target.squad_id = null; target.reserved_clan_id = reservation?.id ?? null; target.new_clan_id = clan?.id ?? null; }
    try { const response = await api.saveCompetitionSlots(token, data.event.id, slots, data.version); onSaved(response.data); }
    catch (reason) { setError(errorText(reason)); setConflict(reason instanceof ApiError && reason.status === 409); }
    finally { setBusy(false); }
  }
  return <dialog className="slot-dialog" ref={dialog} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="slot-editor-title"><form onSubmit={save}>
    <header><div><p>CLAN SLOT</p><h2 id="slot-editor-title">Slot {String(number).padStart(2, "0")}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close slot editor"><Icon name="close" /></button></header>
    <label>Find clan<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clans" /></label>
    <label>Assignment<select aria-label={`Assignment for slot ${number}`} value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}><option value="current">{current.squad?.clan.name ?? current.reserved_clan?.name ?? "Open slot"} · current</option><option value="release">Release slot</option><optgroup label="Assign a new slot to a clan">{options.map((item) => <option key={item.id} value={`new:${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="Move an existing slot">{data.slots.filter((slot) => slot.slot !== number && slot.squad).map((slot) => <option key={slot.slot} value={`move:${slot.slot}`}>Slot {slot.slot} · {slot.squad!.clan.name}</option>)}</optgroup>{data.event.permanent && <optgroup label="Reserve for a clan">{options.map((item) => <option key={item.id} value={`reserve:${item.id}`}>{item.name}</option>)}</optgroup>}</select></label>
    <p className="slot-editor-help">{source ? `Move slot ${source.slot} here${current.squad_id || current.reserved_clan_id ? " and swap its current assignment" : ""}.` : alreadyAssigned ? `${clan!.name} already has this slot.` : clan ? `Give ${clan.name} a new slot.` : reservation ? `Reserve this slot for ${reservation.name}.` : choice === "release" ? "Release this slot." : "Choose a clan or move an existing slot. Previous results remain recorded."}</p>
    {error && <div className="manage-error" role="alert">{error}{conflict && <button type="button" onClick={onReload}>Reload latest slots</button>}</div>}
    <footer><button type="button" className="slot-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="slot-save" disabled={choice === "current" || alreadyAssigned || busy}>{busy ? "Saving…" : "Save assignment"}<Icon name="check" /></button></footer>
  </form></dialog>;
}
