import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type {
  ManageClan,
  ManagePlayer,
  ManagePerson,
  PublicClan,
  PublicPlayer,
  RosterMember,
  CaptainSquadSubmissions,
} from "./api/types";
import {
  canManageCompetitions,
  canManageAnyClan,
  Shell,
  SignIn,
  type Session,
} from "./CompetitionManager";
import { Icon } from "./ui";
import { playerHandle } from "./playerDisplay";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { ClanPlayerPool, ClanRoster } from "./ClanPlayers";
import { formatDateRange, squadIdentity, submissionStatusLabel } from "./presentation";
import "./directory-manager.css";
import "./directory-compact.css";

type Squad = ManageClan["squads"][number];
type View =
  | { kind: "list" }
  | { kind: "clan"; clan: PublicClan | null }
  | { kind: "squad"; clan: ManageClan }
  | { kind: "roster"; clan: ManageClan; squad: Squad }
  | { kind: "captains"; clan: ManageClan }
  | { kind: "player"; player: ManagePlayer | null };
type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const message = (error: unknown) =>
  error instanceof ApiError
    ? [error.message, ...Object.values(error.errors).flat()]
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" ")
    : "Something went wrong. Please try again.";
async function allClans(token: string, signal: AbortSignal) {
  const first = await api.manageClans(token, 1, signal);
  const pages = [first.data];
  for (let p = 2; p <= first.meta.last_page; p += 4)
    pages.push(
      ...(
        await Promise.all(
          Array.from(
            { length: Math.min(4, first.meta.last_page - p + 1) },
            (_, i) => api.manageClans(token, p + i, signal),
          ),
        )
      ).map((x) => x.data),
    );
  return pages.flat();
}
function Notice({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="manage-notice" role="status">
      {text}
      {retry && <button onClick={retry}>Try again →</button>}
    </div>
  );
}
function SquadPlayers({ token, squadId }: { token: string; squadId: string }) {
  const [roster, setRoster] = useState<Load<RosterMember[]>>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRoster({ status: "loading" });
    api.roster(token, squadId, controller.signal)
      .then(({ data }) => setRoster({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted) setRoster({ status: "error", message: message(error) });
      });
    return () => controller.abort();
  }, [token, squadId, retry]);
  return (
    <div className="directory-inline-roster" aria-label="Squad players">
      {roster.status === "loading" ? (
        <p className="directory-roster-empty">Loading roster…</p>
      ) : roster.status === "error" ? (
        <div className="directory-roster-state">
          <span>Players didn’t load.</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </div>
      ) : roster.data.length ? (
        <ul className="directory-player-chips" aria-label="Players in this squad">
          {roster.data.map((player) => (
            <li className="directory-player-chip" key={player.membership_id}>
              <span className="directory-player-chip-name">{player.ign}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="directory-roster-empty">No players added to this squad yet.</p>
      )}
    </div>
  );
}
function ClanSlots({ token, clan }: { token: string; clan: ManageClan }) {
  const [load, setLoad] = useState<Load<number[]>>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(clan.squads.map((entry) => api.squadEventSubmissions(token, entry.id, controller.signal)))
      .then((responses) => {
        const numbers = responses.flatMap(({ data }) => data.opportunities.filter((event) => event.permanent && event.status === "selected" && event.slot_number !== null).map((event) => event.slot_number!));
        setLoad({ status: "ready", data: [...new Set(numbers)].sort((a, b) => a - b) });
      }).catch((error) => { if (!controller.signal.aborted) setLoad({ status: "error", message: message(error) }); });
    return () => controller.abort();
  }, [token, clan.id]);
  return <div className="manage-notice" role="status">{load.status === "loading" ? "Loading your slots…" : load.status === "error" ? `Couldn’t load slots: ${load.message}` : load.data.length ? `Your assigned slots: ${load.data.join(", ")}` : "No assigned slots found for the current scrims."}</div>;
}
function ClanCard({ clan, token, initiallyOpen, canEditCaptains, canSubmit, busy, onEdit, onCaptains }: {
  clan: ManageClan; token: string; initiallyOpen: boolean; canEditCaptains: boolean; canSubmit: boolean; busy: boolean;
  onEdit: () => void; onCaptains: () => void; onAddSquad: () => void; onRoster: (squad: Squad) => void;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const bodyId = `clan-${clan.id}-body`;
  return <article className="directory-compact-clan"><div className="directory-compact-head"><button type="button" className="directory-clan-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(!expanded)}><span className="directory-clan-avatar" aria-hidden="true">{Array.from(clan.tag || clan.name).slice(0, 3).join("")}</span><span className="directory-clan-label"><strong>{clan.name}</strong><span>{clan.tags?.length ? clan.tags.join(" · ") : (clan.tag || "No tag")}</span></span><Icon name="chevron" className={expanded ? "is-expanded" : ""} /></button></div>
    {expanded && <div id={bodyId} className="directory-clan-body"><div className="directory-clan-toolbar"><strong className="directory-section-label">Clan players</strong><div className="directory-clan-tools"><a className="directory-monthly-report" href={`/manage/clans/${encodeURIComponent(clan.id)}/reports`}>Monthly report <Icon name="arrow" /></a>{canEditCaptains && <button type="button" onClick={onCaptains}>Team captains</button>}<button type="button" disabled={busy} onClick={onEdit}>Edit clan</button></div></div>{canSubmit && <ClanSlots token={token} clan={clan} />}<ClanPlayerPool token={token} clan={clan} /></div>}
  </article>;
}
function nextSquadName(clan: ManageClan): string {
  const highest = clan.squads.reduce((max, squad) => {
    const number = squad.squad_number ?? Number(/^squad\s+(\d+)$/i.exec(squad.name)?.[1] ?? 0);
    return Math.max(max, number);
  }, 0);
  return `Squad ${Math.max(clan.squads.length, highest) + 1}`;
}
function SquadSubmissions({ token, squadId, onManageRoster }: { token: string; squadId: string; onManageRoster: () => void }) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  const [data, setData] = useState<Load<CaptainSquadSubmissions>>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || inView) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, [inView]);
  useEffect(() => {
    if (!inView) return;
    const controller = new AbortController();
    setData({ status: "loading" });
    api.squadEventSubmissions(token, squadId, controller.signal)
      .then(({ data: response }) => setData({ status: "ready", data: response }))
      .catch((err) => {
        if (!controller.signal.aborted) setData({ status: "error", message: message(err) });
      });
    return () => controller.abort();
  }, [inView, token, squadId, refresh]);

  async function submit(eventId: string) {
    setBusy(eventId);
    setError("");
    setNotice("");
    try {
      await api.submitSquadForEvent(token, squadId, eventId);
      setNotice("Slot request sent. An organizer can assign this squad.");
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }

  async function withdraw(submissionId: string, eventId: string) {
    setBusy(eventId);
    setError("");
    setNotice("");
    try {
      await api.withdrawSquadSubmission(token, squadId, submissionId);
      setNotice("Submission withdrawn.");
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  const weeklyEvents = data.status === "ready"
    ? data.data.opportunities.filter((event) => event.competition_type === "scrim")
    : [];
  const otherEvents = data.status === "ready"
    ? data.data.opportunities.filter((event) => event.competition_type !== "scrim")
    : [];

  return (
    <section ref={sectionRef} className="directory-submissions" aria-label="Weekly scrim and competition squad submissions">
      <div className="directory-submissions-heading">
        <div>
          <strong>Your scrim slot</strong>
        </div>
        <span className="directory-weekly-cadence">Assigned slots carry forward every week</span>
      </div>
      {notice && <p className="directory-submission-notice" role="status">{notice}</p>}
      {error && <p className="directory-submission-error" role="alert">{error}</p>}
      {!inView || data.status === "loading" ? <p>Loading this week’s scrim…</p> : data.status === "error" ? (
        <div className="directory-submission-state">
          <span>{data.message}</span>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button>
        </div>
      ) : (
        <>
          {weeklyEvents.length ? weeklyEvents.map((event) => {
            const canSubmit = event.can_submit && (event.status === null || event.status === "not_selected" || event.status === "withdrawn");
            return (
              <article className="directory-weekly-entry" key={event.id}>
                <div className="directory-weekly-event">
                  <a className="directory-event-link" href={`/competitions/${encodeURIComponent(event.slug)}`}>{event.title}</a>
                  <strong>{formatDateRange(event.start_date, event.end_date)}</strong>
                  <span>{event.squad_count} of {event.squad_capacity} slots filled</span>
                </div>
                <div className="directory-weekly-actions">
                  {event.status === "selected" ? (
                    <span className="directory-submission-status">{event.slot_number ? `${event.permanent ? "Permanent slot" : "Slot"} ${event.slot_number}` : "Slot assigned"}</span>
                  ) : event.status === "pending" ? (
                    <>
                      <span className="directory-submission-status">Waiting for organizer to assign a slot</span>
                      {event.can_submit && event.submission_id && <button type="button" className="directory-secondary-action" disabled={busy === event.id} onClick={() => withdraw(event.submission_id!, event.id)}>{busy === event.id ? "…" : "Withdraw"}</button>}
                    </>
                  ) : canSubmit ? (
                    <button type="button" className="directory-primary-action" disabled={busy === event.id} onClick={() => submit(event.id)}>{busy === event.id ? "Sending…" : "Request a slot"}</button>
                  ) : <span className="directory-submission-status">Contact an organizer for a slot</span>}
                  <button type="button" className="directory-lineup-action" onClick={onManageRoster}>Update Saturday / Sunday players</button>
                </div>
                <p className="directory-weekly-help">Your squad keeps its assigned slot. Update its players whenever needed.</p>
              </article>
            );
          }) : <div className="directory-no-weekly"><strong>No upcoming weekly scrim is scheduled yet.</strong><span>Once the next weekend is prepared, it will appear here. Assigned slots carry forward automatically.</span></div>}
          {otherEvents.length > 0 && (
            <details className="directory-other-competitions">
              <summary>Other competitions <span>{otherEvents.length}</span></summary>
              {otherEvents.map((event) => {
                const canSubmit = event.can_submit && (event.status === null || event.status === "not_selected" || event.status === "withdrawn");
                return <div className="directory-opportunity" key={event.id}>
                  <div><strong><a className="directory-event-link" href={`/competitions/${encodeURIComponent(event.slug)}`}>{event.title}</a></strong><span>{formatDateRange(event.start_date, event.end_date)} · {submissionStatusLabel(event.status, "captain")}</span></div>
                  {event.status === "pending" && event.submission_id && event.can_submit ? <button type="button" disabled={busy === event.id} onClick={() => withdraw(event.submission_id!, event.id)}>{busy === event.id ? "…" : "Withdraw"}</button> : canSubmit ? <button type="button" disabled={busy === event.id} onClick={() => submit(event.id)}>{busy === event.id ? "Submitting…" : "Submit"}</button> : event.status === "selected" ? <span className="directory-submission-status">Slot confirmed</span> : <span className="directory-submission-status">Entries closed</span>}
                </div>;
              })}
            </details>
          )}
          {data.data.submissions.some((submission) => !data.data.opportunities.some((event) => event.id === submission.event.id)) && (
            <details className="directory-past-submissions">
              <summary>Previous entries</summary>
              {data.data.submissions.filter((submission) => !data.data.opportunities.some((event) => event.id === submission.event.id)).map((submission) => (
                <div key={submission.id}><span>{submission.event.title}</span><small>{submissionStatusLabel(submission.status, "captain")}</small></div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
export default function DirectoryManager() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState<View>({ kind: "list" });
  const [focusedClanId, setFocusedClanId] = useState("");
  const [tab, setTab] = useState<"clans" | "players">("clans");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clans, setClans] = useState<Load<ManageClan[]>>({ status: "loading" });
  const [players, setPlayers] = useState<
    Load<{ data: PublicPlayer[]; last: number }>
  >({ status: "loading" });
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setChecking(false);
      return;
    }
    const c = new AbortController();
    api
      .me(token, c.signal)
      .then(({ data }) => setSession({ token, user: data }))
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && e.status === 401)
            clearStoredToken();
          setAuthError(message(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setChecking(false);
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const c = new AbortController();
    setClans({ status: "loading" });
    allClans(session.token, c.signal)
      .then((data) => setClans({ status: "ready", data }))
      .catch((e) => {
        if (!c.signal.aborted)
          setClans({ status: "error", message: message(e) });
      });
    return () => c.abort();
  }, [session?.token, refresh]);
  useEffect(() => {
    if (!session || tab !== "players") return;
    const c = new AbortController();
    setPlayers({ status: "loading" });
    api
      .players(page, search, c.signal)
      .then((res) =>
        setPlayers({
          status: "ready",
          data: { data: res.data, last: res.meta.last_page },
        }),
      )
      .catch((e) => {
        if (!c.signal.aborted)
          setPlayers({ status: "error", message: message(e) });
      });
    return () => c.abort();
  }, [session?.token, tab, page, search, refresh]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible" && view.kind === "list") setRefresh((value) => value + 1); };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => document.removeEventListener("visibilitychange", refreshVisible);
  }, [view.kind]);
  async function logout() {
    if (session)
      try {
        await disableAdminPush(session.token).catch(() => {});
        await api.logout(session.token);
      } catch {
        /* Clear local session even if offline. */
      }
    clearStoredToken();
    setSession(null);
    setView({ kind: "list" });
  }
  const global = canManageCompetitions(session?.user);
  const teamCaptainAccess = canManageAnyClan(session?.user);
  const captainOnly = !!session && !teamCaptainAccess && session.user.roles.some(
    (role) => role.role === "clan_captain",
  );
  useEffect(() => {
    if (captainOnly) setTab("clans");
  }, [captainOnly]);
  async function openClan(clan: ManageClan) {
    setError("");
    setBusy(true);
    try {
      const { data } = await api.clan(clan.slug);
      setView({ kind: "clan", clan: data });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function openPlayer(player: PublicPlayer) {
    if (!session) return;
    setError("");
    setBusy(true);
    try {
      const { data } = await api.managePlayer(session.token, player.id);
      setView({ kind: "player", player: data });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function complete(text: string) {
    setSuccess(text);
    setError("");
    setView({ kind: "list" });
    setRefresh((x) => x + 1);
  }
  const visibleClans = clans.status === "ready" ? clans.data.filter((clan) =>
    `${clan.name} ${clan.tag ?? ""} ${(clan.tags ?? []).join(" ")} ${clan.squads.map((squad) => `${squad.name} ${squad.tag ?? ""}`).join(" ")}`
      .toLowerCase().includes(search.toLowerCase()),
  ) : [];
  return (
    <Shell section="directory" session={session} onLogout={logout}>
      {checking ? (
        <Notice text="Checking your session…" />
      ) : !session ? (
        <>
          <SignIn onSuccess={setSession} />
          {authError && <Notice text={authError} />}
        </>
      ) : view.kind === "captains" ? (
        <Captains
          token={session.token}
          clan={view.clan}
          onBack={() => setView({ kind: "list" })}
        />
      ) : view.kind !== "list" ? (
        <Editor
          key={`${view.kind}-${view.kind === "clan" ? (view.clan?.id ?? "new") : view.kind === "player" ? (view.player?.id ?? "new") : "new"}`}
          token={session.token}
          view={view}
          global={global}
          clanChoices={clans.status === "ready" ? clans.data : []}
          onBack={() => setView({ kind: "list" })}
          onSaved={complete}
        />
      ) : (
        <>
          <div className="manage-page-heading directory-page-heading">
            <div>
              <p className="manage-eyebrow">
                {captainOnly ? "CLAN CAPTAIN WORKSPACE" : "ORGANIZER WORKSPACE"}
              </p>
              <h1>
                {captainOnly ? "My clan & players" : "Clans & players"}<span>.</span>
              </h1>
              <p>
                {captainOnly
                  ? "Manage your clan and its players."
                  : "Manage the community and its players."}
              </p>
            </div>
            {global && (
              <button
                className="manage-primary"
                onClick={() => {
                  setSuccess("");
                  setView(
                    tab === "clans"
                      ? { kind: "clan", clan: null }
                      : { kind: "player", player: null },
                  );
                }}
              >
                <Icon name="plus" />
                {tab === "clans" ? "Create clan" : "Register player"}
              </button>
            )}
          </div>
          <div className="directory-controls">
          {global && <div className="directory-tabs" aria-label="Directory section">
            <button
              aria-pressed={tab === "clans"}
              onClick={() => {
                setTab("clans");
                setQuery("");
                setSearch("");
                setPage(1);
              }}
            >
              Clans
            </button>
            {global && (
              <button
                aria-pressed={tab === "players"}
                onClick={() => {
                  setTab("players");
                  setQuery("");
                  setSearch("");
                  setPage(1);
                }}
              >
                Players
              </button>
            )}
          </div>}
          <form
            className="directory-search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
              setPage(1);
            }}
          >
            <label>
              <span className="sr-only">Search {tab}</span>
              <input
                placeholder={tab === "clans" ? "Find a clan…" : "Search players…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
              />
            </label>
            <button type="submit">Search</button>
          </form>
          </div>
          {success && (
            <div className="manage-success" role="status">
              {success}
            </div>
          )}
          {error && (
            <div className="manage-error" role="alert">
              {error} <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {tab === "clans" ? (
            <>
              {clans.status === "loading" ? (
                <Notice text="Loading clans…" />
              ) : clans.status === "error" ? (
                <Notice
                  text={clans.message}
                  retry={() => setRefresh((x) => x + 1)}
                />
              ) : (
                <div className="directory-clans directory-compact">
                  <div className="directory-compact-summary"><span>{visibleClans.length} {visibleClans.length === 1 ? "clan" : "clans"}</span></div>
                  {visibleClans.map((clan) => (
                      <ClanCard
                        key={`${clan.id}-${search}`}
                        clan={clan}
                        token={session.token}
                        initiallyOpen={captainOnly || clans.data.length === 1 || focusedClanId === clan.id || search.length > 0}
                        canEditCaptains={teamCaptainAccess}
                        canSubmit={session.user.roles.some((role) => role.role === "clan_captain" && role.scope_id === clan.id)}
                        busy={busy}
                        onEdit={() => { setFocusedClanId(clan.id); openClan(clan); }}
                        onCaptains={() => { setFocusedClanId(clan.id); setView({ kind: "captains", clan }); }}
                        onAddSquad={() => { setFocusedClanId(clan.id); setView({ kind: "squad", clan }); }}
                        onRoster={(squad) => { setFocusedClanId(clan.id); setView({ kind: "roster", clan, squad }); }}
                      />
                    ))}
                  {!visibleClans.length && <Notice text="No clans found." />}
                </div>
              )}
            </>
          ) : (
            <>
              {players.status === "loading" ? (
                <Notice text="Loading players…" />
              ) : players.status === "error" ? (
                <Notice
                  text={players.message}
                  retry={() => setRefresh((x) => x + 1)}
                />
              ) : (
                <>
                  <div className="directory-player-list">
                    {players.data.data.map((player) => (
                      <div className="directory-player-row" key={player.id}>
                        <span className="directory-mark">
                          {player.current_ign.slice(0, 2).toUpperCase()}
                        </span>
                        <strong>
                          {playerHandle(player.current_ign, player.clan_tag)}
                        </strong>
                        <a href={`/players/${encodeURIComponent(player.id)}`}>
                          View
                        </a>
                        {global && (
                          <button
                            disabled={busy}
                            onClick={() => openPlayer(player)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    ))}
                    {!players.data.data.length && (
                      <Notice text="No players found." />
                    )}
                  </div>
                  {players.data.last > 1 && (
                    <div className="directory-pager">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage((x) => x - 1)}
                      >
                        ← Previous
                      </button>
                      <span>
                        Page {page} of {players.data.last}
                      </span>
                      <button
                        disabled={page >= players.data.last}
                        onClick={() => setPage((x) => x + 1)}
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
function Editor({
  token,
  view,
  global,
  clanChoices,
  onBack,
  onSaved,
}: {
  token: string;
  view: Exclude<View, { kind: "list" } | { kind: "captains" }>;
  global: boolean;
  clanChoices: ManageClan[];
  onBack: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(
    view.kind === "clan"
      ? (view.clan?.name ?? "")
      : view.kind === "squad"
        ? nextSquadName(view.clan)
        : view.kind === "player"
          ? (view.player?.current_ign ?? "")
          : "",
  );
  const [tags, setTags] = useState(
    view.kind === "clan"
      ? (view.clan?.tags?.length ? view.clan.tags : view.clan?.tag ? [view.clan.tag] : []).join(", ")
      : "",
  );
  const [bio, setBio] = useState(
    view.kind === "clan" ? (view.clan?.bio ?? "") : "",
  );
  const [uid, setUid] = useState(
    view.kind === "player" ? (view.player?.uid ?? "") : "",
  );
  const [playerClanId, setPlayerClanId] = useState(view.kind === "player" ? view.player?.clan_id ?? "" : "");
  const [uidPublic, setUidPublic] = useState(
    view.kind === "player" ? (view.player?.uid_public ?? false) : false,
  );
  const playerClanTags =
    view.kind === "player"
      ? (clanChoices.find((clan) => clan.id === playerClanId)?.tags ?? [])
      : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (view.kind === "clan") {
        const body = {
          name: name.trim(),
          tags: [...new Set(tags.split(/[,;]+/).map((tag) => tag.trim().toUpperCase()).filter(Boolean))],
          bio: bio.trim() || null,
        };
        if (view.clan) await api.updateClan(token, view.clan.id, body);
        else await api.createClan(token, body);
        onSaved(view.clan ? "Clan updated." : "Clan created.");
      } else if (view.kind === "squad") {
        await api.createSquad(token, view.clan.id, {});
        onSaved("Numbered squad created.");
      } else if (view.kind === "player") {
        const body = {
          current_ign: name.trim(),
          clan_id: playerClanId || null,
          uid: uid.trim() || null,
          uid_public: uidPublic,
        };
        if (view.player) await api.updatePlayer(token, view.player.id, body);
        else await api.createPlayer(token, body);
        onSaved(view.player ? "Player updated." : "Player registered.");
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  if (view.kind === "roster")
    return (
      <ClanRoster
        token={token}
        clan={view.clan}
        squad={view.squad}
        onBack={onBack}
      />
    );
  const title =
    view.kind === "clan"
      ? view.clan
        ? "Edit clan"
        : "Create clan"
      : view.kind === "squad"
        ? "Add squad"
        : view.player
          ? "Edit player"
          : "Register player";
  return (
    <>
      <button type="button" className="manage-back" onClick={onBack}>
        ← Clans &amp; players
      </button>
      <div className="manage-form-heading">
        <p className="manage-eyebrow">
          {view.kind === "squad" ? view.clan.name : "COMMUNITY DIRECTORY"}
        </p>
        <h1>
          {title}
          <span>.</span>
        </h1>
        <p>
          {view.kind === "player"
            ? "Use an existing player when adding someone to a squad."
            : "Keep details clear for players and organizers."}
        </p>
      </div>
      <form className="manage-panel directory-editor" onSubmit={save}>
        {error && (
          <div role="alert" className="manage-error">
            {error}
          </div>
        )}
        <label className="manage-field">
          {view.kind === "squad"
            ? "Automatically assigned squad name"
            : view.kind === "player"
              ? "Player IGN"
              : "Clan name"}
          {view.kind === "player" && !!playerClanTags.length && (
            <span className="clan-player-tag-fixed" aria-label="Clan tag">
              {playerClanTags.join(" · ")}
            </span>
          )}
          <input
            autoFocus={view.kind !== "squad"}
            required={view.kind !== "squad"}
            readOnly={view.kind === "squad"}
            maxLength={view.kind === "player" ? 100 : 120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {view.kind === "squad" && <span>
            Numbered automatically and cannot be renamed. It will appear as {squadIdentity({
              name,
              squadNumber: Number(/^Squad\s+(\d+)$/i.exec(name)?.[1] ?? 0),
              clanTag: view.clan.tag ?? "",
              clanName: view.clan.name,
              clanSquadCount: view.clan.squads.length + 1,
            })}.
          </span>}
        </label>
        {view.kind === "clan" && (
          <label className="manage-field">
            Clan tags <span>Optional · separate multiple tags with commas</span>
            <input
              maxLength={200}
              placeholder="e.g. NE, NElite"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <span>
              These are matched against player names. The first tag is used as
              the main clan tag.
            </span>
          </label>
        )}
        {view.kind === "clan" && (
          <label className="manage-field">
            Clan bio <span>Optional</span>
            <textarea
              maxLength={2000}
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </label>
        )}
        {view.kind === "player" && global && (
          <>
            <label className="manage-field">Clan<select value={playerClanId} onChange={(event) => setPlayerClanId(event.target.value)}><option value="">No clan yet</option>{clanChoices.map((clan) => <option key={clan.id} value={clan.id}>{clan.name}</option>)}</select><span>Players with a clan appear in that clan’s player pool.</span></label>
            <label className="manage-field">
              CODM UID <span>Optional · private by default</span>
              <input
                maxLength={64}
                value={uid}
                onChange={(e) => setUid(e.target.value)}
              />
            </label>
            <label className="directory-check">
              <input
                type="checkbox"
                checked={uidPublic}
                onChange={(e) => setUidPublic(e.target.checked)}
              />{" "}
              Show UID on public profile
            </label>
          </>
        )}
        <div className="directory-actions">
          <button
            type="button"
            className="manage-secondary"
            onClick={onBack}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="manage-primary" disabled={busy}>
            {busy ? "Saving…" : view.kind === "squad" ? "Create squad" : "Save changes"} <Icon name="arrow" />
          </button>
        </div>
      </form>
    </>
  );
}
async function allPeople(token: string, signal: AbortSignal, clanId: string, search = "") {
  const first = await api.managePeople(token, 1, search, signal, clanId);
  const pages = [first.data];
  for (let p = 2; p <= first.meta.last_page; p += 4)
    pages.push(
      ...(
        await Promise.all(
          Array.from(
            { length: Math.min(4, first.meta.last_page - p + 1) },
            (_, i) => api.managePeople(token, p + i, search, signal, clanId),
          ),
        )
      ).map((result) => result.data),
    );
  return pages.flat();
}
function Captains({
  token,
  clan,
  onBack,
}: {
  token: string;
  clan: ManageClan;
  onBack: () => void;
}) {
  const [people, setPeople] = useState<Load<ManagePerson[]>>({
    status: "loading",
  });
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Load<ManagePerson[]> | null>(null);
  const [busy, setBusy] = useState<string | number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    setError("");
    setSuccess("");
    try {
      await api.inviteCaptain(token, clan.id, inviteEmail.trim());
      setSuccess("Invitation sent.");
      setInviteEmail("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setPeople({ status: "loading" });
    allPeople(token, controller.signal, clan.id)
      .then((data) => setPeople({ status: "ready", data }))
      .catch((err) => {
        if (!controller.signal.aborted)
          setPeople({ status: "error", message: message(err) });
      });
    return () => controller.abort();
  }, [token, refresh, clan.id]);
  useEffect(() => {
    if (!search) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    setResults({ status: "loading" });
    allPeople(token, controller.signal, clan.id, search)
      .then((data) => setResults({ status: "ready", data }))
      .catch((err) => {
        if (!controller.signal.aborted) setResults({ status: "error", message: message(err) });
      });
    return () => controller.abort();
  }, [token, refresh, clan.id, search]);
  const assigned = (person: ManagePerson) =>
    person.roles.find(
      (role) =>
        role.role === "clan_captain" &&
        role.scope_type === "clan" &&
        role.scope_id === clan.id,
    );
  const isTeamCaptain = (person: ManagePerson) =>
    person.roles.some((role) => role.role === "organizer" || role.role === "platform_admin");
  async function change(person: ManagePerson) {
    const role = assigned(person);
    if (
      role &&
      !window.confirm(`Remove ${person.name} as a captain of ${clan.name}?`)
    )
      return;
    setBusy(person.id);
    setError("");
    setSuccess("");
    try {
      if (role) await api.revokeCaptain(token, person.id, role.id);
      else await api.assignCaptain(token, person.id, clan.id);
      setSuccess(role ? "Captain removed." : "Captain added.");
      setRefresh((x) => x + 1);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }
  const captains =
    people.status === "ready"
      ? people.data.filter((person) => assigned(person) || isTeamCaptain(person))
      : [];
  function row(person: ManagePerson) {
    const role = assigned(person);
    const teamCaptain = isTeamCaptain(person);
    return (
      <div className="directory-person" key={person.id}>
        <div>
          <strong>{person.name}</strong>
          <small>{person.email}</small>
        </div>
        {teamCaptain ? (
          <span className="directory-team-captain">Team captain</span>
        ) : (
          <button disabled={busy !== null} onClick={() => change(person)}>
            {busy === person.id ? "Saving…" : role ? "Remove" : "+ Add"}
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <button className="manage-back" onClick={onBack}>
        ← Clans &amp; players
      </button>
      <div className="manage-form-heading">
        <p className="manage-eyebrow">{clan.name}</p>
        <h1>
          Team captains<span>.</span>
        </h1>
        <p>
          Team captains can manage every clan. Clan captains manage this clan and
          its players.
        </p>
      </div>
      {success && (
        <div className="manage-success" role="status">
          {success}
        </div>
      )}
      {error && (
        <div className="manage-error" role="alert">
          {error}
        </div>
      )}
      <section className="manage-panel">
        <div className="manage-panel-heading">
          <div>
            <h2>Current captains</h2>
          </div>
        </div>
        {people.status === "loading" ? (
          <Notice text="Loading captains…" />
        ) : people.status === "error" ? (
          <Notice
            text={people.message}
            retry={() => setRefresh((x) => x + 1)}
          />
        ) : captains.length ? (
          <div className="directory-player-list">{captains.map(row)}</div>
        ) : (
          <Notice text="No captains assigned." />
        )}
      </section>
      <section className="manage-panel directory-find">
        <div className="manage-panel-heading">
          <div>
            <h2>Invite a clan captain</h2>
          </div>
          <p>
            Send an invitation to their email. They can set up their account and
            manage this clan.
          </p>
        </div>
        <form className="directory-search" onSubmit={invite}>
          <label>
            <span className="sr-only">Captain email</span>
            <input
              type="email"
              required
              maxLength={255}
              placeholder="Captain email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </label>
          <button disabled={busy !== null}>
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
        </form>
      </section>
      <section className="manage-panel directory-find">
        <div className="manage-panel-heading">
          <div>
            <h2>Add a clan captain</h2>
          </div>
          <p>Find an existing account by name or email.</p>
        </div>
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
        >
          <label>
            <span className="sr-only">Search accounts</span>
            <input
              required
              minLength={2}
              maxLength={100}
              placeholder="Search name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button>Search</button>
        </form>
        {search && results?.status === "loading" && (
          <Notice text="Searching accounts…" />
        )}
        {search && results?.status === "error" && <Notice text={results.message} />}
        {search &&
          results?.status === "ready" &&
          (results.data.length ? (
            <div className="directory-player-list">{results.data.map(row)}</div>
          ) : (
            <Notice text="No accounts found." />
          ))}
      </section>
    </>
  );
}
