import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type {
  ResultSheet,
  ScreenshotImport as ImportResult,
  ScreenshotImportTeam,
  ScreenshotPlayer,
} from "./api/types";
import { playerSearchKey } from "./playerSearch";
import {
  applicableTeam,
  autoCreateNewPlayerKeys,
  autoCreateNewPlayers,
  importProblems,
  playerKey,
  prepareReview,
  remapTeam,
  reviewCandidates,
  selectedPlayer,
  teamKey,
  uniqueCandidates,
  unresolvedPlayers,
  validReview,
  type ApplyImportResult,
  type ImportCandidate,
} from "./screenshotReview";

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? [...new Set([error.message, ...Object.values(error.errors).flat()])]
        .slice(0, 3)
        .join(" ")
    : "Could not read the screenshots. Try again or enter scores manually.";
const labelSquad = (
  squad:
    ResultSheet["squads"][number] | NonNullable<ScreenshotImportTeam["squad"]>,
) =>
  [squad.clan_tag, squad.clan]
    .filter((part): part is string => Boolean(part))
    .join(" · ") || squad.name;
function statusText(player: ScreenshotPlayer) {
  if (player.player_id?.startsWith("new:") && player.confirmed)
    return "New profile · created when you save scores";
  if (player.status === "matched")
    return player.confirmed ? "Player confirmed" : "Matched player";
  if (player.status === "other_squad")
    return `Existing player · ${player.clan ?? "another squad"} · added as guest`;
  if (player.status === "ambiguous")
    return "Choose the correct existing player";
  if (player.status === "duplicate") return "Choose the correct occurrence";
  return `New name · profile created${player.clan ? ` under ${player.clan}` : ""} when you save`;
}
function numeric(value: string, min = 0, max = 999): number | null | undefined {
  if (value === "") return null;
  return /^\d+$/.test(value) && +value >= min && +value <= max
    ? +value
    : undefined;
}
function readCached(
  storageKey: string,
  sheet: ResultSheet,
): ImportResult | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validReview(value) ? prepareReview(value, sheet) : null;
  } catch {
    return null;
  }
}
export function ScreenshotImport({
  token,
  matchId,
  sheet,
  storageKey,
  busy = false,
  onApply,
  onSave,
  onLateEntry,
  onClose,
}: {
  token: string;
  matchId: string;
  sheet: ResultSheet;
  storageKey: string;
  busy?: boolean;
  onApply: (teams: ScreenshotImportTeam[]) => ApplyImportResult;
  onSave: (teams: ScreenshotImportTeam[]) => Promise<ApplyImportResult>;
  onLateEntry: (number: number | null, label: string) => void;
  onClose: () => void;
}) {
  const [review, setReview] = useState<ImportResult | null>(() =>
    readCached(storageKey, sheet),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [command, setCommand] = useState("");
  const [storageProblem, setStorageProblem] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    try {
      if (review) localStorage.setItem(storageKey, JSON.stringify(review));
      else localStorage.removeItem(storageKey);
    } catch {
      setStorageProblem(true);
    }
  }, [review, storageKey]);
  function changeTeams(
    change: (teams: ScreenshotImportTeam[]) => ScreenshotImportTeam[],
  ) {
    setReview((current) =>
      current ? { ...current, teams: change(current.teams) } : current,
    );
    setApplied(false);
    setMessage("");
    setError("");
  }
  function changeTeam(
    id: string,
    change: (team: ScreenshotImportTeam) => ScreenshotImportTeam,
  ) {
    changeTeams((teams) =>
      teams.map((team) => (teamKey(team) === id ? change(team) : team)),
    );
  }
  function changePlayer(
    teamId: string,
    id: string,
    change: (player: ScreenshotPlayer) => ScreenshotPlayer,
  ) {
    changeTeam(teamId, (team) => ({
      ...team,
      players: team.players.map((player) =>
        playerKey(player) === id ? change(player) : player,
      ),
    }));
  }
  function chooseFiles(list: FileList | null) {
    if (!list || reading) return;
    const incoming = Array.from(list);
    const invalid = incoming.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024,
    );
    if (invalid) {
      setError(`${invalid.name} must be a JPEG, PNG or WebP under 5 MB.`);
      return;
    }
    const next = [...files, ...incoming].filter(
      (file, index, all) =>
        all.findIndex(
          (other) =>
            other.name === file.name &&
            other.size === file.size &&
            other.lastModified === file.lastModified,
        ) === index,
    );
    if (next.length > 6) {
      setError("Choose up to 6 screenshots from one game at a time.");
      return;
    }
    setFiles(next);
    setError("");
    if (input.current) input.current.value = "";
  }
  async function read() {
    if (!files.length || reading || busy) return;
    if (
      review &&
      !window.confirm(
        "Replace this import review with the new screenshots? Scores already in the score draft will stay unchanged.",
      )
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setReading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.importScreenshot(
        token,
        matchId,
        files,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setReview(prepareReview(data, sheet));
      setApplied(false);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorText(e));
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }
  function mapTeam(id: string, squadId: string) {
    if (!review) return;
    if (!squadId) {
      changeTeam(id, (team) => ({
        ...team,
        status: "unassigned",
        squad: null,
        suggested_squad: null,
      }));
      return;
    }
    const target = sheet.squads.find((squad) => squad.id === squadId);
    const source = review.teams.find((team) => teamKey(team) === id);
    if (!target || !source) return;
    const occupants = review.teams.filter(
      (team) =>
        teamKey(team) !== id &&
        applicableTeam(team) &&
        team.squad?.id === squadId,
    );
    if (
      occupants.length &&
      !window.confirm(
        `Slot ${target.slot_number} is mapped to ${occupants.map((team) => team.team_label).join(", ")}. Use it for ${source.team_label} instead? The other extracted teams will stay here unmapped, with their scores preserved.`,
      )
    )
      return;
    changeTeams((teams) =>
      teams.map((team) =>
        teamKey(team) === id
          ? remapTeam(team, target, sheet, teams)
          : occupants.some((other) => teamKey(other) === teamKey(team))
            ? {
                ...team,
                status: "unassigned",
                squad: null,
                suggested_squad: null,
              }
            : team,
      ),
    );
  }
  function runCommand(event: React.FormEvent) {
    event.preventDefault();
    const parsed =
      /^\s*team\s*(\d{1,2})\s*(?:is\s+|belongs\s+to\s+|->\s*|→\s*)?(?:slot\s*)(\d{1,2})\s*[.!]?\s*$/i.exec(
        command,
      );
    if (!parsed || !review) {
      setError("Try: TEAM18 is Slot 6");
      return;
    }
    const team = review.teams.find((t) => t.team_number === +parsed[1]);
    const target = sheet.squads.find((s) => s.slot_number === +parsed[2]);
    if (!team) {
      setError(`TEAM${parsed[1]} is not in this import.`);
      return;
    }
    if (!target) {
      setError(`No squad has slot ${parsed[2]}. Add a late entry first.`);
      return;
    }
    mapTeam(teamKey(team), target.id);
    setCommand("");
  }
  async function apply(saveAfter: boolean) {
    if (!review || reading || busy || savingDraft) return;
    // New names are created automatically on apply. Ambiguous and duplicate
    // names stay in this review rather than blocking the whole result board.
    const prepared = prepareReview(review, sheet);
    const normalized = {
      ...prepared,
      teams: autoCreateNewPlayers(prepared.teams),
    };
    const problems = importProblems(normalized.teams);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSavingDraft(saveAfter);
    try {
      const result = saveAfter
        ? await onSave(normalized.teams)
        : onApply(normalized.teams);
      // A parent cancellation leaves the review editable and Apply available.
      if (!result.applied) {
        setError(result.message);
        return;
      }
      setReview(normalized);
      setApplied(true);
      if (result.failed) {
        setMessage("");
        setError(result.message);
      } else {
        setError("");
        setMessage(result.message);
      }
    } finally {
      setSavingDraft(false);
    }
  }
  const activeTeams = review?.teams.filter(applicableTeam) ?? [];
  const pending = review ? unresolvedPlayers(review.teams) : [];
  const autoNewKeys = review
    ? autoCreateNewPlayerKeys(review.teams)
    : new Set<string>();
  const newPending = pending.filter(
    (player) =>
      player.status === "new" && autoNewKeys.has(playerSearchKey(player.name)),
  );
  const blockedPending = pending.filter(
    (player) => !newPending.includes(player),
  );
  const newNames = newPending.length;
  const unresolved = blockedPending.length;
  const unresolvedKills = blockedPending.reduce(
    (sum, player) => sum + (player.kills ?? 0),
    0,
  );
  const problems = review ? importProblems(review.teams) : [];
  const candidates = review ? reviewCandidates(sheet, review.teams) : [];
  return (
    <section className="score-import" aria-labelledby="score-import-title">
      <header className="score-import-head">
        <div>
          <p className="score-eyebrow">SCREENSHOT IMPORT</p>
          <h2 id="score-import-title">
            Review the result board<span>.</span>
          </h2>
          <p>
            Choose players, correct numbers, then apply the scores to your
            draft and save. Unresolved rows stay in this review until you
            resolve or clear them.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close screenshot import"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <fieldset
        className="score-import-controls"
        disabled={busy || reading || savingDraft}
      >
        <div className="score-import-upload">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => chooseFiles(event.target.files)}
          />
          <button type="button" onClick={() => input.current?.click()}>
            Choose screenshots
          </button>
          <span>
            {files.length
              ? `${files.length} images selected`
              : "One game · up to 6 images · JPEG, PNG or WebP · 5 MB each"}
          </span>
          <button
            type="button"
            className="score-primary"
            disabled={!files.length}
            onClick={() => void read()}
          >
            Read screenshots
          </button>
        </div>
        {!!files.length && (
          <ul className="score-import-files" aria-label="Selected screenshots">
            {files.map((file) => (
              <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles((old) => old.filter((item) => item !== file))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {reading && (
        <p role="status">
          Reading screenshots…{" "}
          <button
            type="button"
            onClick={() => {
              request.current?.abort();
              setReading(false);
            }}
          >
            Cancel reading
          </button>
        </p>
      )}
      {error && (
        <p className="score-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="score-success" role="status">
          {message}
        </p>
      )}
      {storageProblem && (
        <p className="score-warning">
          Device storage is unavailable. Keep this review open until you have
          recorded the details you need.
        </p>
      )}
      {review && (
        <fieldset
          className="score-import-controls"
          disabled={busy || reading || savingDraft}
        >
          <div className="score-import-summary">
            <span>
              <strong>{review.teams.length}</strong> teams read
            </span>
            <span>
              <strong>{activeTeams.length}</strong> selected & mapped
            </span>
            <span>
              <strong>{newNames}</strong> new profiles to create
            </span>
            <span>
              <strong>{unresolved}</strong> names need a choice
              {unresolvedKills ? ` · ${unresolvedKills} kills` : ""}
            </span>
          </div>
          {!!newNames && (
            <div className="score-import-bulk">
              <p>
                {newNames} new player profile{newNames === 1 ? "" : "s"} will
                be created automatically when you save the scores. Their kills
                are included.
              </p>
            </div>
          )}
          <form className="score-import-command" onSubmit={runCommand}>
            <label htmlFor="score-import-command-input">
              Quick map command
            </label>
            <div>
              <input
                id="score-import-command-input"
                value={command}
                placeholder="TEAM18 is Slot 6"
                onChange={(event) => setCommand(event.target.value)}
              />
              <button type="submit" disabled={!command.trim()}>
                Map team
              </button>
            </div>
          </form>
          {!!review.warnings.length && (
            <details className="score-import-warnings">
              <summary>Extraction notes ({review.warnings.length})</summary>
              <ul>
                {review.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {!!problems.length && (
            <div className="score-warning" role="status">
              {problems.map((problem) => (
                <p key={problem}>{problem}</p>
              ))}
            </div>
          )}
          <div className="score-import-teams">
            {review.teams.map((team) => {
              const id = teamKey(team);
              const total = team.players
                .filter((p) => !p.excluded)
                .reduce((sum, p) => sum + (p.kills ?? 0), 0);
              return (
                <article
                  className={`score-import-team${team.excluded ? " is-skipped" : ""}`}
                  key={id}
                >
                  <header>
                    <span className="score-import-team-label">
                      {team.team_label}
                    </span>
                    <label className="score-import-include">
                      <input
                        type="checkbox"
                        checked={!team.excluded}
                        onChange={(event) =>
                          changeTeam(id, (t) => ({
                            ...t,
                            excluded: !event.target.checked,
                          }))
                        }
                      />
                      Include team
                    </label>
                  </header>
                  <div className="score-import-team-squad">
                    <strong>
                      {team.squad
                        ? labelSquad(team.squad)
                        : "Choose this team’s squad"}
                    </strong>
                    {team.status === "roster_mismatch" && (
                      <small>
                        Check slot: players suggest{" "}
                        {team.suggested_squad
                          ? labelSquad(team.suggested_squad)
                          : "a different squad"}
                        .
                      </small>
                    )}
                    {team.status === "roster_matched" && (
                      <small>
                        Suggested from roster · confirm this game’s mapping.
                      </small>
                    )}
                  </div>
                  <label className="score-import-map">
                    <span>Map to app slot</span>
                    <select
                      aria-label={`Map ${team.team_label} to an app slot`}
                      value={team.squad?.id ?? ""}
                      onChange={(event) => mapTeam(id, event.target.value)}
                    >
                      <option value="">Unmapped — retain for later</option>
                      {[...sheet.squads]
                        .filter((s) => s.slot_number !== null)
                        .sort(
                          (a, b) =>
                            (a.slot_number ?? 99) - (b.slot_number ?? 99),
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            Slot {s.slot_number} · {labelSquad(s)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!team.squad && (
                    <button
                      type="button"
                      className="score-import-late"
                      onClick={() =>
                        onLateEntry(team.team_number, team.team_label)
                      }
                    >
                      Add {team.team_label} as late entry
                    </button>
                  )}
                  <div className="score-import-numbers">
                    <label>
                      Placement
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`Placement read for ${team.team_label}`}
                        placeholder="Unknown"
                        value={team.placement ?? ""}
                        onChange={(event) => {
                          const n = numeric(event.target.value, 1, 100);
                          if (n !== undefined)
                            changeTeam(id, (t) => ({ ...t, placement: n }));
                        }}
                      />
                      {(team.placement_options?.length ?? 0) > 1 && (
                        <small>
                          Images show {team.placement_options!.join(" / ")}.
                          Choose the correct placement, or leave unknown.
                        </small>
                      )}
                    </label>
                    <label>
                      Printed team total (optional)
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`Printed team kills for ${team.team_label}`}
                        placeholder="Auto from players"
                        value={team.team_kills ?? ""}
                        onChange={(event) => {
                          const n = numeric(event.target.value);
                          if (n !== undefined)
                            changeTeam(id, (t) => ({ ...t, team_kills: n }));
                        }}
                      />
                      {(team.team_kills_options?.length ?? 0) > 1 && (
                        <small>
                          Images show {team.team_kills_options!.join(" / ")}.
                          Confirm the printed total.
                        </small>
                      )}
                    </label>
                  </div>
                  <p className="score-muted">
                    {total} visible player kills · {team.players.length} names
                    retained. Unknown kills are not zero.
                  </p>
                  {team.players.length > 4 && (
                    <p className="score-warning">
                      More than four names were read. No rows were discarded.
                      Skip OCR duplicates or choose the actual players.
                    </p>
                  )}
                  <ul className="score-import-players">
                    {team.players.map((player) => (
                      <ImportPlayer
                        key={playerKey(player)}
                        player={player}
                        candidates={candidates}
                        token={token}
                        matchId={matchId}
                        onChange={(change) =>
                          changePlayer(id, playerKey(player), change)
                        }
                      />
                    ))}
                  </ul>
                  <label className="score-import-include">
                    <input
                      type="checkbox"
                      checked={!!team.replace_lineup}
                      onChange={(event) =>
                        changeTeam(id, (t) => ({
                          ...t,
                          replace_lineup: event.target.checked,
                        }))
                      }
                    />
                    Replace match lineup instead of adding to it
                  </label>
                  <small className="score-muted">
                    Existing players and known fields are kept by default.
                    Removing existing players requires confirmation.
                  </small>
                </article>
              );
            })}
          </div>
          <div className="score-import-apply">
            <p>
              {activeTeams.length
                ? `${activeTeams.length} team${activeTeams.length === 1 ? "" : "s"} can fill the draft.${
                    newNames
                      ? ` ${newNames} new profile${newNames === 1 ? "" : "s"} will be created.`
                      : ""
                  }${
                    unresolved
                      ? ` ${unresolved} name${unresolved === 1 ? "" : "s"}${
                          unresolvedKills ? ` with ${unresolvedKills} kills` : ""
                        } ${unresolved === 1 ? "needs" : "need"} a choice and ${
                          unresolved === 1 ? "stays" : "stay"
                        } in this review.`
                      : ""
                  }`
                : "Map a team or include it to apply its scores."}
            </p>
            <button
              type="button"
              className="score-primary"
              disabled={!activeTeams.length || applied || savingDraft}
              onClick={() => void apply(true)}
            >
              {savingDraft
                ? "Applying & saving…"
                : "Apply & save to scores"}
            </button>
            <button
              type="button"
              disabled={!activeTeams.length || applied || savingDraft}
              onClick={() => void apply(false)}
            >
              {applied ? "Applied to draft" : "Apply to draft"}
            </button>
            <button type="button" onClick={onClose}>
              Review draft & save
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    "Clear this import review, including unresolved names? Existing score drafts and saved results will stay unchanged.",
                  )
                )
                  return;
                setReview(null);
                setApplied(false);
                setMessage("");
                setError("");
              }}
            >
              Clear review
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}

function ImportPlayer({
  player,
  candidates,
  token,
  matchId,
  onChange,
}: {
  player: ScreenshotPlayer;
  candidates: ImportCandidate[];
  token: string;
  matchId: string;
  onChange: (change: (p: ScreenshotPlayer) => ScreenshotPlayer) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState(player.name);
  const [results, setResults] = useState<ImportCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [verifiedQuery, setVerifiedQuery] = useState<string | null>(null);
  const queryKey = playerSearchKey(query);
  const suggestions = uniqueCandidates([
    ...player.candidates,
    ...candidates.filter((p) => playerSearchKey(p.ign) === queryKey),
    ...results,
  ]);
  const exact = suggestions.filter(
    (p) => playerSearchKey(p.ign) === playerSearchKey(player.name),
  );
  useEffect(() => {
    if (!choosing) return;
    const c = new AbortController();
    setSearching(true);
    setError("");
    setResults([]);
    setVerifiedQuery(null);
    setMore(false);
    const timer = window.setTimeout(
      () =>
        api
          .matchParticipants(token, matchId, query, undefined, c.signal)
          .then(({ data, meta }) => {
            if (!c.signal.aborted) {
              setResults(
                data.map((p) => ({
                  player_id: p.id,
                  ign: p.ign,
                  clan: p.clan,
                })),
              );
              setMore(meta.has_more);
              setVerifiedQuery(query);
            }
          })
          .catch((e) => {
            if (!c.signal.aborted) setError(errorText(e));
          })
          .finally(() => {
            if (!c.signal.aborted) setSearching(false);
          }),
      250,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [token, matchId, query, choosing]);
  function choose(candidate: ImportCandidate) {
    onChange((p) => ({
      ...p,
      ...candidate,
      status: "matched",
      confirmed: true,
      candidates: [],
    }));
    setChoosing(false);
  }
  function editName(name: string) {
    setQuery(name);
    onChange((p) => ({
      ...p,
      name,
      status: "new",
      confirmed: false,
      player_id: null,
      ign: name,
      candidates: [],
    }));
  }
  const canCreate =
    player.status === "new" && !!player.name.trim() && !exact.length;
  const creationBlocked =
    searching ||
    !!error ||
    more ||
    verifiedQuery !== query ||
    queryKey !== playerSearchKey(player.name);
  return (
    <li
      className={`score-import-player-review${player.excluded ? " is-skipped" : ""}`}
    >
      <div className="score-import-player-top">
        <label className="score-import-include">
          <input
            type="checkbox"
            checked={!player.excluded}
            aria-label={`Include ${player.name}`}
            onChange={(event) =>
              onChange((p) => ({ ...p, excluded: !event.target.checked }))
            }
          />
          <span>
            <strong>
              {player.tag && (
                <span className="score-import-tag">{player.tag}</span>
              )}
              {player.ign ?? player.name}
            </strong>
            <small>{statusText(player)}</small>
            {player.ign && player.ign !== player.name && (
              <small>Read as: {player.name}</small>
            )}
          </span>
        </label>
        <label className="score-import-kills">
          Kills
          <input
            type="text"
            inputMode="numeric"
            aria-label={`Imported kills for ${player.name}`}
            placeholder="—"
            value={player.kills ?? ""}
            onChange={(event) => {
              const n = numeric(event.target.value);
              if (n !== undefined) onChange((p) => ({ ...p, kills: n }));
            }}
          />
        </label>
      </div>
      {(player.kills_options?.length ?? 0) > 1 && (
        <p className="score-warning">
          Images show {player.kills_options!.join(" / ")} kills.{" "}
          <span>
            {player.kills === null
              ? "Left unknown until you choose."
              : `Using your choice: ${player.kills}.`}
          </span>{" "}
          {player.kills_options!.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange((p) => ({ ...p, kills: n }))}
            >
              Use {n}
            </button>
          ))}
        </p>
      )}
      <div className="score-import-player-buttons">
        <button type="button" onClick={() => setChoosing(!choosing)}>
          {choosing
            ? "Close player choices"
            : player.status === "ambiguous"
              ? "Choose player"
              : "Change / find player"}
        </button>
        {player.status === "other_squad" && (
          <button
            type="button"
            onClick={() =>
              onChange((p) => ({ ...p, status: "matched", confirmed: true }))
            }
          >
            Use existing guest
          </button>
        )}
      </div>
      {choosing && (
        <div className="score-import-player-picker">
          <label>
            Correct the read name
            <input
              aria-label={`Correct name read for ${player.name}`}
              value={player.name}
              maxLength={100}
              onChange={(event) => editName(event.target.value)}
            />
          </label>
          <label>
            Find registered player
            <input
              type="search"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search any player name"
            />
          </label>
          {searching && <p role="status">Searching players…</p>}
          {error && (
            <p className="score-error" role="alert">
              {error}
            </p>
          )}
          <div className="score-import-candidates">
            {suggestions.map((candidate) => (
              <button
                type="button"
                key={candidate.player_id}
                onClick={() => choose(candidate)}
              >
                <strong>{candidate.ign}</strong>
                <small>
                  {candidate.clan ?? "Registered player"}
                  {candidate.squad_name ? ` · ${candidate.squad_name}` : ""}
                </small>
              </button>
            ))}
          </div>
          {more && (
            <small>
              Showing the first 40 matches. Refine the search to find a specific
              player.
            </small>
          )}
          {canCreate && (
            <button
              type="button"
              disabled={creationBlocked}
              onClick={() => {
                if (creationBlocked || exact.length) return;
                onChange((p) => ({
                  ...p,
                  status: "matched",
                  confirmed: true,
                  player_id: `new:${crypto.randomUUID()}`,
                  ign: p.name.trim(),
                }));
                setChoosing(false);
              }}
            >
              Create new player on save
            </button>
          )}
          {player.status === "new" && exact.length > 0 && (
            <small>
              A registered player matches this name. Choose their profile above.
            </small>
          )}
        </div>
      )}
    </li>
  );
}
