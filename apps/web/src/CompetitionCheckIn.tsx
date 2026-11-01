import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import type { EventCheckIn } from "./api/types";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { Icon } from "./ui";
import { formatDateRange } from "./presentation";
import { usePageSeo } from "./seo";
import "./competition-check-in.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: EventCheckIn };
type Slot = EventCheckIn["slots"][number];

export default function CompetitionCheckIn({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [report, setReport] = useState<Load>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [dayId, setDayId] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  usePageSeo({ title: `${report.status === "ready" ? report.data.event.title : "Competition"} · Slot check-in | ArewaVanta`, description: "Organizer slot and player verification sheet.", path: `/manage/competitions/${eventId}/check-in`, noIndex: true });
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    const controller = new AbortController();
    api.me(token, controller.signal).then(({ data }) => setSession({ token, user: data })).catch((error) => {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && error.status === 401) clearStoredToken();
        setAuthError(error instanceof ApiError ? error.message : "Couldn’t check your session.");
      }
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(); setReport({ status: "loading" });
    api.eventCheckIn(session.token, eventId, controller.signal).then(({ data }) => setReport({ status: "ready", data })).catch((error) => {
      if (!controller.signal.aborted) setReport({ status: "error", message: error instanceof ApiError ? error.message : "Couldn’t load the slot sheet." });
    });
    return () => controller.abort();
  }, [session?.token, eventId, revision]);
  async function logout() {
    if (session) {
      await disableAdminPush(session.token).catch(() => {});
      await api.logout(session.token).catch(() => {});
    }
    clearStoredToken(); setSession(null); setReport({ status: "loading" });
  }
  const data = report.status === "ready" ? report.data : null;
  const dateParts = data ? new Intl.DateTimeFormat("en", { timeZone: data.event.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(data.generated_at)) : [];
  const today = ["year", "month", "day"].map((type) => dateParts.find((part) => part.type === type)?.value ?? "").join("-");
  const selectedDay = data?.event.days.find((day) => day.id === dayId)
    ?? data?.event.days.find((day) => day.date >= today) ?? data?.event.days.at(-1);
  return <Shell section="competitions" session={session} onLogout={logout}>
    {checking ? <div className="manage-notice">Checking your session…</div> : !session ? <><SignIn onSuccess={setSession} />{authError && <p role="alert">{authError}</p>}</> : <div className="check-in-page">
      <div className="check-in-toolbar"><a href={`/manage/competitions/${encodeURIComponent(eventId)}`}>← Competition</a><div><button type="button" onClick={() => setRevision((value) => value + 1)} disabled={!data}>Refresh lineups</button><button type="button" className="check-in-print" onClick={() => window.print()} disabled={!data}><Icon name="print" />Print / Save PDF</button></div></div>
      <div className="check-in-intro"><p>MATCH-DAY VERIFICATION</p><h1>Slots & players<span>.</span></h1><p>Check every team and player before the lobby starts.</p></div>
      {report.status === "loading" && <p className="manage-notice" role="status">Loading current slots and players…</p>}
      {report.status === "error" && <div className="manage-error" role="alert">{report.message}<button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div>}
      {data && <>
        <div className="check-in-controls">
          {data.event.days.length > 0 && <div className="check-in-day"><label htmlFor="check-in-match-day">Sheet for match day</label><select id="check-in-match-day" value={selectedDay?.id ?? ""} onChange={(event) => setDayId(event.target.value)}>{data.event.days.map((day) => <option key={day.id} value={day.id}>{day.label || "Match day"} · {formatDateRange(day.date, null)}</option>)}</select></div>}
          <label className="check-in-empty-toggle"><input type="checkbox" checked={includeEmpty} onChange={(event) => setIncludeEmpty(event.target.checked)} />Include empty slots</label>
          <span>Refresh after roster changes. This sheet uses current registered players.</span>
        </div>
        <CheckInSheet key={`${revision}-${data.generated_at}-${selectedDay?.id}`} data={data} day={selectedDay} includeEmpty={includeEmpty} />
      </>}
    </div>}
  </Shell>;
}

function CheckInSheet({ data, day, includeEmpty }: { data: EventCheckIn; day?: EventCheckIn["event"]["days"][number]; includeEmpty: boolean }) {
  const occupied = new Set(data.slots.flatMap((slot) => slot.slot_number === null ? [] : [slot.slot_number]));
  const emptyNumbers = Array.from({ length: data.event.squad_capacity }, (_, index) => index + 1).filter((number) => !occupied.has(number));
  const rows: { number: number | null; team: Slot | null }[] = data.slots.map((team) => ({ number: team.slot_number, team }));
  if (includeEmpty) rows.push(...emptyNumbers.map((number) => ({ number, team: null })));
  rows.sort((left, right) => (left.number ?? Infinity) - (right.number ?? Infinity));
  const playerCount = data.slots.reduce((total, slot) => total + slot.players.length, 0);
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: data.event.timezone }).format(new Date(data.generated_at));
  return <section className="check-in-sheet" aria-label="Printable team verification report">
    <header className="check-in-sheet-header"><div className="check-in-brand"><img src="/favicon-192.png" alt="" /><strong>arewavanta<span>.</span></strong></div><span>OFFICIAL LOBBY SHEET</span><h2>{data.event.title}</h2><p>{day ? `${day.label || "Match day"} · ${formatDateRange(day.date, null)}` : formatDateRange(data.event.days[0]?.date ?? null, data.event.days.at(-1)?.date ?? null)}</p><small>Current rosters · {timestamp} · {data.event.timezone === "Africa/Lagos" ? "WAT" : data.event.timezone}</small></header>
    <div className="check-in-summary"><span><strong>{data.slots.length}<small> / {data.event.squad_capacity}</small></strong>Teams assigned</span><span><strong>{playerCount}</strong>Players listed</span><span><strong>{emptyNumbers.length}</strong>Empty slots</span></div>
    {emptyNumbers.length > 0 && <p className="check-in-vacancies"><strong>Empty slots:</strong> {emptyNumbers.join(", ")}</p>}
    {data.slots.some((slot) => slot.slot_number === null) && <p className="check-in-warning">Some teams still need a slot number. Assign their slots before the lobby starts.</p>}
    {data.slots.length === 0 && <p className="check-in-no-teams">No teams have been assigned yet. Assign slots from Manage slots, then refresh this sheet.</p>}
    <div className="check-in-grid">{rows.map(({ number, team }) => <article className={`check-in-slot${team ? "" : " is-vacant"}`} key={team?.squad.id ?? `vacant-${number}`} aria-label={`Slot ${number ?? "not assigned"}${team ? ` · ${team.clan.name} ${team.squad.name}` : " · empty"}`}>
      <header><span className="check-in-slot-number"><small>SLOT</small><b>{number === null ? "—" : String(number).padStart(2, "0")}</b></span><div>{team ? <><small>{team.clan.tag}</small><h3>{team.clan.name}</h3><p>{team.squad.name}</p></> : <h3>Empty slot</h3>}</div>{team && <span className="check-in-roster-count">{team.players.length} players</span>}</header>
      {team && <>
        {team.players.length > 0 ? <ul>{team.players.map((player) => <li key={player.id}><label><input type="checkbox" aria-label={`Verify ${player.ign} in slot ${number ?? "unassigned"}`} /><span>{player.ign}</span></label></li>)}</ul> : <p className="check-in-missing-players">No players registered for this squad. Confirm the lineup before play.</p>}
        <footer><label><input type="checkbox" aria-label={`Team in slot ${number ?? "unassigned"} verified`} />Team verified</label><span>Notes: <i /></span></footer>
      </>}
    </article>)}</div>
    <div className="check-in-signoff"><span>Checked by: <i /></span><span>Lobby / time: <i /></span></div>
    <p className="check-in-sheet-footer">{data.event.title} · {day ? formatDateRange(day.date, null) : "Slot verification"} · Rosters refreshed {timestamp}</p>
  </section>;
}
