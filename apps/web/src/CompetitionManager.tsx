import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type {
  ManageEvent,
  ManageEventSummary,
  PublicClan,
  ScheduleInput,
  ScoringPreset,
  User,
} from "./api/types";
import { Brand, Icon } from "./ui";
import AdminAlerts, { disableAdminPush } from "./AdminAlerts";
import "./competition-manager.css";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
export type Session = { token: string; user: User };
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
  squads: string[];
  days: Day[];
};
export const tokenKey = "arewavanta-organizer-token";
const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
const dateText = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`))
    : "Date not set";
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
    squads: (event.squads ?? []).map((s) => s.id),
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
const squadKey = (ids: string[]) => [...ids].sort().join(",");
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
}: {
  children: React.ReactNode;
  session: Session | null;
  onLogout: () => void;
  section?: "competitions" | "directory";
}) {
  return (
    <div className="manage-page">
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
            {session && (
              <button type="button" onClick={onLogout}>
                Sign out
              </button>
            )}
            <a href="/">
              View site <Icon name="diagonal" />
            </a>
          </div>
        </div>
      </header>
      <div className="manage-bar">
        <div className="manage-wrap">
          <span>ORGANIZER</span>
          <nav className="manage-nav" aria-label="Organizer navigation">
            <a
              href="/manage/competitions"
              aria-current={section === "competitions" ? "page" : undefined}
            >
              Competitions
            </a>
            <a
              href="/manage/directory"
              aria-current={section === "directory" ? "page" : undefined}
            >
              Clans &amp; players
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
      sessionStorage.setItem(tokenKey, data.token);
      onSuccess(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="manage-login">
      <p className="manage-eyebrow">ORGANIZER ACCESS</p>
      <h1>
        Sign in<span>.</span>
      </h1>
      <p>Manage your ArewaVanta competitions.</p>
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
async function getClans(signal: AbortSignal): Promise<PublicClan[]> {
  const first = await api.clans(1, "", signal);
  const pages = [first.data];
  for (let p = 2; p <= first.meta.last_page; p += 4)
    pages.push(
      ...(
        await Promise.all(
          Array.from(
            { length: Math.min(4, first.meta.last_page - p + 1) },
            (_, i) => api.clans(p + i, "", signal),
          ),
        )
      ).map((result) => result.data),
    );
  return pages.flat();
}
export default function CompetitionManager() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [entries, setEntries] = useState<Load<Entry[]>>({ status: "loading" });
  const [view, setView] = useState<
    { kind: "list" } | { kind: "form"; event: ManageEvent | null }
  >({ kind: "list" });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const token = sessionStorage.getItem(tokenKey);
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
            sessionStorage.removeItem(tokenKey);
          setNotice(errorMessage(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
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
    sessionStorage.removeItem(tokenKey);
    setSession(null);
    setView({ kind: "list" });
    setNotice("");
  }
  const canCreate = !!session?.user.roles.some(
    (role) =>
      role.role === "platform_admin" ||
      (role.role === "organizer" && role.scope_type === "global"),
  );
  return (
    <Shell session={session} onLogout={logout}>
      {checking ? (
        <State>Checking your session…</State>
      ) : !session ? (
        <>
          <SignIn onSuccess={setSession} />
          {notice && <State>{notice}</State>}
        </>
      ) : view.kind === "form" ? (
        <EventForm
          token={session.token}
          initial={view.event}
          onCancel={() => setView({ kind: "list" })}
          onSaved={() => {
            setNotice("Competition saved.");
            setView({ kind: "list" });
            setRefresh((n) => n + 1);
          }}
        />
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
              {entries.data.map(({ summary, detail }) => (
                <article className="manage-event" key={summary.id}>
                  <div className="manage-event-main">
                    <div className="manage-event-top">
                      <span className="manage-event-type">
                        {detail?.competition_type ??
                          summary.season?.name ??
                          "COMPETITION"}
                      </span>
                      <span className="manage-event-status">
                        {summary.scored_match_count} / {summary.match_count}{" "}
                        games scored
                      </span>
                    </div>
                    <h2>{summary.title}</h2>
                    <p className="manage-date">
                      <Icon name="calendar" /> {dateText(summary.start_date)}
                      {detail?.days?.length &&
                      detail.days[detail.days.length - 1].date !==
                        summary.start_date
                        ? ` – ${dateText(detail.days[detail.days.length - 1].date)}`
                        : ""}
                    </p>
                    <div className="manage-meta">
                      <span>
                        <strong>{summary.match_count}</strong> games
                      </span>
                      <span>
                        <strong>
                          {detail ? (detail.squads?.length ?? 0) : "—"}
                        </strong>{" "}
                        squads
                      </span>
                      <span>
                        {detail?.scoring.preset_name ?? "Scoring unavailable"}
                      </span>
                    </div>
                    {!detail && (
                      <small className="manage-detail-error">
                        Details unavailable. Retry to edit this competition.
                      </small>
                    )}
                  </div>
                  <div className="manage-event-actions">
                    <button
                      onClick={() =>
                        detail &&
                        (setNotice(""),
                        setView({ kind: "form", event: detail }))
                      }
                      disabled={!detail}
                    >
                      Edit competition <Icon name="arrow" />
                    </button>
                    {summary.visibility === "public" ? (
                      <a
                        href={`/competitions/${encodeURIComponent(summary.slug)}`}
                      >
                        View results <Icon name="diagonal" />
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
      clans: PublicClan[];
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
      getClans(controller.signal),
      api.scoringPresets(token, controller.signal).catch((e) => {
        if (e instanceof ApiError && e.status === 403)
          return api.publicScoringPresets(controller.signal);
        throw e;
      }),
    ])
      .then(([clans, presets]) => {
        setOptions({
          status: "ready",
          data: { clans, presets: presets.data },
        });
        setForm(
          (current) =>
            current ??
            (initial
              ? fromEvent(initial, presets.data)
              : {
                  title: "",
                  description: "",
                  competition_type: "",
                  score:
                    presets.data
                      .find((p) => p.slug === "aga-balanced")
                      ?.versions.at(-1)?.id ?? "",
                  squads: clans.flatMap((clan) => clan.squads.map((s) => s.id)),
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
      const removesSquads =
        (persisted.squads ?? []).some((s) => !form.squads.includes(s.id)) &&
        oldGames.some((game) => game.has_results);
      if (
        (removesScored || removesSquads) &&
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
        ...(form.score ? { scoring_rule_version_id: form.score } : {}),
      };
      if (!current) {
        setStage("Creating competition…");
        const defaults = weekend();
        const datesForTemplate =
          form.days.length >= 2
            ? [form.days[0].date, form.days[1].date]
            : defaults;
        const created = await api.createEvent(token, {
          ...body,
          dates: datesForTemplate,
          squad_ids: form.squads,
        });
        current = created.data;
        setPersisted(current);
        const generated = current.days ?? [];
        const mapped = form.days.map((day, di) => ({
          ...day,
          id: generated[di]?.id ?? null,
          games: day.games.map((game, gi) => ({
            ...game,
            id: generated[di]?.matches[gi]?.id ?? null,
          })),
        }));
        setForm({ ...form, days: mapped });
        setStage("Saving schedule…");
        const updated = await api.updateSchedule(
          token,
          current.id,
          schedule(mapped),
        );
        current = updated.data;
        setPersisted(current);
        setForm((value) =>
          value
            ? {
                ...value,
                days: fromEvent(updated.data, options.data.presets).days,
              }
            : value,
        );
      } else {
        setStage("Saving competition details…");
        const updated = await api.updateEvent(token, current.id, body);
        current = updated.data;
        setPersisted(current);
        const originalDays = fromEvent(current, options.data.presets).days;
        if (scheduleKey(originalDays) !== scheduleKey(form.days)) {
          setStage("Saving schedule…");
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
        if (
          squadKey((current.squads ?? []).map((s) => s.id)) !==
          squadKey(form.squads)
        ) {
          setStage("Saving squads…");
          const updatedSquads = await api.setEventSquads(
            token,
            current.id,
            form.squads,
          );
          current = updatedSquads.data;
          setPersisted(current);
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
        <p>Set the basics, choose your squads, and save.</p>
      </div>
      {options.status === "loading" && (
        <State>Loading squads and scoring options…</State>
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
                    update(
                      "competition_type",
                      e.target.value as Form["competition_type"],
                    )
                  }
                >
                  <option value="">Not specified</option>
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
                            ? ` · v${version.version_number}`
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
            <details className="manage-advanced">
              <summary>About scoring presets</summary>
              <div>
                {options.data.presets.map((preset) => (
                  <p key={preset.id}>
                    <strong>{preset.name}</strong> {preset.description}
                  </p>
                ))}
              </div>
              <p>
                Changing the event preset recalculates its saved games. Games
                with their own scoring rules keep their overrides.
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
                      Day label
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
                <h2>Participating squads</h2>
              </div>
              <p>
                {form.squads.length} selected · Choose squads already registered
                on ArewaVanta.
              </p>
            </div>
            {options.data.clans.some((clan) => clan.squads.length) ? (
              <div className="manage-squad-list">
                {options.data.clans
                  .filter((clan) => clan.squads.length)
                  .map((clan) => (
                    <div className="manage-clan" key={clan.id}>
                      <strong>{clan.name}</strong>
                      {clan.squads.map((squad) => (
                        <label key={squad.id}>
                          <input
                            type="checkbox"
                            checked={form.squads.includes(squad.id)}
                            onChange={(e) =>
                              update(
                                "squads",
                                e.target.checked
                                  ? [...form.squads, squad.id]
                                  : form.squads.filter((id) => id !== squad.id),
                              )
                            }
                          />
                          <span>{squad.name}</span>
                          {squad.tag && <small>{squad.tag}</small>}
                        </label>
                      ))}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="manage-empty">
                No registered squads yet. You can add squads later.
              </div>
            )}
          </section>
          <div className="manage-save">
            <div>
              <strong>
                {initial ? "Ready to update?" : "Ready to create?"}
              </strong>
              <span>
                {form.days.length} days ·{" "}
                {form.days.reduce((n, d) => n + d.games.length, 0)} games ·{" "}
                {form.squads.length} squads
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
