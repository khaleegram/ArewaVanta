import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type {
  ManageEvent,
  RecurrenceAction,
  ManageEventSummary,
  EventSubmissionReview,
  ScheduleInput,
  ScoringPreset,
  ManagePerson,
  User,
} from "./api/types";
import { Brand, Icon } from "./ui";
import { clearStoredToken, getStoredToken, storeToken, tokenKey } from "./authStorage";
import AdminAlerts, { disableAdminPush } from "./AdminAlerts";
import {
  competitionTypeLabel,
  countLabel,
  formatDateRange,
  gamesWithResults,
  scoringLabel,
  squadIdentity,
  submissionStatusLabel,
} from "./presentation";
import "./competition-manager.css";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
export type Session = { token: string; user: User };
export function canManageCompetitions(user: User | null | undefined): boolean {
  return !!user?.roles.some(
    (role) =>
      role.role === "platform_admin" ||
      (role.role === "organizer" && role.scope_type === "global"),
  );
}
type Game = {
  id: string | null;
  map_code: string;
  map_label: string;
  has_results: boolean;
};
type Day = { id: string | null; date: string; label: string; games: Game[] };
type Form = {
  title: string;
  description: string;
  competition_type: "" | "scrim" | "league" | "tournament";
  score: string;
  squadCapacity: number;
  days: Day[];
};
export { tokenKey };
const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
function weekend() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${parts}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  const first = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  return [first, date.toISOString().slice(0, 10)];
}
const maps = ["Isolated", "Isolated", "Blackout"];
const standardDays = (): Day[] =>
  weekend().map((date, index) => ({
    id: null,
    date,
    label: index ? "Sunday" : "Saturday",
    games: maps.map((map_label) => ({
      id: null,
      map_code: map_label.toLowerCase(),
      map_label,
      has_results: false,
    })),
  }));
function fromEvent(event: ManageEvent, presets: ScoringPreset[]): Form {
  const version = presets
    .find((preset) => preset.name === event.scoring.preset_name)
    ?.versions.find(
      (item) => item.version_number === event.scoring.version_number,
    );
  return {
    title: event.title,
    description: event.description ?? "",
    competition_type: event.competition_type ?? "",
    score: version?.id ?? "",
    squadCapacity: event.squad_capacity,
    days: (event.days ?? []).map((day) => ({
      id: day.id,
      date: day.date,
      label: day.label,
      games: day.matches.map((game) => ({
        id: game.id,
        map_code: game.map_code,
        map_label: game.map_label,
        has_results: game.has_results,
      })),
    })),
  };
}
const schedule = (days: Day[]): ScheduleInput =>
  days.map((day) => ({
    id: day.id,
    date: day.date,
    label: day.label,
    games: day.games.map((game) => ({
      id: game.id,
      map_code: game.map_code,
      map_label: game.map_label,
    })),
  }));
const scheduleKey = (days: Day[]) => JSON.stringify(schedule(days));
function State({
  children,
  retry,
}: {
  children: React.ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="manage-notice" role="status">
      <p>{children}</p>
      {retry && (
        <button type="button" onClick={retry}>
          Try again →
        </button>
      )}
    </div>
  );
}
export function Shell({
  children,
  session,
  onLogout,
  section = "competitions",
  overview = false,
}: {
  children: React.ReactNode;
  session: Session | null;
  onLogout: () => void;
  section?: "competitions" | "directory";
  overview?: boolean;
}) {
  const organizer = !session || canManageCompetitions(session.user);
  const captain = !!session?.user.roles.some(
    (role) => role.role === "clan_captain",
  );
  return (
    <div className={`manage-page${overview ? " studio-shell" : ""}`}>
      <a className="skip-link" href="#manage-main">
        Skip to content
      </a>
      <header className="manage-header">
        <div className="manage-wrap manage-header-inner">
          <Brand href="/" />
          <div className="manage-head-actions">
            {session?.user.roles.some(
              (role) => role.role === "platform_admin",
            ) && <AdminAlerts token={session.token} />}
            {overview ? <details className="studio-account" onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="Account options"><Icon name="menu" /></summary><div>
              {session && <small>{session.user.name}</small>}
              <a href="/">View public site <Icon name="diagonal" /></a>
              {session && <button type="button" onClick={onLogout}>Sign out</button>}
            </div></details> : <>
              {session && <button type="button" onClick={onLogout}>Sign out</button>}
              <a href="/">View site <Icon name="diagonal" /></a>
            </>}
          </div>
        </div>
      </header>
      <div className="manage-bar">
        <div className="manage-wrap">
          <span>{organizer ? "ORGANIZER" : captain ? "CLAN CAPTAIN" : "MANAGEMENT"}</span>
          <nav
            className="manage-nav"
            aria-label={organizer ? "Organizer navigation" : "Clan navigation"}
          >
            {organizer && (
              <a
                href="/manage/competitions"
                aria-current={section === "competitions" ? "page" : undefined}
              >
                Competitions
              </a>
            )}
            <a
              href="/manage/directory"
              aria-current={section === "directory" ? "page" : undefined}
            >
              {captain && !organizer ? "My clan" : "Clans & players"}
            </a>
          </nav>
          {session && <small>{session.user.name}</small>}
        </div>
      </div>
      <main className="manage-wrap manage-main" id="manage-main">
        {children}
      </main>
    </div>
  );
}
export function SignIn({
  onSuccess,
}: {
  onSuccess: (session: Session) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.login(email.trim(), password);
      storeToken(data.token);
      onSuccess(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="manage-login">
      <p className="manage-eyebrow">ORGANIZER &amp; CLAN CAPTAIN ACCESS</p>
      <h1>
        Sign in<span>.</span>
      </h1>
      <p>Your account role determines which management tools you can use.</p>
      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <a
          className="manage-auth-link"
          href={
            email.trim()
              ? `/forgot-password?email=${encodeURIComponent(email.trim())}`
              : "/forgot-password"
          }
        >
          Forgot password?
        </a>
        {error && (
          <div className="manage-error" role="alert">
            {error}
          </div>
        )}
        <button className="manage-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"} <Icon name="arrow" />
        </button>
      </form>
    </section>
  );
}
type Entry = { summary: ManageEventSummary; detail: ManageEvent | null };
async function getEntries(
  token: string,
  signal: AbortSignal,
): Promise<Entry[]> {
  const first = await api.manageEvents(token, 1, signal);
  const pages = [first.data];
  for (let page = 2; page <= first.meta.last_page; page += 4)
    pages.push(
      ...(
        await Promise.all(
          Array.from(
            { length: Math.min(4, first.meta.last_page - page + 1) },
            (_, i) => api.manageEvents(token, page + i, signal),
          ),
        )
      ).map((result) => result.data),
    );
  const summaries = pages.flat();
  const result: Entry[] = [];
  for (let i = 0; i < summaries.length; i += 4) {
    const batch = summaries.slice(i, i + 4);
    const details = await Promise.all(
      batch.map((item) =>
        api
          .manageEvent(token, item.id, signal)
          .then((r) => r.data)
          .catch((error) => {
            if (signal.aborted) throw error;
            return null;
          }),
      ),
    );
    result.push(
      ...batch.map((summary, j) => ({ summary, detail: details[j] })),
    );
  }
  return result;
}
function groupCompetitionEntries(entries: Entry[]): Entry[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = entry.summary.series_id ?? entry.summary.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((weeks) => {
    const chronological = [...weeks].sort((a, b) => (a.summary.start_date ?? "").localeCompare(b.summary.start_date ?? ""));
    const current = chronological.find((entry) => {
      const now = new Intl.DateTimeFormat("en-CA", { timeZone: entry.detail?.timezone ?? "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const days = entry.detail?.days ?? [];
      const end = days.at(-1)?.date ?? entry.summary.start_date;
      return !!end && end >= now;
    });
    return current ?? chronological.at(-1)!;
  });
}
export default function CompetitionManager({
  entriesEventId,
  workspaceEventId,
}: {
  entriesEventId?: string;
  workspaceEventId?: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [entries, setEntries] = useState<Load<Entry[]>>({ status: "loading" });
  const [view, setView] = useState<
    | { kind: "list" }
    | { kind: "form"; event: ManageEvent | null }
    | { kind: "entries"; eventId: string }
    | { kind: "workspace"; eventId: string }
  >(() => entriesEventId
    ? { kind: "entries", eventId: entriesEventId }
    : workspaceEventId
      ? { kind: "workspace", eventId: workspaceEventId }
      : { kind: "list" });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setChecking(false);
      return;
    }
    const controller = new AbortController();
    api
      .me(token, controller.signal)
      .then(({ data }) => setSession({ token, user: data }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          if (err instanceof ApiError && err.status === 401)
            clearStoredToken();
          setNotice(errorMessage(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session || !canManageCompetitions(session.user)) return;
    const controller = new AbortController();
    setEntries({ status: "loading" });
    getEntries(session.token, controller.signal)
      .then((data) => setEntries({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setEntries({ status: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [session?.token, refresh]);
  async function logout() {
    if (session) {
      try {
        await disableAdminPush(session.token).catch(() => {});
        await api.logout(session.token);
      } catch {
        /* Local sign out remains available. */
      }
    }
    clearStoredToken();
    setSession(null);
    setView({ kind: "list" });
    setNotice("");
  }
  const canCreate = canManageCompetitions(session?.user);
  return (
    <Shell session={session} onLogout={logout} overview={view.kind === "workspace" && !!session && canManageCompetitions(session.user)}>
      {checking ? (
        <State>Checking your session…</State>
      ) : !session ? (
        <>
          <SignIn onSuccess={setSession} />
          {notice && <State>{notice}</State>}
        </>
      ) : !canManageCompetitions(session.user) ? (
        <div className="manage-notice" role="status">
          <p className="manage-eyebrow">
            {session.user.roles.some((role) => role.role === "clan_captain")
              ? "CLAN CAPTAIN ACCESS"
              : "NO ORGANIZER ACCESS"}
          </p>
          <strong>Competition management is for ArewaVanta organizers.</strong>
          <p>
            {session.user.roles.some((role) => role.role === "clan_captain")
              ? "Your account manages your clan and its squads."
              : "This account does not have permission to manage competitions."}
          </p>
          {session.user.roles.some((role) => role.role === "clan_captain") && (
            <a className="manage-primary" href="/manage/directory">
              Go to my clan
            </a>
          )}
        </div>
      ) : view.kind === "form" ? (
        <EventForm
          token={session.token}
          initial={view.event}
          onCancel={() => setView(workspaceEventId
            ? { kind: "workspace", eventId: workspaceEventId }
            : { kind: "list" })}
          onSaved={() => {
            setNotice("Competition saved.");
            setView(workspaceEventId
              ? { kind: "workspace", eventId: workspaceEventId }
              : { kind: "list" });
            setRefresh((n) => n + 1);
          }}
        />
      ) : view.kind === "entries" ? (
        entries.status === "ready" ? (
          entries.data.find((entry) => entry.summary.id === view.eventId)?.detail ? (
            <EventEntries
              token={session.token}
              event={entries.data.find((entry) => entry.summary.id === view.eventId)!.detail!}
            />
          ) : (
            <State retry={() => setRefresh((n) => n + 1)}>This competition could not be loaded.</State>
          )
        ) : entries.status === "error" ? (
          <State retry={() => setRefresh((n) => n + 1)}>{entries.message}</State>
        ) : <State>Loading competition entries…</State>
      ) : view.kind === "workspace" ? (
        entries.status === "ready" ? (
          entries.data.find((entry) => entry.summary.id === view.eventId)?.detail ? (
            <EventWorkspace
              token={session.token}
              user={session.user}
              event={entries.data.find((entry) => entry.summary.id === view.eventId)!.detail!}
              onEdit={(event) => setView({ kind: "form", event })}
            />
          ) : (
            <State retry={() => setRefresh((n) => n + 1)}>This competition could not be loaded.</State>
          )
        ) : entries.status === "error" ? (
          <State retry={() => setRefresh((n) => n + 1)}>{entries.message}</State>
        ) : <State>Loading competition…</State>
      ) : (
        <>
          <div className="manage-page-heading">
            <div>
              <p className="manage-eyebrow">YOUR WORKSPACE</p>
              <h1>
                Competitions<span>.</span>
              </h1>
              <p>Dates, squads and results in one place.</p>
            </div>
            {canCreate && (
              <button
                className="manage-primary"
                onClick={() => {
                  setNotice("");
                  setView({ kind: "form", event: null });
                }}
              >
                <Icon name="plus" /> Create competition
              </button>
            )}
          </div>
          {notice && (
            <div className="manage-success" role="status">
              {notice}
            </div>
          )}
          {entries.status === "loading" && (
            <State>Loading your competitions…</State>
          )}
          {entries.status === "error" && (
            <State retry={() => setRefresh((n) => n + 1)}>
              {entries.message}
            </State>
          )}
          {entries.status === "ready" && !entries.data.length && (
            <State>
              No competitions yet.
              {canCreate
                ? " Create one to get started."
                : " Assigned competitions will appear here."}
            </State>
          )}
          {entries.status === "ready" && (
            <div className="manage-list">
              {groupCompetitionEntries(entries.data).map(({ summary, detail }) => (
                <article className="manage-event" key={summary.id}>
                  <div className="manage-event-main">
                    <div className="manage-event-top">
                      <span className="manage-event-type">
                        {summary.series_id ? "Weekly scrims" : detail?.competition_type
                          ? competitionTypeLabel(detail.competition_type)
                          : (summary.season?.name ?? "Competition")}
                      </span>
                      <span className="manage-event-status">
                        {summary.skipped_at ? "Not playing this week" : gamesWithResults(
                          summary.scored_match_count,
                          summary.match_count,
                        )}
                      </span>
                    </div>
                    <h2>{summary.title}</h2>
                    <p className="manage-date">
                      <Icon name="calendar" />{" "}
                      {formatDateRange(
                        summary.start_date,
                        detail?.days?.length
                          ? detail.days[detail.days.length - 1].date
                          : null,
                      )}
                    </p>
                    <div className="manage-meta">
                      <span>
                        <strong>{summary.match_count}</strong>{" "}
                        {summary.match_count === 1 ? "game" : "games"}
                      </span>
                      <span>
                        <strong>{summary.squad_count}</strong> of{" "}
                        {summary.squad_capacity} squad slots filled
                      </span>
                      <span>
                        {summary.pending_submission_count
                          ? `${countLabel(summary.pending_submission_count, "squad")} awaiting review`
                          : "No squads awaiting review"}
                      </span>
                      {detail && (
                        <span>
                          Scoring: {scoringLabel(detail.scoring.preset_name)}
                        </span>
                      )}
                    </div>
                    {!detail && (
                      <small className="manage-detail-error">
                        This competition’s details didn’t load. Reload the page
                        to edit it.
                      </small>
                    )}
                  </div>
                  <div className="manage-event-actions">
                    <a className="manage-primary" href={`/manage/competitions/${encodeURIComponent(summary.id)}`}>
                      {summary.series_id ? "Manage weekly scrims" : "Manage competition"} <Icon name="arrow" />
                    </a>
                    {summary.visibility === "public" ? (
                      <a
                        href={`/competitions/${encodeURIComponent(summary.slug)}`}
                      >
                        Public page <Icon name="diagonal" />
                      </a>
                    ) : (
                      <span>Private competition</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
function EventWorkspace({
  token,
  user,
  event: initialEvent,
  onEdit,
}: {
  token: string;
  user: User;
  event: ManageEvent;
  onEdit: (event: ManageEvent) => void;
}) {
  const [event, setEvent] = useState(initialEvent);
  useEffect(() => setEvent(initialEvent), [initialEvent]);
  const games = (event.days ?? []).flatMap((day) => day.matches);
  const completedGames = games.filter((game) => game.has_results).length;
  const firstDate = event.days?.[0]?.date ?? null;
  const lastDate = event.days?.[event.days.length - 1]?.date ?? null;
  const canInviteOrganizers = user.roles.some((role) => role.role === "platform_admin" || (role.role === "organizer" && (role.scope_type === "global" || (role.scope_type === "event" && role.scope_id === event.id))));
  const resultsUrl = `/manage/competitions/${encodeURIComponent(event.id)}/results`;
  const entriesUrl = `/manage/competitions/${encodeURIComponent(event.id)}/entries`;
  return (
    <div className="event-studio">
      <div className="studio-toolbar">
        <a href="/manage/competitions">← Competitions</a>
        <div className="studio-toolbar-actions">
          {canInviteOrganizers && <a className="studio-add-organizer" href="#competition-organizer-access">Add organizer</a>}
          <button type="button" onClick={() => onEdit(event)}>Edit competition <Icon name="diagonal" /></button>
        </div>
      </div>
      <header className="studio-heading">
        <span className="studio-emblem" aria-hidden="true"><Icon name="trophy" /></span>
        <div><p>CODM BATTLE ROYALE <span> / {competitionTypeLabel(event.competition_type)}</span></p><h1>{event.title}</h1></div>
      </header>
      {event.description && <p className="studio-description">{event.description}</p>}
      {canInviteOrganizers && <EventOrganizerAccess token={token} event={event} canAssignExisting={user.roles.some((role) => role.role === "platform_admin")} />}
      {(event.competition_type === "scrim" || event.recurrence)
        ? <ScrimRecurrenceControls token={token} event={event} onUpdated={setEvent} />
        : <p className="studio-date"><Icon name="calendar" />{formatDateRange(firstDate, lastDate)}</p>}
      {event.skipped_at && <div className="studio-week-off" role="status"><strong>No games this week</strong><p>{event.skip_reason || "Squad entries and result entry are on hold for this week."}</p></div>}
      <div className="studio-overview-bar">
      <section className="studio-summary" aria-label="Selected weekend summary">
        <div><strong>{event.squads?.length ?? 0}<span> / {event.squad_capacity}</span></strong><span>Squad slots</span></div>
        <div><strong>{games.length}</strong><span>Games</span></div>
        <div><strong>{completedGames}<span> / {games.length}</span></strong><span>Results saved</span></div>
      </section>
      <div className="studio-actions">
        <a className="studio-action-primary" href={resultsUrl}>Enter results <Icon name="arrow" /></a>
        <a className="studio-action-secondary" href={entriesUrl}>Manage slots <Icon name="trophy" /></a>
      </div>
      </div>
      <div className="studio-columns">
        <StudioSchedule event={event} />
        <EventSquadsOverview token={token} event={event} />
      </div>
      <footer className="studio-foot">
        <div><span className="studio-scoring-icon"><Icon name="target" /></span><span><small>Scoring</small><strong>{scoringLabel(event.scoring.preset_name)}</strong></span></div>
        {event.visibility === "public" && <a href={`/competitions/${encodeURIComponent(event.slug)}`}>Public competition <Icon name="diagonal" /></a>}
      </footer>
    </div>
  );
}
function EventOrganizerAccess({ token, event, canAssignExisting }: { token: string; event: ManageEvent; canAssignExisting: boolean }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Load<ManagePerson[]>>({ status: canAssignExisting ? "loading" : "ready", data: [] });
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | number>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!canAssignExisting) {
      setPeople({ status: "ready", data: [] });
      return;
    }
    const controller = new AbortController();
    setPeople({ status: "loading" });
    api.managePeople(token, 1, query.trim(), controller.signal)
      .then((response) => setPeople({ status: "ready", data: response.data }))
      .catch((reason) => {
        if (!controller.signal.aborted) setPeople({ status: "error", message: errorMessage(reason) });
      });
    return () => controller.abort();
  }, [token, query, refresh, canAssignExisting]);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setError("");
    setNotice("");
    try {
      await api.inviteCompetitionOrganizer(token, event.id, inviteEmail.trim());
      setInviteEmail("");
      setNotice("Invitation sent. They can use the link in their email to create or confirm their account.");
    } catch (reason) {
      setError(reason instanceof ApiError ? [reason.message, ...Object.values(reason.errors).flat()].join(" ") : "Could not send the invitation.");
    } finally {
      setInviteBusy(false);
    }
  }
  async function add(person: ManagePerson) {
    setBusy(person.id);
    setError("");
    setNotice("");
    try {
      await api.assignCompetitionOrganizer(token, person.id, event.id);
      setNotice(`${person.name} can now manage this competition.`);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }
  return <section className="studio-organizer-access" id="competition-organizer-access" aria-labelledby="competition-organizer-heading">
    <header className="studio-organizer-access-head"><div><span>TEAM ACCESS</span><h2 id="competition-organizer-heading">Add an organizer</h2></div><p>Invite someone to help run this competition. Weekly scrim access continues across the series.</p></header>
    <div className="studio-organizer-access-body">
      <form onSubmit={(e) => void invite(e)}>
        <label htmlFor="competition-organizer-invite-email">Organizer’s email</label>
        <div><input id="competition-organizer-invite-email" required type="email" autoComplete="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" /><button type="submit" disabled={inviteBusy}>{inviteBusy ? "Sending…" : "Send invite"}</button></div>
      </form>
      {notice && <p className="studio-organizer-notice" role="status">{notice}</p>}
      {error && <p className="studio-organizer-error" role="alert">{error}</p>}
      {canAssignExisting && <>
        <form onSubmit={(e) => { e.preventDefault(); setRefresh((value) => value + 1); }}>
          <label htmlFor="competition-organizer-search">Or add an existing account</label>
          <div><input id="competition-organizer-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or email" /><button type="submit">Search</button></div>
        </form>
        {people.status === "loading" ? <p role="status">Loading accounts…</p> : people.status === "error" ? <p role="alert">{people.message}</p> : people.data.length ? <ul>
        {people.data.map((person) => {
          const assigned = person.roles.some((role) => role.role === "organizer" && role.scope_type === "event" && role.scope_id === event.id);
          const global = person.roles.some((role) => (role.role === "organizer" && role.scope_type === "global") || role.role === "platform_admin");
          return <li key={person.id}><span><strong>{person.name}</strong><small>{person.email}</small></span>{assigned ? <b>Added</b> : global ? <b>Already has full access</b> : <button type="button" disabled={busy === person.id} onClick={() => void add(person)}>{busy === person.id ? "Adding…" : "Add organizer"}</button>}</li>;
        })}
        </ul> : <p>No accounts found.</p>}
      </>}
    </div>
  </section>;
}
function StudioSchedule({ event }: { event: ManageEvent }) {
  const [dayId, setDayId] = useState<string | null>(null);
  const day = event.days?.find((item) => item.id === dayId) ?? event.days?.[0];
  return <section className="studio-card studio-schedule" aria-labelledby="competition-games-heading">
    <header className="studio-card-head"><div><span className="studio-section-icon" aria-hidden="true"><Icon name="calendar" /></span><h2 id="competition-games-heading">Weekend schedule</h2></div><span>{countLabel(event.days?.length ?? 0, "day")}</span></header>
    {event.days?.length ? <>
      <div className="studio-day-tabs" aria-label="Competition days">{event.days.map((item) => <button key={item.id} type="button" aria-pressed={item.id === day?.id} aria-controls="studio-day-games" onClick={() => setDayId(item.id)}><strong>{item.label || `Day ${item.sort_order}`}</strong><span>{formatDateRange(item.date, null)}</span></button>)}</div>
      <ol className="studio-game-list" id="studio-day-games" aria-label={`${day?.label || "Selected day"} games`}>
        {day?.matches.map((game) => <li key={game.id}>
          <span className="studio-game-number">{String(game.match_index).padStart(2, "0")}</span>
          <span className="studio-game-map"><strong>{game.map_label}</strong><small>Game {game.match_index}</small></span>
          <span className={`studio-game-status${game.has_results ? " is-saved" : ""}`}>{game.has_results && <Icon name="check" />}{game.has_results ? "Results saved" : "No results"}</span>
        </li>)}
        {!day?.matches.length && <li className="studio-empty">No games configured for this day.</li>}
      </ol>
      <p className="studio-schedule-note"><Icon name="calendar" />Dates in {event.timezone === "Africa/Lagos" ? "Lagos time · WAT" : event.timezone}</p>
    </> : <p className="studio-empty">No games scheduled yet. Edit the competition to add games.</p>}
  </section>;
}
function ScrimRecurrenceControls({ token, event, onUpdated }: { token: string; event: ManageEvent; onUpdated: (event: ManageEvent) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [message, setMessage] = useState("");
  const recurring = event.recurrence;
  const hasResults = (event.days ?? []).some((day) => day.matches.some((game) => game.has_results));
  async function change(action: RecurrenceAction) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await api.updateRecurrence(token, event.id, action, reason.trim() || undefined);
      onUpdated(response.data);
      setConfirmEnd(false);
      setReason("");
      setMessage(({ start: "Weekly scrims enabled.", skip: "This week is marked as not playing.", restore: "This week is playing again.", pause: "Weekly scrims paused.", resume: "Weekly scrims resumed.", end: "Weekly series ended. Saved results are still available." })[action]);
    } catch (error) {
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <section className="manage-workspace-series" aria-label="Weekly scrims">
    {!recurring ? <p className="manage-workspace-series-feedback" role="status">Weekly schedule is being prepared automatically.</p> : <>
      <div className="studio-week-context">
        <details className="studio-week-menu" onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="Choose weekend"><Icon name="calendar" /><span><small>Selected weekend</small><strong>{formatDateRange(event.days?.[0]?.date ?? null, event.days?.at(-1)?.date ?? null)}</strong></span><Icon name="chevron" /></summary>
          <nav className="studio-week-options" aria-label="Prepared scrim weekends">{recurring.weeks.map((week) => <a key={week.id} href={`/manage/competitions/${encodeURIComponent(week.id)}`} aria-current={week.id === event.id ? "page" : undefined}>{formatDateRange(week.start_date, week.end_date)}{week.skipped_at && <small>Not playing</small>}{week.id === event.id && <Icon name="check" />}</a>)}</nav>
        </details>
        <span className={`studio-series-state is-${recurring.state}`}><strong><i />{recurring.state === "active" ? "Every week" : recurring.state === "paused" ? "Paused" : "Ended"}</strong><small>{recurring.state === "ended" ? "Results retained" : recurring.state === "active" ? "Prepared Mondays" : "No end date"}</small></span>
      </div>
      {recurring.state !== "ended" && <details className="manage-workspace-series-settings"><summary>Manage weekly schedule <Icon name="chevron" /></summary><div>
        <p>Upcoming weekends are prepared every Monday. Each week has its own squad submissions, slots and results.</p>
        <label>Reason <span>Optional, visible to players</span><input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Taking a break this weekend" /></label>
        <div className="manage-workspace-series-actions">
          {recurring.state === "active" && !hasResults && <button type="button" disabled={busy} onClick={() => change(event.skipped_at ? "restore" : "skip")}>{event.skipped_at ? "Play this week" : "Skip this week"}</button>}
          <button type="button" disabled={busy} onClick={() => change(recurring.state === "paused" ? "resume" : "pause")}>{recurring.state === "paused" ? "Resume weekly scrims" : "Pause weekly scrims"}</button>
          {!confirmEnd && <button type="button" disabled={busy} onClick={() => setConfirmEnd(true)}>End series</button>}
        </div>
        {confirmEnd && <div className="manage-workspace-end-confirm"><p>End this weekly series? Future unplayed weeks will be marked off. Saved results remain available.</p><button type="button" disabled={busy} onClick={() => change("end")}>End weekly series</button><button type="button" disabled={busy} onClick={() => setConfirmEnd(false)}>Keep series</button></div>}
        {busy && <p role="status">Saving weekly schedule…</p>}
      </div></details>}
    </>}
    {message && <p className="manage-workspace-series-feedback" role="status">{message}</p>}
    {error && <p className="manage-workspace-series-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => setError("")}>Dismiss</button></p>}
  </section>;
}
function EventSquadsOverview({ token, event }: { token: string; event: ManageEvent }) {
  const [submissions, setSubmissions] = useState<Load<EventSubmissionReview>>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [activeList, setActiveList] = useState<"assigned" | "waiting">("assigned");
  useEffect(() => {
    const controller = new AbortController();
    setSubmissions({ status: "loading" });
    api.eventSubmissions(token, event.id, controller.signal)
      .then(({ data }) => setSubmissions({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted) setSubmissions({ status: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [token, event.id, retry]);
  const pending = submissions.status === "ready"
    ? submissions.data.clans.flatMap((clan) => clan.squads
      .filter((squad) => squad.status === "pending")
      .map((squad) => ({ clan, squad })))
    : [];
  const assigned = event.squads ?? [];
  const entriesUrl = `/manage/competitions/${encodeURIComponent(event.id)}/entries`;
  return (
    <section className="studio-card studio-squads" aria-labelledby="competition-squads-heading">
      <header className="studio-card-head"><div><span className="studio-section-icon" aria-hidden="true"><Icon name="trophy" /></span><h2 id="competition-squads-heading">Squads &amp; slots</h2></div><a href={entriesUrl}>Manage <Icon name="arrow" /></a></header>
      <div className="studio-squad-tabs" aria-label="Squad lists">
        <button type="button" aria-pressed={activeList === "assigned"} onClick={() => setActiveList("assigned")}>Assigned <span>{assigned.length}</span></button>
        <button type="button" aria-pressed={activeList === "waiting"} onClick={() => setActiveList("waiting")}>Waiting <span>{submissions.status === "ready" ? pending.length : "—"}</span></button>
      </div>
      <div className="studio-lineup">
        {activeList === "assigned" ? (
          assigned.length ? <ul>
            {assigned.map((squad) => <li key={squad.id}>
              <span className="studio-slot"><small>Slot</small><b>{squad.slot_number ?? "—"}</b></span>
              <strong>{squadIdentity({ name: squad.name, squadNumber: squad.squad_number, clanTag: squad.clan_tag, clanName: squad.clan, clanSquadCount: squad.clan_squad_count })}</strong>
            </li>)}
          </ul> : <p className="studio-empty">No slots assigned yet. Select squads from the submitted entries.</p>
        ) : submissions.status === "loading" ? <State>Loading submitted squads…</State>
          : submissions.status === "error" ? <State retry={() => setRetry((value) => value + 1)}>{submissions.message}</State>
          : pending.length ? <ul>
            {pending.slice(0, 6).map(({ clan, squad }) => <li key={squad.submission_id}>
              <span className="studio-clan-mark" aria-hidden="true">{clan.tag || clan.name.slice(0, 2)}</span>
              <span><strong>{squadIdentity({ name: squad.name, squadNumber: squad.squad_number, clanTag: clan.tag, clanName: clan.name, clanSquadCount: squad.clan_squad_count })}</strong><small>{squad.players.length ? squad.players.join(", ") : "No players listed"}</small></span>
            </li>)}
            {pending.length > 6 && <li><a href={entriesUrl}>View {pending.length - 6} more submitted squads <Icon name="arrow" /></a></li>}
          </ul> : <p className="studio-empty">No squads waiting for a slot.</p>}
      </div>
      <div className="studio-capacity">
        <div className="studio-capacity-note"><span><strong>{Math.max(0, event.squad_capacity - assigned.length)}</strong> slots available</span><span>{assigned.length} / {event.squad_capacity} filled</span></div>
        <progress aria-label="Assigned competition slots" value={assigned.length} max={Math.max(1, event.squad_capacity)} />
      </div>
    </section>
  );
}
function EventEntries({ token, event }: { token: string; event: ManageEvent }) {
  const [entries, setEntries] = useState<Load<EventSubmissionReview>>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    setEntries({ status: "loading" });
    api.eventSubmissions(token, event.id, controller.signal)
      .then(({ data }) => setEntries({ status: "ready", data }))
      .catch((err) => {
        if (!controller.signal.aborted) setEntries({ status: "error", message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [token, event.id, refresh]);
  async function decide(submissionId: string, decision: "select" | "not_selected" | "pending", slotNumber?: number) {
    setBusy(submissionId);
    setError("");
    setNotice("");
    try {
      const currentStatus = entries.status === "ready"
        ? entries.data.clans.flatMap((clan) => clan.squads).find((squad) => squad.submission_id === submissionId)?.status
        : undefined;
      await api.decideEventSubmission(token, event.id, submissionId, decision, slotNumber);
      setNotice(decision === "select"
        ? `${currentStatus === "selected" ? "Game-day slot updated to" : "Assigned game-day slot"} #${slotNumber}.`
        : decision === "pending" ? "Slot returned to review." : "Submission marked not selected.");
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  const content = entries.status === "ready" ? entries.data : null;
  const full = !!content && content.event.selected_count >= content.event.squad_capacity;
  function chosenSlot(submissionId: string, assignedSlot: number | null): string {
    return slotSelections[submissionId] ?? (assignedSlot === null ? "" : String(assignedSlot));
  }
  function slotIsReserved(slotNumber: number, exceptSubmissionId: string): boolean {
    if (!content) return false;
    return content.clans.some((clan) => clan.squads.some((other) => {
      if (other.submission_id === exceptSubmissionId || !["pending", "selected"].includes(other.status)) return false;
      const otherSlot = slotSelections[other.submission_id] ?? (other.slot_number === null ? "" : String(other.slot_number));
      return Number(otherSlot) === slotNumber;
    }));
  }
  return (
    <>
      <div className="manage-form-heading">
        <a className="manage-back" href={`/manage/competitions/${encodeURIComponent(event.id)}`}>← {event.title}</a>
        <p className="manage-eyebrow">SQUAD ENTRIES</p>
        <h1>{event.title}<span>.</span></h1>
        <p>Choose which submitted squads fill this competition’s slots.</p>
      </div>
      {notice && <div className="manage-success" role="status">{notice}</div>}
      {error && <div className="manage-error" role="alert">{error}</div>}
      {entries.status === "loading" && <State>Loading clan submissions…</State>}
      {entries.status === "error" && <State retry={() => setRefresh((value) => value + 1)}>{entries.message}</State>}
      {content && (
        <>
          <section className="manage-entry-capacity" aria-label="Squad slot count">
            <div><strong>{content.event.selected_count}</strong><span> of {content.event.squad_capacity} slots filled</span></div>
            <div><strong>{content.event.pending_count}</strong><span> {content.event.pending_count === 1 ? "squad" : "squads"} awaiting review</span></div>
          </section>
          {!content.clans.length ? (
            <State>No clan squads have been submitted for this competition yet.</State>
          ) : (
            <div className="manage-entry-clans">
              {content.clans.map((clan) => (
                <section className="manage-entry-clan" key={clan.id}>
                  <header><span>{clan.tag}</span><strong>{clan.name}</strong></header>
                  {clan.squads.map((squad) => (
                    <article className="manage-entry-squad" key={squad.submission_id}>
                      <div className="manage-entry-squad-main">
                        <div className="manage-entry-title"><strong>{squadIdentity({
                          name: squad.name,
                          squadNumber: squad.squad_number,
                          clanTag: clan.tag,
                          clanName: clan.name,
                          clanSquadCount: squad.clan_squad_count,
                        })}</strong><span className={`manage-entry-status is-${squad.status}`}>{submissionStatusLabel(squad.status, "organizer")}</span>{squad.status === "selected" && squad.slot_number !== null && <span className="manage-entry-slot-label">GAME SLOT #{squad.slot_number}</span>}</div>
                        <p>{squad.players.length ? squad.players.join(" · ") : "No players listed"}</p>
                      </div>
                      <div className="manage-entry-actions">
                        {(squad.status === "pending" || squad.status === "selected") && (
                          <>
                            <label className="manage-slot-picker">
                              <span className="sr-only">Game-day slot for {squadIdentity({name: squad.name, squadNumber: squad.squad_number, clanTag: clan.tag, clanName: clan.name, clanSquadCount: squad.clan_squad_count})}</span>
                              <select
                                aria-label={`Game-day slot for ${squadIdentity({name: squad.name, squadNumber: squad.squad_number, clanTag: clan.tag, clanName: clan.name, clanSquadCount: squad.clan_squad_count})}`}
                                value={chosenSlot(squad.submission_id, squad.slot_number)}
                                onChange={(change) => setSlotSelections((current) => ({ ...current, [squad.submission_id]: change.target.value }))}
                              >
                                <option value="">Choose slot</option>
                                {Array.from({ length: content.event.squad_capacity }, (_, index) => index + 1).map((slotNumber) => (
                                  <option key={slotNumber} value={slotNumber} disabled={slotIsReserved(slotNumber, squad.submission_id)}>
                                    Slot {slotNumber}{slotIsReserved(slotNumber, squad.submission_id) ? " · assigned" : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="manage-primary"
                              type="button"
                              disabled={busy === squad.submission_id || !chosenSlot(squad.submission_id, squad.slot_number) || (squad.status === "pending" && full) || (squad.status === "selected" && Number(chosenSlot(squad.submission_id, squad.slot_number)) === squad.slot_number)}
                              onClick={() => decide(squad.submission_id, "select", Number(chosenSlot(squad.submission_id, squad.slot_number)))}
                            >
                              {busy === squad.submission_id ? "Saving…" : squad.status === "pending" ? "Assign slot" : "Update slot"}
                            </button>
                          </>
                        )}
                        {squad.status === "pending" && <button type="button" disabled={busy === squad.submission_id} onClick={() => decide(squad.submission_id, "not_selected")}>Not selected</button>}
                        {squad.status === "selected" && (
                          <button type="button" disabled={busy === squad.submission_id} onClick={() => decide(squad.submission_id, "pending")}>Return to review</button>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
function EventForm({
  token,
  initial,
  onCancel,
  onSaved,
}: {
  token: string;
  initial: ManageEvent | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<
    Load<{
      presets: ScoringPreset[];
    }>
  >({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [persisted, setPersisted] = useState<ManageEvent | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [stage, setStage] = useState("");
  const initialForm = useRef<string | null>(null);
  useEffect(() => {
    if (form && initialForm.current === null)
      initialForm.current = JSON.stringify(form);
  }, [form]);
  function cancel() {
    if (
      form &&
      initialForm.current !== null &&
      JSON.stringify(form) !== initialForm.current &&
      !window.confirm("Discard unsaved changes?")
    )
      return;
    onCancel();
  }
  useEffect(() => {
    const controller = new AbortController();
    setOptions({ status: "loading" });
    Promise.all([
      api.scoringPresets(token, controller.signal).catch((e) => {
        if (e instanceof ApiError && e.status === 403)
          return api.publicScoringPresets(controller.signal);
        throw e;
      }),
    ])
      .then(([presets]) => {
        setOptions({
          status: "ready",
          data: { presets: presets.data },
        });
        setForm(
          (current) =>
            current ??
            (initial
              ? fromEvent(initial, presets.data)
              : {
                  title: "",
                  description: "",
                  competition_type: "scrim",
                  score:
                    presets.data
                      .find((p) => p.slug === "aga-balanced")
                      ?.versions.at(-1)?.id ?? "",
                    squadCapacity: 25,
                  days: standardDays(),
                }),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setOptions({ status: "error", message: errorMessage(e) });
      });
    return () => controller.abort();
  }, [token, retry]);
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }
  function changeDay(index: number, change: Partial<Day>) {
    if (form)
      update(
        "days",
        form.days.map((day, i) => (i === index ? { ...day, ...change } : day)),
      );
  }
  function changeGame(dayIndex: number, gameIndex: number, label: string) {
    if (!form) return;
    const day = form.days[dayIndex];
    changeDay(dayIndex, {
      games: day.games.map((game, i) =>
        i === gameIndex
          ? {
              ...game,
              map_label: label,
              map_code: label.toLowerCase().trim().replace(/\s+/g, "-"),
            }
          : game,
      ),
    });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || options.status !== "ready") return;
    setError("");
    setFields({});
    const dates = form.days.map((day) => day.date);
    if (new Set(dates).size !== dates.length) {
      setError("Each competition day needs a different date.");
      return;
    }
    if (form.competition_type === "scrim") {
      const sortedDates = [...dates].sort();
      const span = (Date.parse(sortedDates.at(-1)!) - Date.parse(sortedDates[0])) / 86400000;
      if (span >= 7) {
        setError("Keep each week's games within seven days when repeating weekly.");
        return;
      }
    }
    if (form.days.some((day) => !day.games.length)) {
      setError("Each competition day needs at least one game.");
      return;
    }
    if (persisted) {
      const oldGames = (persisted.days ?? []).flatMap((day) => day.matches);
      const remaining = new Set(
        form.days.flatMap((day) => day.games.map((game) => game.id)),
      );
      const removesScored = oldGames.some(
        (game) => game.has_results && !remaining.has(game.id),
      );
      if (
        removesScored &&
        !window.confirm(
          "These changes affect saved results and standings. Continue?",
        )
      )
        return;
    }
    setBusy(true);
    let current = persisted;
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        competition_type: form.competition_type || null,
        squad_capacity: form.squadCapacity,
        ...(form.score ? { scoring_rule_version_id: form.score } : {}),
      };
      if (!current) {
        setStage("Creating competition…");
        const created = await api.createEvent(token, {
          ...body,
          days: schedule(form.days.map((day) => ({ ...day, id: null, games: day.games.map((game) => ({ ...game, id: null })) }))),
        });
        current = created.data;
        setPersisted(current);
        setForm(fromEvent(current, options.data.presets));
      } else {
        setStage("Saving competition details…");
        const updated = await api.updateEvent(token, current.id, body);
        current = updated.data;
        setPersisted(current);
        const originalDays = fromEvent(current, options.data.presets).days;
        if (scheduleKey(originalDays) !== scheduleKey(form.days)) {
          setStage("Saving dates and games…");
          const updatedSchedule = await api.updateSchedule(
            token,
            current.id,
            schedule(form.days),
          );
          current = updatedSchedule.data;
          setPersisted(current);
          setForm((value) =>
            value
              ? {
                  ...value,
                  days: fromEvent(updatedSchedule.data, options.data.presets)
                    .days,
                }
              : value,
          );
        }
      }
      setStage("");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.errors);
      setError(
        `${errorMessage(err)}${current ? " Some changes may already be saved. Your form is still open; correct the issue and save again." : ""}`,
      );
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  return (
    <>
      <div className="manage-form-heading">
        <button className="manage-back" onClick={cancel} type="button">
          ← Competitions
        </button>
        <p className="manage-eyebrow">COMPETITION SETUP</p>
        <h1>
          {initial
            ? "Edit competition"
            : persisted
              ? "Finish setup"
              : "Create competition"}
          <span>.</span>
        </h1>
        <p>Set the competition. Clan captains submit their squads next.</p>
      </div>
      {options.status === "loading" && (
        <State>Loading scoring options…</State>
      )}
      {options.status === "error" && (
        <State retry={() => setRetry((n) => n + 1)}>{options.message}</State>
      )}
      {form && options.status === "ready" && (
        <form className="manage-form" onSubmit={submit}>
          {error && (
            <div className="manage-error" role="alert">
              <strong>Could not finish saving</strong>
              <p>{error}</p>
              {Object.entries(fields).map(([key, messages]) => (
                <p key={key}>{messages.join(" ")}</p>
              ))}
            </div>
          )}
          <section className="manage-panel">
            <div className="manage-panel-heading">
              <div>
                <span>01</span>
                <h2>Competition details</h2>
              </div>
              <p>Keep it simple. You can edit this later.</p>
            </div>
            <div className="manage-fields">
              <label className="manage-field manage-span">
                Competition name
                <input
                  required
                  maxLength={180}
                  value={form.title}
                  onChange={(e) => update("title", e.target.value)}
                  placeholder="e.g. Arewa weekend scrim"
                />
              </label>
              <label className="manage-field">
                Competition type
                <select
                  value={form.competition_type}
                  onChange={(e) =>
                    update("competition_type", e.target.value as Form["competition_type"])
                  }
                >
                  <option value="">Choose a type</option>
                  <option value="scrim">Scrim</option>
                  <option value="league">League</option>
                  <option value="tournament">Tournament</option>
                </select>
              </label>
              <label className="manage-field">
                Scoring preset
                <select
                  value={form.score}
                  onChange={(e) => update("score", e.target.value)}
                >
                  <option value="">
                    {initial
                      ? `Keep current: ${initial.scoring.preset_name ?? "scoring"}`
                      : "Use default scoring"}
                  </option>
                  {options.data.presets.flatMap((preset) =>
                    [...preset.versions]
                      .sort((a, b) => b.version_number - a.version_number)
                      .map((version) => (
                        <option key={version.id} value={version.id}>
                          {preset.name}
                          {preset.versions.length > 1
                            ? ` · version ${version.version_number}`
                            : ""}
                        </option>
                      )),
                  )}
                </select>
              </label>
              <label className="manage-field manage-span">
                Description <span>Optional</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="Add details players should know"
                />
              </label>
            </div>
            {form.competition_type === "scrim" && <p className="manage-weekly-default-note">Scrims continue every week automatically until you pause or end the series. Squad entries, slots and results are separate for each week.</p>}
            <details className="manage-advanced">
              <summary>How scoring works</summary>
              <div>
                {options.data.presets.map((preset) => (
                  <p key={preset.id}>
                    <strong>{preset.name}</strong> {preset.description}
                  </p>
                ))}
              </div>
              <p>
                Changing the scoring preset recalculates saved games. Games with
                custom scoring keep their own rules.
              </p>
            </details>
          </section>
          <section className="manage-panel">
            <div className="manage-panel-heading">
              <div>
                <span>02</span>
                <h2>Days &amp; games</h2>
              </div>
              <p>
                Games are created automatically. Adjust dates and maps below.
              </p>
            </div>
            <div className="manage-days">
              {form.days.map((day, index) => (
                <div className="manage-day" key={day.id ?? `new-${index}`}>
                  <div className="manage-day-head">
                    <strong>DAY {index + 1}</strong>
                    {form.days.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            "days",
                            form.days.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Remove day
                      </button>
                    )}
                  </div>
                  <div className="manage-day-fields">
                    <label className="manage-field">
                      Day name
                      <input
                        required
                        maxLength={80}
                        value={day.label}
                        onChange={(e) =>
                          changeDay(index, { label: e.target.value })
                        }
                      />
                    </label>
                    <label className="manage-field">
                      Date
                      <input
                        required
                        type="date"
                        value={day.date}
                        onChange={(e) =>
                          changeDay(index, { date: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="manage-games">
                    {day.games.map((game, gi) => (
                      <div className="manage-game" key={game.id ?? `new-${gi}`}>
                        <span>{String(gi + 1).padStart(2, "0")}</span>
                        <label>
                          <span className="sr-only">
                            Day {index + 1} game {gi + 1} map
                          </span>
                          <input
                            list="manage-map-options"
                            required
                            maxLength={80}
                            value={game.map_label}
                            onChange={(e) =>
                              changeGame(index, gi, e.target.value)
                            }
                          />
                        </label>
                        {game.has_results && <small>Results saved</small>}
                        <button
                          type="button"
                          aria-label={`Remove day ${index + 1} game ${gi + 1}`}
                          disabled={day.games.length === 1}
                          onClick={() =>
                            changeDay(index, {
                              games: day.games.filter((_, i) => i !== gi),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="manage-add"
                    disabled={day.games.length >= 20}
                    onClick={() =>
                      changeDay(index, {
                        games: [
                          ...day.games,
                          {
                            id: null,
                            map_code: "isolated",
                            map_label: "Isolated",
                            has_results: false,
                          },
                        ],
                      })
                    }
                  >
                    + Add game
                  </button>
                </div>
              ))}
            </div>
            <datalist id="manage-map-options">
              <option value="Isolated" />
              <option value="Blackout" />
            </datalist>
            <button
              type="button"
              className="manage-add manage-add-day"
              disabled={form.days.length >= 14}
              onClick={() =>
                update("days", [
                  ...form.days,
                  {
                    id: null,
                    date: "",
                    label: `Day ${form.days.length + 1}`,
                    games: [
                      {
                        id: null,
                        map_code: "isolated",
                        map_label: "Isolated",
                        has_results: false,
                      },
                    ],
                  },
                ])
              }
            >
              + Add competition day
            </button>
          </section>
          <section className="manage-panel">
            <div className="manage-panel-heading">
              <div>
                <span>03</span>
                <h2>Squad slots</h2>
              </div>
              <p>Captains submit each clan squad. You assign the available slots.</p>
            </div>
            <div className="manage-capacity-setting">
              <label className="manage-field">
                Maximum participating squads
                <input
                  type="number"
                  min={1}
                max={25}
                  required
                  value={form.squadCapacity}
                  onChange={(event) => update("squadCapacity", Number(event.target.value))}
                />
                <span>Standard CODM BR supports 100 players: 25 four-player squads. Set fewer slots when needed.</span>
              </label>
              <div><strong>{form.squadCapacity}</strong><span> competition slots</span></div>
            </div>
          </section>
          <div className="manage-save">
            <div>
              <strong>
                {initial ? "Ready to update?" : "Ready to create?"}
              </strong>
              <span>
                {countLabel(form.days.length, "day")} ·{" "}
                {countLabel(
                  form.days.reduce((n, d) => n + d.games.length, 0),
                  "game",
                )}{" "}
                · {form.squadCapacity} squad slots
              </span>
            </div>
            <div>
              <button
                type="button"
                className="manage-secondary"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="manage-primary" disabled={busy}>
                {busy ? stage : "Save competition"} <Icon name="arrow" />
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
