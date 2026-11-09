import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import { playerHandle } from "./playerDisplay";
import type {
  ResultSheet,
  ScreenshotImport as ImportResult,
  ScreenshotImportTeam,
  ScreenshotPlayer,
} from "./api/types";
import { playerSearchKey } from "./playerSearch";
import { prepareScoreboard, type PreparedScoreboard } from "./scoreboardImages";
import {
  applicableTeam,
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
  if (player.status === "suggested") {
    const best = player.candidates[0];
    return best
      ? `Possible existing player: ${playerHandle(best.ign, best.clan_tag)} · check the name`
      : "Likely existing player · confirm or choose another";
  }
  if (player.status === "ambiguous")
    return "More than one similar player exists · choose the correct one";
  if (player.status === "duplicate") return "Choose the correct occurrence";
  return "No similar existing player · create a profile only if this is someone new";
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
  const [prepared, setPrepared] = useState<PreparedScoreboard[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [command, setCommand] = useState("");
  const [panel, setPanel] = useState<"review" | "confirmed" | "teams">(
    "review",
  );
  const [storageProblem, setStorageProblem] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => prepared.forEach((image) => URL.revokeObjectURL(image.preview)), [prepared]);
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
    setPrepared([]);
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
      const images = await Promise.all(files.map(async (file) => {
        try { return await prepareScoreboard(file); }
        catch { return { file, preview: URL.createObjectURL(file), cropped: false,
          originalWidth: 0, width: 0, height: 0 }; }
      }));
      if (controller.signal.aborted) {
        images.forEach((image) => URL.revokeObjectURL(image.preview));
        return;
      }
      setPrepared(images);
      const { data } = await api.importScreenshot(
        token,
        matchId,
        images.map((image) => image.file),
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
    // Every new or similar name needs an explicit decision. Nothing is created
    // from an OCR guess, even when the read name looks unique.
    const normalized = prepareReview(review, sheet);
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
  const teamIssues = review?.teams.filter((t) => !t.excluded && !applicableTeam(t)) ?? [];
  const waitingPlayers = teamIssues.reduce((sum, t) => sum + t.players.filter((p) => !p.excluded).length, 0);
  const pending = review ? unresolvedPlayers(review.teams) : [];
  const newNames = pending.filter((player) => player.status === "new").length;
  const unresolved = pending.length;
  const unresolvedKills = pending.reduce(
    (sum, player) => sum + (player.kills ?? 0),
    0,
  );
  const pendingEntries = activeTeams
    .flatMap((team) =>
      team.players
        .filter((player) => !player.excluded && (!selectedPlayer(player) || (player.kills === null && (player.kills_options?.length ?? 0) > 1)))
        .map((player) => ({ team, player })),
    )
    .sort(
      (left, right) =>
        (left.team.squad?.slot_number ?? 999) -
        (right.team.squad?.slot_number ?? 999),
    );
  const confirmedEntries = activeTeams.flatMap((team) =>
    team.players
      .filter((player) => !player.excluded && selectedPlayer(player) && !(player.kills === null && (player.kills_options?.length ?? 0) > 1))
      .map((player) => ({ team, player })),
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
      {!!prepared.length && (
        <details className="score-import-sources">
          <summary>View scoreboards ({prepared.length})</summary>
          {prepared.some((image) => image.originalWidth > 0 && image.originalWidth < 720) && (
            <p className="score-warning">These are small images. Original screenshots make names and numbers easier to read.</p>
          )}
          <div>{prepared.map((image, index) => (
            <a key={image.preview} href={image.preview} target="_blank" rel="noreferrer">
              <span>Screenshot {index + 1}</span>
              <img src={image.preview} alt={`Scoreboard ${index + 1} sent for reading`} />
            </a>
          ))}</div>
        </details>
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
              <strong>{newNames}</strong> new names to review
            </span>
            <span>
              <strong>{unresolved}</strong> names need a choice
              {unresolvedKills ? ` · ${unresolvedKills} kills` : ""}
            </span>
          </div>
          <div className="score-import-tabs" role="tablist" aria-label="Import review sections">
            <button
              type="button"
              role="tab"
              aria-selected={panel === "review"}
              onClick={() => setPanel("review")}
            >
              Needs review <span>{pendingEntries.length + teamIssues.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === "confirmed"}
              onClick={() => setPanel("confirmed")}
            >
              Confirmed <span>{confirmedEntries.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === "teams"}
              onClick={() => setPanel("teams")}
            >
              Teams <span>{review.teams.length}</span>
            </button>
          </div>
          {panel === "review" && (
            <div className="score-import-review-queue">
              {!!teamIssues.length && (
                <section className="score-import-team-issues" aria-label="Teams needing a slot check">
                  <h3>Check teams first · {teamIssues.length}</h3>
                  <p>{waitingPlayers} player rows are kept here until their team is mapped. Check the printed TEAM header, not its finishing place.</p>
                  {teamIssues.map((team) => (
                    <article key={teamKey(team)}>
                      <strong>{team.team_label} · {team.placement === null ? "Place unknown" : `Place ${team.placement}`}</strong>
                      <p>{team.review_reasons?.[0] ?? (team.squad ? "Check this team’s slot." : "Choose a slot for this team.")}</p>
                      <div>
                        <select aria-label={`Review slot for ${team.team_label}`} value={team.squad?.id ?? ""}
                          onChange={(event) => mapTeam(teamKey(team), event.target.value)}>
                          <option value="">Choose a slot</option>
                          {[...sheet.squads].filter((s) => s.slot_number !== null)
                            .sort((a,b) => (a.slot_number ?? 99) - (b.slot_number ?? 99))
                            .map((s) => <option key={s.id} value={s.id}>Slot {s.slot_number} · {labelSquad(s)}</option>)}
                        </select>
                        {team.squad && <button type="button" onClick={() => mapTeam(teamKey(team), team.squad!.id)}>Keep slot {team.squad.slot_number}</button>}
                        {!team.squad && <button type="button" onClick={() => onLateEntry(team.team_number, team.team_label)}>Add clan / slot</button>}
                        <button type="button" onClick={() => changeTeam(teamKey(team), (t) => ({ ...t, excluded: true }))}>Skip team</button>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {pendingEntries.length ? (
                <>
                  <p className="score-import-queue-note">
                    Check these names and any conflicting numbers. Clear existing-player matches are already under Confirmed.
                  </p>
                  <ul className="score-import-players">
                    {pendingEntries.map(({ team, player }) => (
                      <ImportPlayer
                        key={`${teamKey(team)}:${playerKey(player)}`}
                        player={player}
                        team={team}
                        compact
                        candidates={candidates}
                        token={token}
                        matchId={matchId}
                        onChange={(change) =>
                          changePlayer(
                            teamKey(team),
                            playerKey(player),
                            change,
                          )
                        }
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="score-import-empty">
                  {teamIssues.length ? "Player choices will appear after you check their team slots." : "Every player is resolved. Check Confirmed or Teams, then apply the scores."}
                </p>
              )}
            </div>
          )}
          {panel === "confirmed" && (
            <div className="score-import-confirmed">
              {confirmedEntries.length ? (
                <ul className="score-import-players">
                  {confirmedEntries.map(({ team, player }) => (
                    <ImportPlayer
                      key={`${teamKey(team)}:${playerKey(player)}`}
                      player={player}
                      team={team}
                      compact
                      candidates={candidates}
                      token={token}
                      matchId={matchId}
                      onChange={(change) =>
                        changePlayer(
                          teamKey(team),
                          playerKey(player),
                          change,
                        )
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="score-import-empty">
                  No confirmed players yet. Resolve the review queue first.
                </p>
              )}
            </div>
          )}
          {panel === "review" && !!unresolved && (
            <div className="score-import-bulk">
              <p>
                No player is created automatically. Accept a suggested existing
                player, choose another profile, or explicitly create a new one
                for every unresolved name.
              </p>
            </div>
          )}
          {panel === "teams" && (
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
          )}
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
          {panel === "teams" && (
          <div className="score-import-teams">
            {review.teams.map((team) => {
              const id = teamKey(team);
              const total = team.players
                .filter((p) => !p.excluded)
                .reduce((sum, p) => sum + (p.kills ?? 0), 0);
              const teamPending = team.players.filter(
                (p) => !p.excluded && !selectedPlayer(p),
              ).length;
              const teamConfirmed = team.players.filter(
                (p) => !p.excluded && selectedPlayer(p),
              ).length;
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
                  <div className="score-import-team-players">
                    <span>
                      {teamConfirmed}/{team.players.length} players confirmed
                    </span>
                    {teamPending > 0 && (
                      <button
                        type="button"
                        onClick={() => setPanel("review")}
                      >
                        {teamPending} to review
                      </button>
                    )}
                  </div>
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
          )}
          <div className="score-import-apply">
            <p>
              {activeTeams.length} teams ready
              {teamIssues.length ? ` · ${teamIssues.length} team checks` : ""}
              {unresolved ? ` · ${unresolved} names pending` : ""}
              {unresolvedKills ? ` · ${unresolvedKills} kills in review` : ""}
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
            <details className="score-import-more">
              <summary>More</summary>
              <div>
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
            </details>
          </div>
        </fieldset>
      )}
    </section>
  );
}

function ImportPlayer({
  player,
  team,
  compact = false,
  candidates,
  token,
  matchId,
  onChange,
}: {
  player: ScreenshotPlayer;
  team?: ScreenshotImportTeam;
  compact?: boolean;
  candidates: ImportCandidate[];
  token: string;
  matchId: string;
  onChange: (change: (p: ScreenshotPlayer) => ScreenshotPlayer) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [query, setQuery] = useState(player.name);
  const [results, setResults] = useState<ImportCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
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
    setNextPage(null);
    setTotal(null);
    const timer = window.setTimeout(
      () =>
        api
          .matchParticipants(token, matchId, query, undefined, c.signal, 1)
          .then(({ data, meta }) => {
            if (!c.signal.aborted) {
              setResults(
                data.map((p) => ({
                  player_id: p.id,
                  ign: p.ign,
                  clan: p.clan,
                  clan_tag: p.clan_tag,
                })),
              );
              setNextPage(meta.has_more ? 2 : null);
              setTotal(meta.total ?? data.length);
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
  async function loadMore() {
    if (nextPage === null || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const { data, meta } = await api.matchParticipants(
        token,
        matchId,
        query,
        undefined,
        undefined,
        nextPage,
      );
      setResults((old) => {
        const seen = new Set(old.map((player) => player.player_id));
        return [
          ...old,
          ...data
            .map((p) => ({
              player_id: p.id,
              ign: p.ign,
              clan: p.clan,
              clan_tag: p.clan_tag,
            }))
            .filter((player) => !seen.has(player.player_id)),
        ];
      });
      setTotal(meta.total ?? null);
      setNextPage(meta.has_more ? nextPage + 1 : null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }
  function choose(candidate: ImportCandidate) {
    onChange((p) => ({
      ...p,
      ...candidate,
      tag: candidate.clan_tag ?? null,
      tag_conflict: false,
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
  function createProfile() {
    const name = (player.ign ?? player.name).trim();
    if (!name || exact.length) return;
    onChange((p) => ({
      ...p,
      status: "matched",
      confirmed: true,
      player_id: `new:${crypto.randomUUID()}`,
      ign: name,
      note: p.note,
    }));
    setChoosing(false);
  }
  const best = player.candidates[0];
  const needsDecision =
    !player.excluded &&
    ["suggested", "new", "ambiguous", "duplicate"].includes(player.status);
  const canCreate = !!player.name.trim() && !exact.length;
  const creationBlocked =
    searching ||
    !!error ||
    verifiedQuery !== query ||
    queryKey !== playerSearchKey(player.name);
  return (
    <li
      className={`score-import-player-review${player.excluded ? " is-skipped" : ""}${compact ? " is-compact" : ""}`}
    >
      <div className="score-import-player-top">
        <label className="score-import-include">
          <input
            type="checkbox"
            checked={!player.excluded}
            aria-label={`Include ${playerHandle(player.ign ?? player.name, player.tag ?? player.clan_tag)}`}
            onChange={(event) =>
              onChange((p) => ({ ...p, excluded: !event.target.checked }))
            }
          />
          <span>
            <strong>
              {playerHandle(
                player.ign ?? player.name,
                player.tag ?? player.clan_tag,
              )}
            </strong>
            {team && (
              <small className="score-import-player-team">
                {team.team_label}
                {team.squad?.slot_number ? ` · Slot ${team.squad.slot_number}` : ""}
                {team.squad ? ` · ${labelSquad(team.squad)}` : " · Unmapped"}
              </small>
            )}
            <small>{statusText(player)}</small>
            {player.tag_conflict && (
              <small className="score-warning">
                Read tag disagrees with the team slot. The team clan wins for a
                new profile.
              </small>
            )}
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
            aria-label={`Imported kills for ${playerHandle(player.ign ?? player.name, player.tag ?? player.clan_tag)}`}
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
        {best && !player.confirmed && (
          <button
            type="button"
            className="score-import-accept"
            onClick={() => choose(best)}
          >
            Use {playerHandle(best.ign, best.clan_tag)}
          </button>
        )}
        <button type="button" onClick={() => setChoosing(!choosing)}>
          {choosing
            ? "Close player choices"
            : player.status === "ambiguous" || player.status === "suggested"
              ? "Choose another player"
              : "Change / find player"}
        </button>
        {needsDecision && canCreate && (
          <button type="button" onClick={() => setChoosing(true)}>
            Create new profile
          </button>
        )}
        {needsDecision && compact && !noteOpen && !player.note && (
          <button type="button" onClick={() => setNoteOpen(true)}>
            Add note
          </button>
        )}
        {needsDecision && (
          <button
            type="button"
            onClick={() => onChange((p) => ({ ...p, excluded: true }))}
          >
            Skip player
          </button>
        )}
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
      {needsDecision && (!compact || noteOpen || !!player.note) && (
        <div className="score-import-insight">
          {player.match_reason || best?.match_reason ? (
            <small>
              Name lookup: {best?.match_reason ?? player.match_reason}

            </small>
          ) : (
            <small>
              No reliable registered player match. Check the full list
              before creating a profile.
            </small>
          )}
          <label>
            Decision note (optional)
            <input
              maxLength={200}
              value={player.note ?? ""}
              placeholder="Why accepted, changed or skipped"
              onChange={(event) =>
                onChange((p) => ({ ...p, note: event.target.value }))
              }
            />
          </label>
        </div>
      )}
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
                <strong>
                  {playerHandle(candidate.ign, candidate.clan_tag)}
                </strong>
                <small>
                  {candidate.clan ?? "Registered player"}
                  {candidate.squad_name ? ` · ${candidate.squad_name}` : ""}
                </small>
                {candidate.match_score ? (
                  <small>
                    {candidate.match_reason ?? "Similar registered name"}
                  </small>
                ) : null}
              </button>
            ))}
          </div>
          {nextPage !== null && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore
                ? "Loading players…"
                : `Load more players (${results.length}${
                    total === null ? "" : ` of ${total}`
                  } shown)`}
            </button>
          )}
          {nextPage === null && total !== null && total > 0 && (
            <small>
              Showing all {total} matching registered
              {total === 1 ? " player" : " players"}.
            </small>
          )}
          {canCreate && (
            <button
              type="button"
              disabled={creationBlocked}
              onClick={() => {
                if (creationBlocked) return;
                createProfile();
              }}
            >
              Create new profile on save
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
