import { useEffect, useState } from "react";
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
  Shell,
  SignIn,
  tokenKey,
  type Session,
} from "./CompetitionManager";
import { Icon } from "./ui";
import { disableAdminPush } from "./AdminAlerts";
import { formatDate, squadIdentity, submissionStatusLabel } from "./presentation";
import "./directory-manager.css";

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
    <div className="directory-squad-players">
      {roster.status === "loading" ? "Loading players…" : roster.status === "error" ? (
        <><span>Players didn’t load.</span> <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></>
      ) : roster.data.length ? roster.data.map((player) => player.ign).join(", ") : "No players yet"}
    </div>
  );
}
function nextSquadName(clan: ManageClan): string {
  const highest = clan.squads.reduce((max, squad) => {
    const number = squad.squad_number ?? Number(/^squad\s+(\d+)$/i.exec(squad.name)?.[1] ?? 0);
    return Math.max(max, number);
  }, 0);
  return `Squad ${Math.max(clan.squads.length, highest) + 1}`;
}
function SquadSubmissions({ token, squadId }: { token: string; squadId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Load<CaptainSquadSubmissions>>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData({ status: "loading" });
    api.squadEventSubmissions(token, squadId, controller.signal)
      .then(({ data: response }) => setData({ status: "ready", data: response }))
      .catch((err) => {
        if (!controller.signal.aborted) setData({ status: "error", message: message(err) });
      });
    return () => controller.abort();
  }, [open, token, squadId, refresh]);

  async function submit(eventId: string) {
    setBusy(eventId);
    setError("");
    setNotice("");
    try {
      await api.submitSquadForEvent(token, squadId, eventId);
      setNotice("Squad submitted. The organizer can now assign a slot.");
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

  if (!open)
    return (
      <button className="directory-submit-toggle" type="button" onClick={() => setOpen(true)}>
        Submit to competition
      </button>
    );

  return (
    <section className="directory-submissions" aria-label="Competition squad submissions">
      <div className="directory-submissions-heading">
        <strong>Competition entries</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close competition entries">×</button>
      </div>
      <p className="directory-submission-help">Submitted squads wait for the organizer to assign a slot. Only selected squads appear on the public competition page.</p>
      {notice && <p className="directory-submission-notice" role="status">{notice}</p>}
      {error && <p className="directory-submission-error" role="alert">{error}</p>}
      {data.status === "loading" ? <p>Loading upcoming competitions…</p> : data.status === "error" ? (
        <div className="directory-submission-state">
          <span>{data.message}</span>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button>
        </div>
      ) : (
        <>
          {data.data.opportunities.length ? data.data.opportunities.map((event) => {
            const canSubmit = event.status === null || event.status === "not_selected" || event.status === "withdrawn";
            const statusLabel = submissionStatusLabel(event.status, "captain");
            return (
              <div className="directory-opportunity" key={event.id}>
                <div>
                  <strong><a className="directory-event-link" href={`/competitions/${encodeURIComponent(event.slug)}`}>{event.title}</a></strong>
                  <span>{formatDate(event.start_date)} · {event.squad_count} of {event.squad_capacity} slots filled · {statusLabel}</span>
                </div>
                {event.status === "pending" && event.submission_id ? (
                  <button type="button" disabled={busy === event.id} onClick={() => withdraw(event.submission_id!, event.id)}>{busy === event.id ? "…" : "Withdraw"}</button>
                ) : canSubmit ? (
                  <button type="button" disabled={busy === event.id} onClick={() => submit(event.id)}>{busy === event.id ? "Sending…" : event.status ? "Submit again" : "Submit"}</button>
                ) : <span className="directory-submission-status">Slot confirmed</span>}
              </div>
            );
          }) : <p>No upcoming competitions are open for squad entries.</p>}
          {data.data.submissions.some((submission) => !data.data.opportunities.some((event) => event.id === submission.event.id)) && (
            <div className="directory-past-submissions">
              <strong>Previous entries</strong>
              {data.data.submissions.filter((submission) => !data.data.opportunities.some((event) => event.id === submission.event.id)).map((submission) => (
                <div key={submission.id}><span>{submission.event.title}</span><small>{submissionStatusLabel(submission.status, "captain")}</small></div>
              ))}
            </div>
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
    const token = sessionStorage.getItem(tokenKey);
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
            sessionStorage.removeItem(tokenKey);
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
  async function logout() {
    if (session)
      try {
        await disableAdminPush(session.token).catch(() => {});
        await api.logout(session.token);
      } catch {
        /* Clear local session even if offline. */
      }
    sessionStorage.removeItem(tokenKey);
    setSession(null);
    setView({ kind: "list" });
  }
  const global = canManageCompetitions(session?.user);
  const captainOnly = !!session && !global && session.user.roles.some(
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
          onBack={() => setView({ kind: "list" })}
          onSaved={complete}
        />
      ) : (
        <>
          <div className="manage-page-heading">
            <div>
              <p className="manage-eyebrow">
                {captainOnly ? "CLAN CAPTAIN WORKSPACE" : "ORGANIZER WORKSPACE"}
              </p>
              <h1>
                {captainOnly ? "My clan & squads" : "Clans & players"}<span>.</span>
              </h1>
              <p>
                {captainOnly
                  ? "Manage your clan, squads and players."
                  : "Manage the community, squads and players."}
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
          <div className="directory-tabs" aria-label="Directory section">
            <button
              aria-pressed={tab === "clans"}
              onClick={() => {
                setTab("clans");
                setQuery("");
                setSearch("");
                setPage(1);
              }}
            >
              Clans &amp; squads
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
          </div>
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
                placeholder={`Search ${tab}`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
              />
            </label>
            <button type="submit">Search</button>
          </form>
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
                <div className="directory-clans">
                  {clans.data
                    .filter((clan) =>
                      `${clan.name} ${clan.tag}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((clan) => (
                      <article className="directory-clan" key={clan.id}>
                        <div className="directory-clan-head">
                          <div>
                            <p className="manage-eyebrow">
                              {clan.tag || "Clan"}
                            </p>
                            <h2>{clan.name}</h2>
                            <span>
                              {clan.squads.length}{" "}
                              {clan.squads.length === 1 ? "squad" : "squads"}
                            </span>
                          </div>
                          <div className="directory-clan-actions">
                            {session.user.roles.some(
                              (role) => role.role === "platform_admin",
                            ) && (
                              <button
                                onClick={() =>
                                  setView({ kind: "captains", clan })
                                }
                              >
                                Captains
                              </button>
                            )}
                            <button
                              disabled={busy}
                              onClick={() => openClan(clan)}
                            >
                              Edit clan
                            </button>
                          </div>
                        </div>
                        <div className="directory-squads">
                          {clan.squads.map((squad) => (
                            <div className="directory-squad" key={squad.id}>
                              <div>
                                <strong className="directory-squad-name">
                                  {squadIdentity({
                                    name: squad.name,
                                    squadNumber: squad.squad_number,
                                    clanTag: clan.tag,
                                    clanName: clan.name,
                                    clanSquadCount: clan.squad_count ?? clan.squads.length,
                                  })}
                                </strong>
                                <SquadPlayers token={session.token} squadId={squad.id} />
                              </div>
                              <button
                                onClick={() =>
                                  setView({ kind: "roster", clan, squad })
                                }
                              >
                                Roster
                              </button>
                              {session.user.roles.some((role) => role.role === "clan_captain" && role.scope_id === clan.id) && (
                                <div className="directory-squad-entries">
                                  <SquadSubmissions token={session.token} squadId={squad.id} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <button
                          className="directory-add"
                          onClick={() =>
                              setView({ kind: "squad", clan })
                          }
                        >
                          + Add squad
                        </button>
                      </article>
                    ))}
                  {!clans.data.filter((clan) =>
                    `${clan.name} ${clan.tag}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  ).length && <Notice text="No clans found." />}
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
                        <strong>{player.current_ign}</strong>
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
  onBack,
  onSaved,
}: {
  token: string;
  view: Exclude<View, { kind: "list" } | { kind: "captains" }>;
  global: boolean;
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
  const [tag, setTag] = useState(
    view.kind === "clan"
      ? (view.clan?.tag ?? "")
      : "",
  );
  const [bio, setBio] = useState(
    view.kind === "clan" ? (view.clan?.bio ?? "") : "",
  );
  const [uid, setUid] = useState(
    view.kind === "player" ? (view.player?.uid ?? "") : "",
  );
  const [uidPublic, setUidPublic] = useState(
    view.kind === "player" ? (view.player?.uid_public ?? false) : false,
  );
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
          tag: tag.trim(),
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
      <Roster
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
              clanTag: view.clan.tag,
              clanName: view.clan.name,
              clanSquadCount: view.clan.squads.length + 1,
            })}.
          </span>}
        </label>
        {view.kind === "clan" && (
          <label className="manage-field">
            Clan tag
            <input
              required={view.kind === "clan"}
              maxLength={16}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
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
function Roster({
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
  const [roster, setRoster] = useState<Load<RosterMember[]>>({
    status: "loading",
  });
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [players, setPlayers] = useState<Load<{
    data: PublicPlayer[];
    last: number;
  }> | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newUid, setNewUid] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setRoster({ status: "loading" });
    api
      .roster(token, squad.id, c.signal)
      .then(({ data }) => setRoster({ status: "ready", data }))
      .catch((e) => {
        if (!c.signal.aborted)
          setRoster({ status: "error", message: message(e) });
      });
    return () => c.abort();
  }, [token, squad.id, refresh]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!search) {
      setPlayers(null);
      return;
    }
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
  }, [search, page, searchRetry]);
  async function add(player: PublicPlayer) {
    setBusy(player.id);
    setError("");
    setSuccess("");
    try {
      await api.addRosterPlayer(token, squad.id, player.id);
      setRefresh((x) => x + 1);
      setSuccess(`${player.current_ign} added to this squad.`);
      setQuery("");
      setSearch("");
      setNewUid("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function addTyped(e: React.FormEvent) {
    e.preventDefault();
    const ign = query.trim();
    if (
      !ign ||
      roster.status !== "ready" ||
      players?.status !== "ready" ||
      search !== ign
    )
      return;
    setBusy("resolve");
    setError("");
    setSuccess("");
    try {
      // IGN is not unique. Check every search page before creating a player.
      const first = await api.players(1, ign);
      const pages = [first.data];
      for (let index = 2; index <= first.meta.last_page; index += 4) {
        const batch = await Promise.all(
          Array.from(
            { length: Math.min(4, first.meta.last_page - index + 1) },
            (_, offset) => api.players(index + offset, ign),
          ),
        );
        pages.push(...batch.map((result) => result.data));
      }
      const exact = pages
        .flat()
        .filter(
          (player) =>
            player.current_ign.toLocaleLowerCase() === ign.toLocaleLowerCase(),
        );
      if (exact.length > 1) {
        setError(
          "More than one player has this IGN. Select the correct player from the results.",
        );
      } else if (exact.length === 1) {
        if (roster.data.some((member) => member.player_id === exact[0].id))
          setError(`${exact[0].current_ign} is already in this squad.`);
        else await add(exact[0]);
      } else {
        await api.addNewRosterPlayer(
          token,
          squad.id,
          ign,
          newUid.trim() || null,
        );
        setRefresh((value) => value + 1);
        setSuccess(`${ign} created and added to this squad.`);
        setQuery("");
        setSearch("");
        setNewUid("");
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function remove(member: RosterMember) {
    if (
      !window.confirm(
        `Remove ${member.ign} from this squad? Previous match results remain unchanged.`,
      )
    )
      return;
    setBusy(member.player_id);
    setError("");
    setSuccess("");
    try {
      await api.removeRosterPlayer(token, squad.id, member.player_id);
      setRefresh((x) => x + 1);
      setSuccess(`${member.ign} removed from this squad.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <button className="manage-back" onClick={onBack}>
        ← Clans &amp; players
      </button>
      <div className="manage-form-heading">
        <p className="manage-eyebrow">{clan.name}</p>
        <h1>
          {squadIdentity({
            name: squad.name,
            squadNumber: squad.squad_number,
            clanTag: clan.tag,
            clanName: clan.name,
            clanSquadCount: clan.squad_count ?? clan.squads.length,
          })}
          <span>.</span>
        </h1>
        <p>
          Players listed here can be selected when you enter results. Past
          results stay unchanged.
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
            <h2>Players in this squad</h2>
          </div>
          <p>Removing a player does not remove their past results.</p>
        </div>
        {roster.status === "loading" ? (
          <Notice text="Loading players…" />
        ) : roster.status === "error" ? (
          <Notice
            text={roster.message}
            retry={() => setRefresh((x) => x + 1)}
          />
        ) : roster.data.length ? (
          <div className="directory-player-list">
            {roster.data.map((member) => (
              <div className="directory-player-row" key={member.membership_id}>
                <span className="directory-mark">
                  {member.ign.slice(0, 2).toUpperCase()}
                </span>
                <strong>{member.ign}</strong>
                <a href={`/players/${encodeURIComponent(member.player_id)}`}>
                  View
                </a>
                <button disabled={!!busy} onClick={() => remove(member)}>
                  {busy === member.player_id ? "Removing…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Notice text="No players have been added to this squad yet." />
        )}
      </section>
      <section className="manage-panel directory-find">
        <div className="manage-panel-heading">
          <div>
            <h2>Add a player</h2>
          </div>
          <p>Search by IGN, then add the right player (or create a new profile).</p>
        </div>
        <form className="directory-search" onSubmit={addTyped}>
          <label>
            <span className="sr-only">Player IGN</span>
            <input
              placeholder="Type player IGN"
              required
              value={query}
              maxLength={100}
              autoComplete="off"
              disabled={!!busy}
              onChange={(e) => {
                setQuery(e.target.value);
                setError("");
                setSuccess("");
              }}
            />
          </label>
          <button
            disabled={
              !!busy ||
              roster.status !== "ready" ||
              !query.trim() ||
              search !== query.trim() ||
              players?.status !== "ready"
            }
          >
            {busy === "resolve" ? "Adding…" : "Add player"}
          </button>
        </form>
        {query.trim() &&
          (search !== query.trim() || players?.status === "loading") && (
            <Notice text="Searching players…" />
          )}
        {search === query.trim() && players?.status === "error" && (
          <Notice
            text={players.message}
            retry={() => setSearchRetry((value) => value + 1)}
          />
        )}
        {search === query.trim() && !!search && players?.status === "ready" && (
          <>
            <div className="directory-player-list">
              {players.data.data.map((player) => {
                const member =
                  roster.status === "ready" &&
                  roster.data.some((r) => r.player_id === player.id);
                return (
                  <div className="directory-player-row" key={player.id}>
                    <strong>{player.current_ign}</strong>
                    <a href={`/players/${encodeURIComponent(player.id)}`}>
                      View
                    </a>
                    <button
                      type="button"
                      disabled={!!busy || roster.status !== "ready" || member}
                      onClick={() => add(player)}
                    >
                      {member
                        ? "In squad"
                        : busy === player.id
                          ? "Adding…"
                          : "+ Add"}
                    </button>
                  </div>
                );
              })}
              {!players.data.data.length && (
                <Notice text="No matching players. Add player to create a new profile." />
              )}
            </div>
            {!!players.data.data.length && (
              <p>No exact match? Add player creates a new player profile.</p>
            )}
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
        <details className="manage-advanced">
          <summary>CODM UID (optional)</summary>
          <p>Used only when creating a player. The UID is private.</p>
          <label className="manage-field">
            CODM UID
            <input
              maxLength={64}
              value={newUid}
              disabled={!!busy}
              onChange={(e) => setNewUid(e.target.value)}
            />
          </label>
        </details>
      </section>
    </>
  );
}
async function allPeople(token: string, signal: AbortSignal) {
  const first = await api.managePeople(token, 1, "", signal);
  const pages = [first.data];
  for (let p = 2; p <= first.meta.last_page; p += 4)
    pages.push(
      ...(
        await Promise.all(
          Array.from(
            { length: Math.min(4, first.meta.last_page - p + 1) },
            (_, i) => api.managePeople(token, p + i, "", signal),
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
    allPeople(token, controller.signal)
      .then((data) => setPeople({ status: "ready", data }))
      .catch((err) => {
        if (!controller.signal.aborted)
          setPeople({ status: "error", message: message(err) });
      });
    return () => controller.abort();
  }, [token, refresh]);
  const assigned = (person: ManagePerson) =>
    person.roles.find(
      (role) =>
        role.role === "clan_captain" &&
        role.scope_type === "clan" &&
        role.scope_id === clan.id,
    );
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
    people.status === "ready" ? people.data.filter(assigned) : [];
  const results =
    people.status === "ready" && search
      ? people.data.filter((p) =>
          `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase()),
        )
      : [];
  function row(person: ManagePerson) {
    const role = assigned(person);
    return (
      <div className="directory-person" key={person.id}>
        <div>
          <strong>{person.name}</strong>
          <small>{person.email}</small>
        </div>
        <button disabled={busy !== null} onClick={() => change(person)}>
          {busy === person.id ? "Saving…" : role ? "Remove" : "+ Add"}
        </button>
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
          Clan captains<span>.</span>
        </h1>
        <p>Captains can manage this clan and its squads.</p>
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
            <h2>Invite a captain</h2>
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
            <h2>Add a captain</h2>
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
              maxLength={100}
              placeholder="Search name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button>Search</button>
        </form>
        {search &&
          people.status === "ready" &&
          (results.length ? (
            <div className="directory-player-list">{results.map(row)}</div>
          ) : (
            <Notice text="No accounts found." />
          ))}
      </section>
    </>
  );
}
