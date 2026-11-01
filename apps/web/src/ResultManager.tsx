import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ManageEvent, MatchResultInput, ResultSheet, SavedResult } from "./api/types";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { countLabel, formatDate, scoringLabel, squadIdentity } from "./presentation";
import { Icon } from "./ui";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };
type Row = { present: boolean; placement: string; teamKills: string; players: Record<string, string> };
type Rows = Record<string, Row>;
const errorText = (e: unknown) => e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
function displayDecimal(value: string | null, minimumScale = 0) {
  if (value === null) return "—";
  const [whole, fraction = ""] = value.split(".");
  const digits = fraction.replace(/0+$/, "").padEnd(minimumScale, "0");
  return digits ? `${whole}.${digits}` : whole;
}
function fromSheet(sheet: ResultSheet): Rows {
  return Object.fromEntries(sheet.squads.map((squad) => {
    const saved = sheet.result?.results.find((row) => row.squad_id === squad.id);
    return [squad.id, { present: saved?.participation_status === "present", placement: saved?.placement?.toString() ?? "", teamKills: String(saved?.team_kills ?? 0), players: Object.fromEntries((saved?.players ?? []).map((player) => [player.player_id, String(player.kills)])) }];
  }));
}
function dateText(date: string) {
  return formatDate(date, { weekday: true });
}
export default function ResultManager({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [event, setEvent] = useState<Load<ManageEvent>>({ status: "loading" });
  const [eventRetry, setEventRetry] = useState(0);
  const [game, setGame] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Load<ResultSheet> | null>(null);
  const [sheetRetry, setSheetRetry] = useState(0);
  const [rows, setRows] = useState<Rows>({});
  const [baseline, setBaseline] = useState("");
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const dirty = !!baseline && JSON.stringify(rows) !== baseline;
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    const c = new AbortController();
    api.me(token, c.signal).then(({data}) => setSession({token, user: data})).catch((e) => { if (!c.signal.aborted) { if (e instanceof ApiError && e.status === 401) clearStoredToken(); setAuthError(errorText(e)); } }).finally(() => { if (!c.signal.aborted) setChecking(false); });
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const c = new AbortController(); setEvent({status:"loading"});
    api.manageEvent(session.token, eventId, c.signal).then(({data}) => setEvent({status:"ready", data})).catch((e) => { if (!c.signal.aborted) setEvent({status:"error", message:errorText(e)}); });
    return () => c.abort();
  }, [session?.token, eventId, eventRetry]);
  useEffect(() => {
    if (!session || !game) return;
    const c = new AbortController(); setSheet({status:"loading"}); setNotice(""); setErrors({}); setBaseline(""); setConflict(false);
    api.resultSheet(session.token, game, c.signal).then(({data}) => { const initial = fromSheet(data); setRows(initial); setBaseline(JSON.stringify(initial)); setSaved(data.result); setSheet({status:"ready", data}); }).catch((e) => { if (!c.signal.aborted) setSheet({status:"error", message:errorText(e)}); });
    return () => c.abort();
  }, [session?.token, game, sheetRetry]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const activeCount = useMemo(() => Object.values(rows).filter((row) => row.present).length, [rows]);
  const totalGames = event.status === "ready" ? (event.data.days ?? []).reduce((total, day) => total + day.matches.length, 0) : 0;
  const completedGames = event.status === "ready" ? (event.data.days ?? []).reduce((total, day) => total + day.matches.filter((match) => match.has_results).length, 0) : 0;
  const update = (id: string, change: (row: Row) => Row) => { setRows((old) => ({...old, [id]:change(old[id])})); setNotice(""); };
  const setParticipationForAll = (present: boolean) => {
    setRows((old) => Object.fromEntries(Object.entries(old).map(([id, row]) => [id, { ...row, present }])));
    setNotice("");
    setErrors({});
  };
  function chooseGame(id: string) {
    if (id === game || saving) return;
    if (dirty && !window.confirm("Discard unsaved changes and switch games?")) return;
    setGame(id);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !game || sheet?.status !== "ready" || saving) return;
    const issues: Record<string,string> = {}; const placements = new Map<number,string>(); const players = new Map<string,string>();
    const input: MatchResultInput[] = [];
    for (const squad of sheet.data.squads) {
      const row = rows[squad.id]; if (!row?.present) continue;
      const position = Number(row.placement);
      if (!row.placement || !Number.isInteger(position) || position < 1 || position > sheet.data.event.maximum_position) issues[`${squad.id}.placement`] = `Enter a placement from 1 to ${sheet.data.event.maximum_position}.`;
      else if (placements.has(position)) { issues[`${squad.id}.placement`] = "Placement is already used."; issues[`${placements.get(position)}.placement`] = "Placement is already used."; } else placements.set(position, squad.id);
      if (!sheet.data.event.track_player_kills) {
        if (!/^\d+$/.test(row.teamKills) || Number(row.teamKills) > 999) issues[`${squad.id}.team_kills`] = "Enter squad kills from 0 to 999.";
        input.push({ squad_id: squad.id, status: "present", placement: position, team_kills: Number(row.teamKills), players: [] });
        continue;
      }
      const selected = Object.entries(row.players);
      if (!selected.length) issues[`${squad.id}.players`] = "Select at least one participating player.";
      if (selected.length > 10) issues[`${squad.id}.players`] = "Select no more than 10 players.";
      const resultPlayers = selected.map(([id,kills]) => {
        if (!squad.eligible_players.some((player) => player.id === id)) issues[`${squad.id}.players`] = "A selected player is no longer eligible.";
        if (players.has(id)) { issues[`${squad.id}.players`] = "A player can only represent one squad in a game."; issues[`${players.get(id)}.players`] = "A player can only represent one squad in a game."; } else players.set(id,squad.id);
        if (!/^\d+$/.test(kills) || Number(kills) > 999) issues[`${squad.id}.${id}`] = "Enter kills from 0 to 999.";
        return {player_id:id, kills:Number(kills)};
      });
      input.push({squad_id:squad.id, status:"present", placement:position, players:resultPlayers});
    }
    if (!input.length) issues.form = "Select at least one participating squad.";
    setErrors(issues);
    if (Object.keys(issues).length) { setNotice(""); return; }
    setSaving(true); setNotice("");
    try {
      const scoringVersion = typeof sheet.data.match.scoring.version_id === "string" ? sheet.data.match.scoring.version_id : null;
      const result = await api.saveResults(session.token, game, input, sheet.data.result?.lock_version ?? null, scoringVersion);
      setSaved(result.data); setBaseline(JSON.stringify(rows)); setNotice(sheet.data.event.track_player_kills ? "Results saved. Standings and player statistics are updated." : "Results saved. Squad standings are updated.");
      setSheet((current) => current?.status === "ready" ? { ...current, data: { ...current.data, result: result.data } } : current);
      setEvent((previous) => previous.status !== "ready" ? previous : {...previous, data:{...previous.data, days:previous.data.days?.map((day) => ({...day, matches:day.matches.map((match) => match.id === game ? {...match, has_results:true} : match)}))}});
    } catch (err) {
      const next: Record<string,string> = {form:errorText(err)};
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      if (err instanceof ApiError) for (const [path, messages] of Object.entries(err.errors)) {
        const match = path.match(/^results\.(\d+)(?:\.players\.(\d+)\.(?:kills|player_id)|\.(placement|players|team_kills))?/);
        if (match) { const item = input[Number(match[1])]; if (item) { const key = match[2] !== undefined ? `${item.squad_id}.${item.players[Number(match[2])]?.player_id}` : `${item.squad_id}.${match[3] ?? "players"}`; next[key] = messages.join(" "); } }
        else if (path === "results") next.form = messages.join(" ");
      }
      setErrors(next);
    } finally { setSaving(false); }
  }
  async function logout() { if (dirty && !window.confirm("Discard unsaved results and sign out?")) return; if (session) { await disableAdminPush(session.token).catch(() => {}); await api.logout(session.token).catch(() => {}); } clearStoredToken(); setSession(null); }
  return <Shell session={session} onLogout={logout}>
    {checking ? <p className="manage-notice">Checking your session…</p> : !session ? <><SignIn onSuccess={setSession}/>{authError && <p className="manage-error">{authError}</p>}</> : event.status === "loading" ? <p className="manage-notice">Loading competition…</p> : event.status === "error" ? <div className="manage-notice">{event.message} <button onClick={() => setEventRetry((x) => x+1)}>Try again</button></div> : <div className="results-workspace">
      <a className="results-back" href={`/manage/competitions/${encodeURIComponent(event.data.id)}`}><Icon name="arrow" /> Competition workspace</a>
      <header className="results-hero">
        <div className="results-hero-copy"><p className="results-eyebrow">ORGANIZER DESK <span /> RESULTS</p><h1>Enter results<span>.</span></h1><p>Turn the match screen into a clean, accurate squad scorecard.</p><div className="results-event-name"><Icon name="trophy" /><strong>{event.data.title}</strong><span>{event.data.track_player_kills ? "Player kills on" : "Squad kills + placement"}</span></div></div>
        <div className="results-event-progress"><span>RESULTS RECORDED</span><strong>{completedGames}<small> / {totalGames}</small></strong><div><i style={{ width: `${totalGames ? Math.min(100, completedGames / totalGames * 100) : 0}%` }} /></div><small>games completed</small></div>
      </header>
      <section className="results-schedule" aria-labelledby="results-schedule-title">
        <div className="results-section-heading"><div><span>01 <i /> MATCH SCHEDULE</span><h2 id="results-schedule-title">Choose a game</h2></div><p>{countLabel(totalGames, "game")} · {countLabel(completedGames, "result")} saved</p></div>
        {(event.data.days ?? []).length === 0 && <p className="results-empty">No games are scheduled yet.</p>}
        <div className="results-day-list">{(event.data.days ?? []).map((day) => <div className="results-day" key={day.id}><h3>{day.label ? `${day.label} · ${formatDate(day.date)}` : formatDate(day.date)}</h3><div className="results-games">{day.matches.map((match) => <button type="button" key={match.id} disabled={saving} aria-pressed={game === match.id} onClick={() => chooseGame(match.id)}><span className="results-game-number">{String(match.match_index).padStart(2, "0")}</span><span className="results-game-info"><strong>Game {match.match_index}</strong><small>{match.map_label}</small></span><span className={`results-game-status${match.has_results ? " is-saved" : ""}`}>{match.has_results ? "Saved" : "Enter"}</span></button>)}</div></div>)}</div>
      </section>
      {!game ? <div className="results-prompt"><span><Icon name="target" /></span><div><strong>Pick a game to get started</strong><p>Games with saved results are marked above. You can reopen any game and update its score.</p></div></div> : sheet?.status === "loading" ? <div className="results-prompt"><span className="results-spinner" /><div><strong>Loading match card…</strong><p>Getting squads and saved scores.</p></div></div> : sheet?.status === "error" ? <div className="manage-error" role="alert">{sheet.message} <button onClick={() => setSheetRetry((x) => x+1)}>Try again</button></div> : sheet?.status === "ready" ? <form className="results-entry" onSubmit={save} noValidate>
        <div className="results-match-banner"><span className="results-match-mark">{String(sheet.data.match.match_index).padStart(2, "0")}</span><div className="results-match-copy"><p>{dateText(sheet.data.match.date)} <i /> {scoringLabel(typeof sheet.data.match.scoring.preset_name === "string" ? sheet.data.match.scoring.preset_name : null, "Custom scoring")}</p><h2>{sheet.data.match.map_label}<small>Game {sheet.data.match.match_index}</small></h2><span>{sheet.data.event.track_player_kills ? "Choose the players who competed, then add their kills." : "Add each squad’s placement and total team kills."}</span></div><div className="results-match-tally"><strong>{activeCount}<small> / {sheet.data.squads.length}</small></strong><span>squads playing</span></div></div>
        {!sheet.data.squads.length && <p className="results-empty">No squads are assigned to this game. <a href={`/manage/competitions/${encodeURIComponent(event.data.id)}/entries`}>Assign game slots</a></p>}
        {!!sheet.data.squads.length && <>
          <div className="results-list-heading"><div><span>02 <i /> SCORECARD</span><h2>Squad results</h2><p>Mark who played, then enter their match results.</p></div><div className="results-attendance-actions"><button type="button" disabled={saving} onClick={() => setParticipationForAll(true)}>All played</button><button type="button" disabled={saving} onClick={() => setParticipationForAll(false)}>Clear all</button></div></div>
          <div className={`results-list${sheet.data.event.track_player_kills ? " has-individual-kills" : " has-squad-kills"}`}>{sheet.data.squads.map((squad, index) => {
            const row = rows[squad.id]; if (!row) return null;
            const score = saved?.results.find((item) => item.squad_id === squad.id && item.participation_status === "present");
            const scoringRules = sheet.data.match.scoring.rules as { mode?: string } | undefined;
            const kills = !sheet.data.event.track_player_kills ? Number(row.teamKills) || 0 : Object.values(row.players).reduce((sum, value) => sum + (/^\d+$/.test(value) ? Number(value) : 0), 0);
            const identity = squadIdentity({name:squad.name,squadNumber:squad.squad_number,clanTag:squad.clan_tag,clanName:squad.clan,clanSquadCount:squad.clan_squad_count});
            return <article className={`results-squad${row.present ? " is-present" : ""}`} key={squad.id}>
              <div className="results-squad-head"><span className="results-slot">{squad.slot_number ?? index + 1}<small>SLOT</small></span><div className="results-squad-identity"><strong>{identity}</strong><span>{squad.name}{squad.slot_number ? ` · Game slot ${squad.slot_number}` : ""}</span></div><label className="results-attendance"><input type="checkbox" checked={row.present} disabled={saving} onChange={(e) => update(squad.id, (old) => ({...old,present:e.target.checked}))}/><span>{row.present ? "Playing" : "Absent"}</span></label></div>
              {row.present && <div className="results-squad-body">
                <div className="results-number-fields"><label className="results-number-field"><span>Placement</span><div><input type="number" inputMode="numeric" min="1" max={sheet.data.event.maximum_position} placeholder="—" value={row.placement} disabled={saving} aria-invalid={!!errors[`${squad.id}.placement`]} onChange={(e) => update(squad.id,(old) => ({...old,placement:e.target.value}))}/><small>of {sheet.data.event.maximum_position}</small></div>{errors[`${squad.id}.placement`] && <small className="results-error">{errors[`${squad.id}.placement`]}</small>}</label>
                  {!sheet.data.event.track_player_kills && <label className="results-number-field"><span>Team kills</span><div><input type="number" inputMode="numeric" min="0" max="999" placeholder="0" value={row.teamKills} disabled={saving} aria-invalid={!!errors[`${squad.id}.team_kills`]} onChange={(e) => update(squad.id, (old) => ({ ...old, teamKills: e.target.value }))}/><small>total</small></div>{errors[`${squad.id}.team_kills`] && <small className="results-error">{errors[`${squad.id}.team_kills`]}</small>}</label>}
                  <div className="results-points-preview"><span>Match points</span><strong>{score && !dirty ? `${displayDecimal(score.total_points, scoringRules?.mode === "multiplier" ? 1 : 0)} <small>pts</small>` : "—"}</strong></div>
                </div>
                {!sheet.data.event.track_player_kills && <p className="results-input-hint">Kills from the full squad. Player names are not needed for this competition.</p>}
                {sheet.data.event.track_player_kills && <div className="results-roster"><div className="results-roster-heading"><strong>Players in this match</strong><span>{countLabel(Object.keys(row.players).length, "player")} selected</span></div>{!squad.eligible_players.length && <p className="results-input-hint">No players have been added to this squad yet.</p>}{errors[`${squad.id}.players`] && <p className="results-error">{errors[`${squad.id}.players`]}</p>}{squad.eligible_players.map((player) => { const selected = Object.hasOwn(row.players, player.id); const key = `${squad.id}.${player.id}`; return <div className={`results-player${selected ? " is-selected" : ""}`} key={player.id}><label><input type="checkbox" checked={selected} disabled={saving} onChange={(e) => update(squad.id,(old) => {const next={...old.players}; if(e.target.checked) next[player.id]="0"; else delete next[player.id]; return {...old,players:next};})}/><span>{player.ign}</span></label>{selected && <label className="results-player-kills"><span>Kills</span><input type="number" inputMode="numeric" min="0" max="999" placeholder="0" value={row.players[player.id]} disabled={saving} aria-invalid={!!errors[key]} onChange={(e) => update(squad.id,(old) => ({...old,players:{...old.players,[player.id]:e.target.value}}))}/>{errors[key] && <small className="results-error">{errors[key]}</small>}</label>}</div>; })}</div>}
                {score && !dirty && <div className="results-score-breakdown"><Icon name="check" /><span>Saved breakdown</span><strong>{displayDecimal(score.kill_points ?? "0")} kill pts</strong>{score.placement_points !== null && <strong>{displayDecimal(score.placement_points)} placement pts</strong>}{score.placement_multiplier !== null && <strong>×{displayDecimal(score.placement_multiplier, 1)} placement bonus</strong>}</div>}
              </div>}
            </article>;
          })}</div>
        </>}
        {errors.form && <div className="manage-error" role="alert">{errors.form}{conflict && <button type="button" onClick={() => { if (!dirty || window.confirm("Reload latest results? Your unsaved changes will be lost.")) setSheetRetry((value) => value + 1); }}>Reload latest results</button>}</div>}{Object.keys(errors).length > 0 && !errors.form && <div className="manage-error" role="alert">Check the highlighted fields before saving.</div>}{notice && <div className="manage-success" role="status">{notice}</div>}
        <div className="results-save"><div><span className={`results-save-indicator${dirty ? " is-dirty" : ""}`} /><div><strong>{dirty ? "Changes not saved" : saved ? "All changes saved" : "Ready to enter"}</strong><small>{countLabel(activeCount, "squad")} playing · {sheet.data.event.track_player_kills ? "player kills" : "team kills + placement"}</small></div></div><button className="manage-primary" type="submit" disabled={saving || !dirty || !sheet.data.squads.length}>{saving ? "Saving results…" : "Save results"}<Icon name="check" /></button></div>
      </form> : null}
    </div>}
  </Shell>;
}
