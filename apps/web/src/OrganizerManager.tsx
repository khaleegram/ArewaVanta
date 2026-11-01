import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type { CompetitionOrganizerTeam, ManageEventSummary } from "./api/types";
import { canAccessCompetitions, canManageCompetitions, Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { countLabel, formatDate } from "./presentation";
import { Icon } from "./ui";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };
const errorText = (error: unknown) => error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
function TeamIcon() {
  return <svg className="crew-team-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="16" cy="10" r="4" /><path d="M8 26v-3a8 8 0 0 1 16 0v3M7 7a3 3 0 0 0 0 6M4 24v-3a6 6 0 0 1 4-5.65M25 7a3 3 0 0 1 0 6M28 24v-3a6 6 0 0 0-4-5.65" /></svg>;
}
function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase();
  return <span className={`crew-avatar crew-avatar-${index % 4}`} aria-hidden="true">{letters || "?"}</span>;
}
function Status({ children, retry }: { children: React.ReactNode; retry?: () => void }) {
  return <div className="crew-state" role="status"><TeamIcon /><p>{children}</p>{retry && <button type="button" onClick={retry}>Try again <Icon name="arrow" /></button>}</div>;
}
function groupEvents(events: ManageEventSummary[], selected: string) {
  const groups = new Map<string, ManageEventSummary[]>();
  for (const event of events) {
    const key = event.series_id ?? event.id;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return [...groups.values()].map((weeks) => {
    const ordered = [...weeks].sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
    return weeks.find((week) => week.id === selected) ?? ordered.filter((week) => (week.start_date ?? "") <= today).at(-1) ?? ordered[0];
  });
}
async function loadEvents(token: string, signal: AbortSignal) {
  const first = await api.manageEvents(token, 1, signal);
  const events = [...first.data];
  for (let page = 2; page <= first.meta.last_page; page += 4) {
    const pages = await Promise.all(Array.from({ length: Math.min(4, first.meta.last_page - page + 1) }, (_, offset) => api.manageEvents(token, page + offset, signal)));
    for (const result of pages) events.push(...result.data);
  }
  return events;
}
export default function OrganizerManager() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [events, setEvents] = useState<Load<ManageEventSummary[]>>({ status: "loading" });
  const [eventRetry, setEventRetry] = useState(0);
  const [eventId, setEventId] = useState(() => new URLSearchParams(window.location.search).get("competition") ?? "");
  const [team, setTeam] = useState<Load<CompetitionOrganizerTeam>>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<"team" | "invitations">("team");
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [sendError, setSendError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    const controller = new AbortController();
    api.me(token, controller.signal)
      .then(({ data }) => { if (!controller.signal.aborted) setSession({ token, user: data }); })
      .catch((error) => { if (!controller.signal.aborted) { if (error instanceof ApiError && error.status === 401) clearStoredToken(); setAuthError(errorText(error)); } })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session || !canAccessCompetitions(session.user)) return;
    const controller = new AbortController();
    setEvents({ status: "loading" });
    loadEvents(session.token, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setEvents({ status: "ready", data });
      setEventId((current) => data.some((event) => event.id === current) ? current : groupEvents(data, "")[0]?.id ?? "");
    }).catch((error) => { if (!controller.signal.aborted) setEvents({ status: "error", message: errorText(error) }); });
    return () => controller.abort();
  }, [session?.token, eventRetry]);
  useEffect(() => {
    if (!session || !eventId || events.status !== "ready") return;
    const controller = new AbortController();
    setTeam((current) => current.status === "ready" && current.data.event.id === eventId ? current : { status: "loading" });
    api.competitionOrganizers(session.token, eventId, controller.signal)
      .then(({ data }) => { if (!controller.signal.aborted) setTeam({ status: "ready", data }); })
      .catch((error) => { if (!controller.signal.aborted) setTeam({ status: "error", message: errorText(error) }); });
    return () => controller.abort();
  }, [session?.token, eventId, events, refresh]);
  useEffect(() => {
    if (eventId) window.history.replaceState(null, "", `/manage/organizers?competition=${encodeURIComponent(eventId)}`);
  }, [eventId]);
  async function sendInvitation(address: string) {
    if (!session || !eventId || sendingEmail || team.status !== "ready") return;
    setSendingEmail(address); setNotice(""); setSendError("");
    try {
      await api.inviteCompetitionOrganizer(session.token, eventId, address);
      setEmail(""); setNotice(`Invitation sent to ${address}.`); setTab("invitations"); setSearch("");
      setRefresh((value) => value + 1);
    } catch (error) {
      setSendError(error instanceof ApiError ? Object.values(error.errors).flat().join(" ") || error.message : errorText(error));
    } finally { setSendingEmail(""); }
  }
  async function logout() {
    if (session) { await disableAdminPush(session.token).catch(() => {}); await api.logout(session.token).catch(() => {}); }
    clearStoredToken(); setSession(null);
  }
  const selected = events.status === "ready" ? events.data.find((event) => event.id === eventId) : undefined;
  const data = team.status === "ready" && team.data.event.id === eventId ? team.data : null;
  const pendingCount = data?.invitations.filter((invitation) => invitation.status === "pending").length ?? 0;
  const term = search.trim().toLowerCase();
  const members = data?.members.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(term)) ?? [];
  const invitations = data?.invitations.filter((invitation) => invitation.email.toLowerCase().includes(term)) ?? [];
  return <Shell session={session} onLogout={logout} section="organizers" overview>
    {checking ? <Status>Checking your session…</Status> : !session ? <><SignIn onSuccess={setSession} />{authError && <p className="manage-error" role="alert">{authError}</p>}</> : !canAccessCompetitions(session.user) ? <Status>This page is for competition organizers. <a href="/manage/directory">Go to your clan →</a></Status> : <div className="crew-page">
      <header className="crew-heading"><div><span className="crew-eyebrow">BEHIND EVERY GREAT GAME</span><h1>Organizers<span>.</span></h1><p>Invite your crew. Run competitions together.</p></div><button className="crew-invite-shortcut" type="button" onClick={() => emailInput.current?.focus()} disabled={!data}><Icon name="plus" /> Invite organizer</button></header>
      {events.status === "error" ? <Status retry={() => setEventRetry((value) => value + 1)}>{events.message}</Status> : events.status === "loading" ? <Status>Loading your competitions…</Status> : !events.data.length ? <Status>{canManageCompetitions(session.user) ? <>Create a competition to start building your organizer team. <a href="/manage/competitions">Open competitions →</a></> : "Your assigned competitions will appear here."}</Status> : <>
        <section className="crew-competition" aria-label="Selected competition">
          <span className="crew-competition-icon"><Icon name="trophy" /></span>
          <label><span>MANAGING ORGANIZERS FOR</span><select aria-label="Choose a competition" value={eventId} disabled={!!sendingEmail} onChange={(e) => { setEventId(e.target.value); setTeam({ status: "loading" }); setEmail(""); setNotice(""); setSendError(""); setSearch(""); setTab("team"); }}>{groupEvents(events.data, eventId).map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
          {selected?.series_id && <span className="crew-series-label"><span /> Every week</span>}
          <a href={`/manage/competitions/${encodeURIComponent(eventId)}`} aria-label="Open selected competition">Competition <Icon name="diagonal" /></a>
        </section>
        <div className="crew-layout">
          <section className="crew-team" aria-label="Competition organizer team">
            <div className="crew-team-heading"><div><span className="crew-section-icon"><TeamIcon /></span><div><h2>The organizer team</h2><p>Everyone helping make game day happen.</p></div></div><div className="crew-team-avatars" aria-hidden="true">{data?.members.slice(0, 3).map((member, index) => <Avatar key={member.id} name={member.name} index={index} />)}</div></div>
            <div className="crew-tabs" role="tablist" aria-label="Organizer lists">{(["team", "invitations"] as const).map((value) => <button key={value} type="button" role="tab" id={`crew-${value}-tab`} aria-selected={tab === value} aria-controls="crew-panel" tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value); setSearch(""); }} onKeyDown={(e) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); const next = e.key === "Home" ? "team" : e.key === "End" ? "invitations" : value === "team" ? "invitations" : "team"; setTab(next); setSearch(""); document.getElementById(`crew-${next}-tab`)?.focus(); }}>{value === "team" ? "Team" : "Invitations"}<span>{data ? value === "team" ? data.members.length : data.invitations.length : "—"}</span></button>)}<small>{pendingCount > 0 ? `${pendingCount} awaiting a reply` : "Competition access"}</small></div>
            {data && (tab === "team" ? data.members.length > 4 : data.invitations.length > 4) && <label className="crew-search"><Icon name="target" /><span className="sr-only">Search {tab === "team" ? "organizers" : "invitations"}</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "team" ? "Find an organizer…" : "Find an invitation…"} /></label>}
            <div id="crew-panel" role="tabpanel" aria-labelledby={`crew-${tab}-tab`} tabIndex={0}>
              {team.status === "error" ? <Status retry={() => setRefresh((value) => value + 1)}>{team.message}</Status> : !data ? <Status>Loading the organizer team…</Status> : tab === "team" ? <>
                <ul className="crew-member-list">{members.map((member, index) => <li key={member.id}><Avatar name={member.name} index={index} /><div className="crew-person"><strong>{member.name}{String(member.id) === String(session.user.id) && <span>You</span>}</strong><span>{member.email}</span><small>{member.access === "global" ? "All competitions" : selected?.series_id ? "Weekly series organizer" : "Competition organizer"}</small></div><span className="crew-active"><i /> Active</span></li>)}</ul>
                {!members.length && <Status>{search ? "No organizers match your search." : "Bring your crew together. Invite someone to help run this competition."}</Status>}
              </> : <>
                <ul className="crew-invitation-list">{invitations.map((invitation) => <li key={invitation.id}><span className={`crew-invitation-icon${invitation.status === "expired" ? " is-expired" : ""}`}><Icon name={invitation.status === "expired" ? "calendar" : "arrow"} /></span><div className="crew-person"><strong>{invitation.email}</strong><span>Sent {formatDate(invitation.sent_at.slice(0, 10))}</span><small className={invitation.status === "expired" ? "crew-expired" : "crew-pending"}>{invitation.status === "expired" ? "Invite expired" : `Awaiting acceptance · expires ${formatDate(invitation.expires_at.slice(0, 10))}`}</small></div><button className="crew-resend" type="button" disabled={!!sendingEmail} onClick={() => void sendInvitation(invitation.email)}>{sendingEmail === invitation.email ? "Sending…" : "Resend"}<Icon name="arrow" /></button></li>)}</ul>
                {!invitations.length && <Status>{search ? "No invitations match your search." : "No invitations waiting. Send an invite and track it here."}</Status>}
              </>}
            </div>
            <footer className="crew-team-foot"><Icon name="check" /><span>{selected?.series_id ? "One team for the whole series. Access continues across upcoming weeks." : "These organizers can manage this competition’s schedule, slots and results."}</span></footer>
          </section>
          <aside className="crew-invite" id="invite-organizer" aria-labelledby="invite-organizer-title">
            <div className="crew-invite-intro"><span className="crew-invite-icon"><TeamIcon /><i><Icon name="plus" /></i></span><span className="crew-eyebrow">GROW YOUR CREW</span><h2 id="invite-organizer-title">Invite an<br />organizer.</h2><p>Invite an organizer by email. They’ll receive a link to join your crew.</p></div>
            <form className="crew-invite-form" onSubmit={(e) => { e.preventDefault(); void sendInvitation(email.trim()); }}><label htmlFor="organizer-email">Their email address</label><input ref={emailInput} id="organizer-email" name="email" type="email" autoComplete="email" required maxLength={255} placeholder="name@example.com" value={email} disabled={!!sendingEmail} onChange={(e) => setEmail(e.target.value)} /><p>Works for new and existing accounts.</p><button type="submit" disabled={!data || !!sendingEmail}>{sendingEmail ? "Sending invitation…" : "Send invitation"}<Icon name="arrow" /></button></form>
            {notice && <div className="crew-feedback" role="status"><Icon name="check" /><span>{notice}</span></div>}{sendError && <div className="crew-feedback crew-feedback-error" role="alert"><span>{sendError}</span></div>}
            <details className="crew-access"><summary>Access & permissions <Icon name="chevron" /></summary><div><h3>They’ll be able to manage</h3><ul>{["Games & results", "Squads & slots", "Schedule & scoring", "Organizer invitations"].map((permission) => <li key={permission}><Icon name="check" />{permission}</li>)}</ul><p>{selected?.series_id ? "Access applies to every week of this scrim series." : "Access is limited to this competition."} Invitation links are valid for 7 days.</p></div></details>
          </aside>
        </div>
      </>}
    </div>}
  </Shell>;
}
