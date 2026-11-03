import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type {
  ManageEvent,
  ResultSheet,
  ScreenshotImportTeam,
} from "./api/types";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { formatDate } from "./presentation";
import { matchesPlayerSearch } from "./playerSearch";
import { ScorePlayers } from "./ScorePlayers";
import { ScoreLateEntry } from "./ScoreLateEntry";
import { ScreenshotImport } from "./ScreenshotImport";
import { mergeImport, type ApplyImportResult } from "./screenshotReview";
import {
  hasKills,
  incomplete,
  knownKills,
  pointsPreview,
  sameRow,
  scoreInput,
  sheetRows,
  sheetWithResult,
  totalKills,
  validateRow,
  type Candidate,
  type ScoreRow,
  type ScoreRows,
} from "./scoreEntry";
import "./results-manager.css";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
const errorText = (e: unknown) =>
  e instanceof ApiError
    ? [...new Set([e.message, ...Object.values(e.errors).flat()])]
        .slice(0, 3)
        .join(" ")
    : "Could not save. Check your connection and try again.";
export default function ResultManager({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [event, setEvent] = useState<Load<ManageEvent>>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [game, setGame] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("match"),
  );
  const [dirty, setDirty] = useState(false);
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
          if (e instanceof ApiError && e.status === 401) clearStoredToken();
          setAuthError(errorText(e));
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
    setEvent({ status: "loading" });
    api
      .manageEvent(session.token, eventId, c.signal)
      .then(({ data }) => setEvent({ status: "ready", data }))
      .catch((e) => {
        if (!c.signal.aborted)
          setEvent({ status: "error", message: errorText(e) });
      });
    return () => c.abort();
  }, [session?.token, eventId, retry]);
  function chooseGame(id: string) {
    if (game === id) return;
    if (
      dirty &&
      !window.confirm(
        "Switch games? Your unsaved draft will remain on this device.",
      )
    )
      return;
    setDirty(false);
    setGame(id);
    const url = new URL(location.href);
    url.searchParams.set("match", id);
    history.replaceState(null, "", url);
  }
  async function logout() {
    if (
      dirty &&
      !window.confirm(
        "Sign out? Unsaved results will remain as a draft on this device for your account.",
      )
    )
      return;
    if (session) {
      await disableAdminPush(session.token).catch(() => {});
      await api.logout(session.token).catch(() => {});
    }
    clearStoredToken();
    setSession(null);
  }
  const validGame =
    event.status === "ready" &&
    (event.data.days ?? []).some((d) => d.matches.some((m) => m.id === game));
  return (
    <Shell session={session} onLogout={logout}>
      {checking ? (
        <p className="manage-notice">Checking your session…</p>
      ) : !session ? (
        <>
          <SignIn onSuccess={setSession} />
          {authError && <p className="manage-error">{authError}</p>}
        </>
      ) : event.status === "loading" ? (
        <p className="manage-notice">Loading competition…</p>
      ) : event.status === "error" ? (
        <p className="manage-error">
          {event.message}{" "}
          <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </p>
      ) : (
        <div className="score-workspace" data-unsaved={dirty ? "true" : undefined}>
          <a
            className="score-back"
            href={`/manage/competitions/${encodeURIComponent(eventId)}`}
          >
            ← {event.data.title}
          </a>
          <header className="score-page-heading">
            <div>
              <p className="score-eyebrow">MATCH DESK</p>
              <h1>
                Enter results<span>.</span>
              </h1>
              <p>Record what you know. Finish or correct any game anytime.</p>
            </div>
          </header>
          <label className="score-game-select">
            Game
            <select
              value={validGame ? game! : ""}
              onChange={(e) => chooseGame(e.target.value)}
            >
              <option value="" disabled>
                Choose a game
              </option>
              {(event.data.days ?? []).map((day) => (
                <optgroup
                  key={day.id}
                  label={`${day.label || "Match day"} · ${formatDate(day.date)}`}
                >
                  {day.matches.map((m) => (
                    <option key={m.id} value={m.id}>
                      Game {m.match_index} · {m.map_label}
                      {m.has_results ? " · Saved" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {game && !validGame ? (
            <p className="score-error">Choose a game from this competition.</p>
          ) : game ? (
            <ScoreWorkspace
              key={`${session.user.id}:${game}`}
              session={session}
              matchId={game}
              onDirty={setDirty}
            />
          ) : (
            <p className="score-empty">
              Choose a game to start. Previous weeks stay editable.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

type Draft = {
  version: 1;
  rows: ScoreRows;
  base: ScoreRows;
  lockVersion: number | null;
  scoringVersion: string | null;
};
function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<Draft>;
  const validRows = (rows: unknown) =>
    !!rows &&
    typeof rows === "object" &&
    Object.values(rows).every(
      (r) =>
        r &&
        ["present", "absent", "unentered"].includes(r.status) &&
        typeof r.placement === "string" &&
        typeof r.teamKills === "string" &&
        Array.isArray(r.players) &&
        r.players.every(
          (p: Candidate & { kills: string }) =>
            typeof p.id === "string" &&
            typeof p.ign === "string" &&
            typeof p.kills === "string",
        ),
    );
  return (
    d.version === 1 &&
    validRows(d.rows) &&
    validRows(d.base) &&
    (d.lockVersion === null || typeof d.lockVersion === "number") &&
    (d.scoringVersion === null || typeof d.scoringVersion === "string")
  );
}
function ScoreWorkspace({
  session,
  matchId,
  onDirty,
}: {
  session: Session;
  matchId: string;
  onDirty: (dirty: boolean) => void;
}) {
  const [sheet, setSheet] = useState<Load<ResultSheet>>({ status: "loading" });
  const [rows, setRows] = useState<ScoreRows>({});
  const [base, setBase] = useState<ScoreRows>({});
  const [lockVersion, setLockVersion] = useState<number | null>(null);
  const [scoringVersion, setScoringVersion] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [late, setLate] = useState(false);
  const [lateSlot, setLateSlot] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [draftProblem, setDraftProblem] = useState(false);
  const draftKey = `arewavanta-score-draft:v1:${session.user.id}:${matchId}`;
  const dirtyIds = Object.keys(rows).filter(
    (id) => !sameRow(rows[id], base[id]),
  );
  const dirty = dirtyIds.length > 0;
  const initialized = sheet.status === "ready";
  const localDraft = useRef<Draft | null>(null);
  const suppressDraft = useRef(false);
  const versionOf = (data: ResultSheet) =>
    typeof data.match.scoring.version_id === "string"
      ? data.match.scoring.version_id
      : null;
  useEffect(() => {
    const c = new AbortController();
    setSheet({ status: "loading" });
    suppressDraft.current = false;
    api
      .resultSheet(session.token, matchId, c.signal)
      .then(({ data }) => {
        const original = sheetRows(data);
        let next = original;
        let version = data.result?.lock_version ?? null;
        let scoring = versionOf(data);
        let restored = false;
        try {
          const raw = localStorage.getItem(draftKey);
          const draft: unknown = raw ? JSON.parse(raw) : null;
          if (validDraft(draft)) {
            const changed = Object.keys(draft.rows).filter(
              (id) => original[id] && !sameRow(draft.rows[id], draft.base[id]),
            );
            if (changed.length) {
              next = {
                ...original,
                ...Object.fromEntries(
                  changed.map((id) => [id, draft.rows[id]]),
                ),
              };
              version = draft.lockVersion;
              scoring = draft.scoringVersion;
              restored = true;
            }
          }
        } catch {
          setDraftProblem(true);
        }
        setBase(original);
        setRows(next);
        setLockVersion(version);
        setScoringVersion(scoring);
        setSheet({ status: "ready", data });
        setOpen(null);
        setError("");
        setConflict(false);
        if (restored)
          setNotice(
            "Restored your unsaved draft from this device. Save to publish it. Newer server edits are checked before saving.",
          );
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setSheet({ status: "error", message: errorText(e) });
      });
    return () => c.abort();
  }, [session.token, matchId, draftKey, retry]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!initialized) return;
    localDraft.current = {
      version: 1,
      rows,
      base,
      lockVersion,
      scoringVersion,
    };
    const persist = () => {
      if (suppressDraft.current) return;
      try {
        if (dirty)
          localStorage.setItem(draftKey, JSON.stringify(localDraft.current));
        else localStorage.removeItem(draftKey);
      } catch {
        setDraftProblem(true);
      }
    };
    persist();
    const warn = (e: BeforeUnloadEvent) => {
      persist();
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", warn);
    };
  }, [initialized, rows, base, lockVersion, scoringVersion, draftKey, dirty]);
  useEffect(() => {
    const refresh = () => { if (!dirty && document.visibilityState === "visible") setRetry((value) => value + 1); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("pageshow", refresh); };
  }, [dirty]);
  function update(id: string, change: (row: ScoreRow) => ScoreRow) {
    setRows((old) => ({ ...old, [id]: change(old[id]) }));
    setNotice("");
    setIssues((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
  }
  function selectPlayer(
    squadId: string,
    player: Candidate,
    replace?: string,
  ): boolean {
    const row = rows[squadId];
    const removed = row.players.find(
      (p) => p.id === replace && p.id !== player.id,
    );
    if (
      removed?.kills &&
      !window.confirm(
        `Replace ${removed.ign}? Their ${removed.kills} recorded kills will be removed from this game.`,
      )
    )
      return false;
    const source = Object.entries(rows).find(
      ([id, r]) => id !== squadId && r.players.some((p) => p.id === player.id),
    );
    if (
      source &&
      !window.confirm(
        `${player.ign} is recorded for another team in this game. Move them and their kills here? Both team changes will be saved together.`,
      )
    )
      return false;
    const carried = source?.[1].players.find((p) => p.id === player.id);
    setRows((old) =>
      Object.fromEntries(
        Object.entries(old).map(([id, r]) => [
          id,
          id === squadId
            ? {
                ...r,
                status: "present",
                players:
                  r.players.some((p) => p.id === player.id) && !replace
                    ? r.players
                    : [
                        ...r.players.filter(
                          (p) => p.id !== player.id && p.id !== replace,
                        ),
                        carried ?? { ...player, kills: "" },
                      ],
              }
            : source?.[0] === id
              ? { ...r, players: r.players.filter((p) => p.id !== player.id) }
              : r,
        ]),
      ),
    );
    setNotice("");
    return true;
  }
  function changedWithMoves(ids: string[]): string[] {
    const selected = new Set(ids);
    let again = true;
    while (again) {
      again = false;
      for (const id of [...selected]) {
        const playerIds = new Set(
          [...rows[id].players, ...(base[id]?.players ?? [])].map((p) => p.id),
        );
        for (const other of dirtyIds) {
          if (
            !selected.has(other) &&
            [...rows[other].players, ...(base[other]?.players ?? [])].some(
              (p) => playerIds.has(p.id),
            )
          ) {
            selected.add(other);
            again = true;
          }
        }
      }
    }
    return [...selected];
  }
  async function save(only?: string, next = false, merge = false) {
    if (sheet.status !== "ready" || saving || adding) return;
    const ids = changedWithMoves(
      (only ? [only] : dirtyIds).filter((id) => !sameRow(rows[id], base[id])),
    );
    if (!ids.length) {
      if (next) nextSquad(only!);
      else setNotice("No unsaved score changes.");
      return;
    }
    const invalid = Object.fromEntries(
      ids
        .map((id) => [id, validateRow(rows[id])])
        .filter((pair): pair is [string, string] => pair[1] !== null),
    );
    setIssues(invalid);
    if (Object.keys(invalid).length) {
      setError("Check the highlighted numbers, or leave unknown values blank.");
      setOpen(Object.keys(invalid)[0]);
      return;
    }
    if (
      merge &&
      !window.confirm(
        "Use your changed teams over their latest saved values? All other teams will keep their latest server values. Review any shared player moves first.",
      )
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const latest = merge
        ? (await api.resultSheet(session.token, matchId)).data
        : sheet.data;
      const result = await api.saveResults(
        session.token,
        matchId,
        ids.map((id) => scoreInput(id, rows[id])),
        merge ? (latest.result?.lock_version ?? null) : lockVersion,
        merge ? versionOf(latest) : scoringVersion,
      );
      const updated = sheetWithResult(latest, result.data);
      const original = sheetRows(updated);
      const keep = dirtyIds.filter((id) => !ids.includes(id) && original[id]);
      setSheet({ status: "ready", data: updated });
      setBase(original);
      setRows({
        ...original,
        ...Object.fromEntries(keep.map((id) => [id, rows[id]])),
      });
      setLockVersion(result.data.lock_version);
      setScoringVersion(versionOf(updated));
      setConflict(false);
      setNotice(
        `${ids.length === 1 ? "Team saved" : "Results saved"}. Standings updated. Missing details can be filled in anytime.`,
      );
      if (next && only) nextSquad(only);
    } catch (e) {
      setError(errorText(e));
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setSaving(false);
    }
  }
  function nextSquad(id: string) {
    if (sheet.status !== "ready") return;
    const squads = sheet.data.squads;
    const index = squads.findIndex((s) => s.id === id);
    const next = squads[index + 1];
    setOpen(next?.id ?? null);
    setTimeout(
      () =>
        document
          .getElementById(`score-${next?.id ?? id}`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      0,
    );
  }
  function applyImport(teams: ScreenshotImportTeam[]): ApplyImportResult {
    if (sheet.status !== "ready" || saving || adding) {
      return {
        applied: false,
        message: "Wait for the current save or slot update, then apply again.",
      };
    }
    const merged = mergeImport(teams, rows);
    if (merged.errors.length)
      return { applied: false, message: merged.errors.join(" ") };
    if (!merged.count)
      return {
        applied: false,
        message: "Map and include at least one team first.",
      };
    if (
      merged.conflicts.length &&
      !window.confirm(
        `These reviewed values will change existing scores or lineups:\n\n${merged.conflicts.slice(0, 8).join("\n")}${merged.conflicts.length > 8 ? `\n…and ${merged.conflicts.length - 8} more changes.` : ""}\n\nContinue? Unknown fields and known team totals will be preserved. Nothing is published until you save.`,
      )
    )
      return {
        applied: false,
        message:
          "Import cancelled. Your existing score draft is unchanged. You can edit this review and try again.",
      };
    setRows(merged.rows);
    setOpen(
      teams.find((team) => team.squad && !team.excluded)?.squad?.id ?? null,
    );
    const message = `${merged.count} team${merged.count === 1 ? "" : "s"} merged into the score draft. Existing details were kept unless you confirmed a change. Unresolved names and scores remain in this import review.`;
    setNotice(message);
    setIssues({});
    return { applied: true, message };
  }
  async function addEntry(body: {
    squad_id?: string;
    clan_id?: string;
    slot_number: number;
  }) {
    if (sheet.status !== "ready") return;
    setAdding(true);
    try {
      const created = await api.addLateEntry(session.token, matchId, body);
      const latest = created.data.sheet;
      const initial = sheetRows(latest);
      setSheet({ status: "ready", data: latest });
      setBase(initial);
      setRows({
        ...initial,
        ...Object.fromEntries(
          dirtyIds.filter((id) => initial[id]).map((id) => [id, rows[id]]),
        ),
      });
      setLate(false);
      setLateSlot(null);
      setOpen(created.data.squad_id);
      setNotice(
        "Clan slot added to this game. Existing saved scores were kept. Map the screenshot team to its new slot if needed.",
      );
    } finally {
      setAdding(false);
    }
  }
  function discard() {
    if (
      !window.confirm(
        "Discard this device’s unsaved scores and load the latest saved results?",
      )
    )
      return;
    suppressDraft.current = true;
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    setRows(base);
    setRetry((n) => n + 1);
    setNotice("");
  }
  if (sheet.status === "loading")
    return <p className="score-empty">Loading score sheet…</p>;
  if (sheet.status === "error")
    return (
      <p className="score-error" role="alert">
        {sheet.message}{" "}
        <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
      </p>
    );
  const data = sheet.data;
  const visible = data.squads.filter(
    (s) =>
      matchesPlayerSearch(
        `${s.slot_number ?? ""} ${s.clan} ${s.clan_tag} ${s.name}`,
        query,
      ) &&
      (filter === "all" ||
        (filter === "unsaved" && dirtyIds.includes(s.id)) ||
        (filter === "pending" &&
          (rows[s.id]?.status === "unentered" || incomplete(rows[s.id])))),
  );
  return (
    <>
      <div className="score-match-bar">
        <div>
          <strong>{data.match.map_label}</strong>
          <span>
            {formatDate(data.match.date)} · Game {data.match.match_index}
          </span>
        </div>
        <div className="score-match-actions">
          <button
            type="button"
            disabled={saving || adding}
            onClick={() => {
              setLate(false);
              setImportOpen((value) => !value);
            }}
          >
            Import screenshot
          </button>
          <button
            type="button"
            disabled={saving || adding}
            onClick={() => {
              setImportOpen(false);
              setLateSlot(null);
              setLate((value) => !value);
            }}
          >
            ＋ Add clan / slot
          </button>
        </div>
      </div>
      <div hidden={!importOpen}>
        <ScreenshotImport
          token={session.token}
          matchId={matchId}
          sheet={data}
          storageKey={`${draftKey}:import-review`}
          busy={saving || adding}
          onApply={applyImport}
          onLateEntry={(teamNumber, teamLabel) => {
            setLateSlot(teamNumber);
            setLate(true);
            setNotice(
              `Add ${teamLabel} as a late entry, then map it to its slot.`,
            );
            setTimeout(
              () =>
                document
                  .querySelector(".score-late-entry")
                  ?.scrollIntoView({ block: "start", behavior: "smooth" }),
              0,
            );
          }}
          onClose={() => setImportOpen(false)}
        />
      </div>
      {late && (
        <ScoreLateEntry
          token={session.token}
          sheet={data}
          busy={adding}
          initialSlot={lateSlot}
          onAdd={addEntry}
          onClose={() => {
            setLate(false);
            setLateSlot(null);
          }}
        />
      )}
      <div className="score-toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find slot or clan"
          aria-label="Find slot or clan"
        />
        <div className="score-filters" aria-label="Filter teams">
          {[
            ["all", `All teams · ${data.squads.length}`],
            ["pending", "To finish"],
            ["unsaved", `Unsaved · ${dirtyIds.length}`],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="score-table-help">
        Tap a team to edit its players. Kills and points update as you type.
      </p>
      <div className="score-column-head" aria-hidden="true">
        <span>Slot / clan</span>
        <span>Attendance</span>
        <span>Place</span>
        <span>Kills</span>
        <span>Points</span>
        <span />
      </div>
      <fieldset className="score-teams" disabled={saving || adding}>
        {visible.map((squad) => {
          const row = rows[squad.id];
          if (!row) return null;
          const expanded = open === squad.id;
          const changed = dirtyIds.includes(squad.id);
          const identity = squad.clan;
          return (
            <section
              id={`score-${squad.id}`}
              className={`score-team${expanded ? " is-open" : ""}`}
              key={squad.id}
            >
              <div className="score-team-summary">
                <button
                  type="button"
                  className="score-team-name"
                  aria-expanded={expanded}
                  aria-controls={`players-${squad.id}`}
                  onClick={() => setOpen(expanded ? null : squad.id)}
                >
                  <span className="score-slot">{squad.slot_number ?? "—"}</span>
                  <span>
                    <strong>{identity}</strong>
                    <small className={changed ? "score-unsaved" : ""}>
                      {changed
                        ? "Unsaved"
                        : row.status === "unentered"
                          ? "Not entered"
                          : incomplete(row)
                            ? "Saved · details pending"
                            : "Saved"}
                    </small>
                  </span>
                </button>
                <label className="score-attendance">
                  <span>Attendance</span>
                  <select
                    aria-label={`Attendance for ${identity}`}
                    value={row.status}
                    onChange={(e) => {
                      const status = e.target.value as ScoreRow["status"];
                      if (
                        status !== "present" &&
                        (row.players.length ||
                          row.placement ||
                          row.teamKills) &&
                        !window.confirm(
                          `Mark this team ${status === "absent" ? "absent" : "not entered"}? Saving will remove its match scores. You can cancel or change back before saving.`,
                        )
                      )
                        return;
                      update(squad.id, (old) => ({ ...old, status }));
                    }}
                  >
                    <option value="unentered">Not entered</option>
                    <option value="present">Played</option>
                    <option value="absent">Absent</option>
                  </select>
                </label>
                <label className="score-place">
                  <span>Place</span>
                  <input
                    aria-label={`Placement for ${identity}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    placeholder="—"
                    value={row.placement}
                    onChange={(e) =>
                      update(squad.id, (old) => ({
                        ...old,
                        status: "present",
                        placement: e.target.value,
                      }))
                    }
                  />
                </label>
                <div className="score-number">
                  <span>Kills</span>
                  <strong>
                    {row.status === "present" && hasKills(row)
                      ? totalKills(row)
                      : "—"}
                  </strong>
                  <small>
                    {row.teamKills !== "" ? "Known total" : "Live total"}
                  </small>
                </div>
                <div className="score-number">
                  <span>Points</span>
                  <strong>{pointsPreview(row, data.match.scoring)}</strong>
                  <small>
                    {row.status === "present" && !row.placement
                      ? "Place pending"
                      : "Preview"}
                  </small>
                </div>
                <button
                  type="button"
                  className="score-expand"
                  aria-label={`${expanded ? "Collapse" : "Edit players for"} ${identity}`}
                  aria-expanded={expanded}
                  aria-controls={`players-${squad.id}`}
                  onClick={() => setOpen(expanded ? null : squad.id)}
                >
                  {expanded ? "⌃" : "⌄"}
                </button>
              </div>
              {issues[squad.id] && (
                <p className="score-error" role="alert">
                  {issues[squad.id]}
                </p>
              )}
              {expanded && (
                <div className="score-team-editor" id={`players-${squad.id}`}>
                  {row.status !== "present" && (
                    <p className="score-warning">
                      {row.status === "absent"
                        ? "Marked absent."
                        : "No result entered yet."}{" "}
                      Enter a player’s kills or placement to mark this team as
                      played.
                    </p>
                  )}
                  <ScorePlayers
                    key={squad.id}
                    token={session.token}
                    matchId={matchId}
                    squad={squad}
                    row={row}
                    rows={rows}
                    onChange={(change) => update(squad.id, change)}
                    onSelect={(player, replace) =>
                      selectPlayer(squad.id, player, replace)
                    }
                  />
                  <div className="score-team-footer">
                    <p>
                      {knownKills(row)} player kills · {row.players.length}/4
                      actual players
                      <br />
                      <small>
                        Partial scores are welcome. Unknown is different from
                        zero.
                      </small>
                    </p>
                    <div>
                      <button type="button" onClick={() => setOpen(null)}>
                        Collapse
                      </button>
                      <button
                        type="button"
                        className="score-primary"
                        onClick={() => void save(squad.id, true)}
                      >
                        Save team & next →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </fieldset>
      {!visible.length && (
        <p className="score-empty">
          {data.squads.length
            ? "No teams match this filter."
            : "No slots yet. Add a clan and its game slot above."}
        </p>
      )}
      {!importOpen && (
        <footer className="score-save-bar">
          <div className="score-save-message">
            {error && (
              <p className="score-error" role="alert">
                {error}
              </p>
            )}
            {conflict && (
              <div className="score-conflict">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(undefined, false, true)}
                >
                  Review & save my changed teams
                </button>
                <button type="button" disabled={saving} onClick={discard}>
                  Discard draft & load latest
                </button>
              </div>
            )}
            {notice && (
              <p className="score-success" role="status">
                {notice}
              </p>
            )}
            {draftProblem && (
              <p className="score-warning">
                Device draft storage is unavailable. Keep this screen open until
                your scores are saved.
              </p>
            )}
            <span>
              {saving
                ? "Saving…"
                : dirty
                  ? `${dirtyIds.length} team${dirtyIds.length === 1 ? "" : "s"} with unsaved changes`
                  : "All score changes saved"}
            </span>
            {dirty && !draftProblem && (
              <small>Draft kept on this device · not published yet</small>
            )}
          </div>
          <div className="score-save-actions">
            {dirty && (
              <button
                type="button"
                disabled={saving || adding}
                onClick={discard}
              >
                Discard
              </button>
            )}
            <button
              type="button"
              className="score-primary"
              disabled={saving || adding || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save all changes"}
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
