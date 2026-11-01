import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ManageEvent, MatchResultInput, ResultSheet, SavedResult, MatchParticipant } from "./api/types";
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
    return [squad.id, { present: saved?.participation_status === "present", placement: saved?.placement?.toString() ?? "", teamKills: (saved?.team_kills_override ?? (saved && saved.team_kills_override === undefined ? saved.team_kills : null))?.toString() ?? "", players: Object.fromEntries((saved?.players ?? []).map((player) => [player.player_id, player.kills?.toString() ?? ""])) }];
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
  const [game, setGame] = useState<string | null>(() => new URLSearchParams(window.location.search).get("match"));
  const [sheet, setSheet] = useState<Load<ResultSheet> | null>(null);
  const [sheetRetry, setSheetRetry] = useState(0);
  const [rows, setRows] = useState<Rows>({});
  const [extraPlayers, setExtraPlayers] = useState<Record<string, { id: string; ign: string }[]>>({});
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
    if (!session || !game || event.status !== "ready") return;
    if (!(event.data.days ?? []).some((day) => day.matches.some((match) => match.id === game))) {
      setSheet({ status: "error", message: "This game is not part of this competition. Choose a game from the schedule." });
      return;
    }
    const c = new AbortController(); setSheet({status:"loading"}); setNotice(""); setErrors({}); setBaseline(""); setConflict(false);
    api.resultSheet(session.token, game, c.signal).then(({data}) => { const initial = fromSheet(data); setRows(initial); setBaseline(JSON.stringify(initial)); setSaved(data.result); setExtraPlayers({}); setSheet({status:"ready", data}); }).catch((e) => { if (!c.signal.aborted) setSheet({status:"error", message:errorText(e)}); });
    return () => c.abort();
  }, [session?.token, game, sheetRetry, event.status, eventId]);
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
    const url = new URL(window.location.href);
    url.searchParams.set("match", id);
    window.history.replaceState(null, "", url);
  }
  async function save(e?: React.FormEvent, mergeLatest = false) {
    e?.preventDefault();
    if (!session || !game || sheet?.status !== "ready" || saving) return;
    const issues: Record<string, string> = {};
    const original: Rows = baseline ? JSON.parse(baseline) : {};
    const input: MatchResultInput[] = [];
    for (const squad of sheet.data.squads) {
      const row = rows[squad.id];
      if (!row || JSON.stringify(row) === JSON.stringify(original[squad.id])) continue;
      if (!row.present) { input.push({ squad_id: squad.id, status: "absent", players: [] }); continue; }
      if (row.placement && (!/^\d+$/.test(row.placement) || +row.placement < 1 || +row.placement > 100)) issues[`${squad.id}.placement`] = "Use a placement from 1 to 100, or leave it blank.";
      if (row.teamKills && (!/^\d+$/.test(row.teamKills) || +row.teamKills > 999)) issues[`${squad.id}.team_kills`] = "Use a total from 0 to 999, or leave it blank.";
      const candidates = [...squad.eligible_players, ...(extraPlayers[squad.id] ?? [])];
      const players = Object.entries(row.players).map(([id, kills]) => {
        if (kills && (!/^\d+$/.test(kills) || +kills > 999)) issues[`${squad.id}.${id}`] = "Use kills from 0 to 999, or leave blank for unknown.";
        return { ...(id.startsWith("new:") ? { ign: candidates.find((player) => player.id === id)?.ign } : { player_id: id }), kills: kills === "" ? null : Number(kills) };
      });
      input.push({ squad_id: squad.id, status: "present", placement: row.placement ? Number(row.placement) : null, team_kills: row.teamKills === "" ? null : Number(row.teamKills), players });
    }
    setErrors(issues);
    if (Object.keys(issues).length) return;
    setSaving(true); setNotice("");
    try {
      const latest = mergeLatest ? (await api.resultSheet(session.token, game)).data : sheet.data;
      const scoringVersion = typeof latest.match.scoring.version_id === "string" ? latest.match.scoring.version_id : null;
      const result = await api.saveResults(session.token, game, input, latest.result?.lock_version ?? null, scoringVersion);
      const next = { ...latest, result: result.data, squads: latest.squads.map((squad) => ({ ...squad, eligible_players: [...new Map([...squad.eligible_players, ...(result.data.results.find((row) => row.squad_id === squad.id)?.players ?? []).map((player) => ({ id: player.player_id, ign: player.ign }))].map((player) => [player.id, player])).values()] })) };
      const nextRows = fromSheet(next);
      setRows(nextRows); setBaseline(JSON.stringify(nextRows)); setExtraPlayers({}); setSaved(result.data); setSheet({ status: "ready", data: next }); setConflict(false);
      const partial = result.data.results.filter((row) => row.is_partial).length;
      setNotice(`Saved. Standings and player profiles are updated.${partial ? ` ${partial} squad${partial === 1 ? " has" : "s have"} details to fill in later.` : ""}`);
      setEvent((previous) => previous.status !== "ready" ? previous : { ...previous, data: { ...previous.data, days: previous.data.days?.map((day) => ({ ...day, matches: day.matches.map((match) => match.id === game ? { ...match, has_results: true } : match) })) } });
    } catch (err) {
      setConflict(err instanceof ApiError && err.status === 409);
      setErrors({ form: errorText(err) });
    } finally { setSaving(false); }
  }
  function selectParticipant(squadId: string, player: { id: string; ign: string }) {
    setExtraPlayers((previous) => ({ ...previous, [squadId]: [...(previous[squadId] ?? []).filter((item) => item.id !== player.id), player] }));
    setRows((previous) => Object.fromEntries(Object.entries(previous).map(([id, row]) => {
      const players = { ...row.players };
      const existingKills = Object.values(previous).find((other) => Object.hasOwn(other.players, player.id))?.players[player.id];
      if (id === squadId) players[player.id] ??= existingKills ?? "";
      else delete players[player.id];
      return [id, { ...row, players }];
    })));
    setNotice("");
  }
  async function logout() { if (dirty && !window.confirm("Discard unsaved results and sign out?")) return; if (session) { await disableAdminPush(session.token).catch(() => {}); await api.logout(session.token).catch(() => {}); } clearStoredToken(); setSession(null); }
  return <Shell session={session} onLogout={logout}>
    {checking ? <p className="manage-notice">Checking your session…</p> : !session ? <><SignIn onSuccess={setSession}/>{authError && <p className="manage-error">{authError}</p>}</> : event.status === "loading" ? <p className="manage-notice">Loading competition…</p> : event.status === "error" ? <div className="manage-notice">{event.message} <button onClick={() => setEventRetry((x) => x+1)}>Try again</button></div> : <div className="results-workspace">
      <a className="results-back" href={`/manage/competitions/${encodeURIComponent(event.data.id)}`}><Icon name="arrow" /> Competition workspace</a>
      <header className="results-hero">
        <div className="results-hero-copy"><p className="results-eyebrow">ORGANIZER DESK <span /> RESULTS</p><h1>Enter results<span>.</span></h1><p>Turn the match screen into a clean, accurate squad scorecard.</p><div className="results-event-name"><Icon name="trophy" /><strong>{event.data.title}</strong><span>Player stats included</span></div></div>
        <div className="results-event-progress"><span>RESULTS RECORDED</span><strong>{completedGames}<small> / {totalGames}</small></strong><div><i style={{ width: `${totalGames ? Math.min(100, completedGames / totalGames * 100) : 0}%` }} /></div><small>games completed</small></div>
      </header>
      <section className="results-schedule" aria-labelledby="results-schedule-title">
        <div className="results-section-heading"><div><span>01 <i /> MATCH SCHEDULE</span><h2 id="results-schedule-title">Choose a game</h2></div><p>{countLabel(totalGames, "game")} · {countLabel(completedGames, "result")} saved</p></div>
        {(event.data.days ?? []).length === 0 && <p className="results-empty">No games are scheduled yet.</p>}
        <div className="results-day-list">{(event.data.days ?? []).map((day) => <div className="results-day" key={day.id}><h3>{day.label ? `${day.label} · ${formatDate(day.date)}` : formatDate(day.date)}</h3><div className="results-games">{day.matches.map((match) => <button type="button" key={match.id} disabled={saving} aria-pressed={game === match.id} onClick={() => chooseGame(match.id)}><span className="results-game-number">{String(match.match_index).padStart(2, "0")}</span><span className="results-game-info"><strong>Game {match.match_index}</strong><small>{match.map_label}</small></span><span className={`results-game-status${match.has_results ? " is-saved" : ""}`}>{match.has_results ? "Saved" : "Enter"}</span></button>)}</div></div>)}</div>
      </section>
      {!game ? <div className="results-prompt"><span><Icon name="target" /></span><div><strong>Pick a game to get started</strong><p>Games with saved results are marked above. You can reopen any game and update its score.</p></div></div> : sheet?.status === "loading" ? <div className="results-prompt"><span className="results-spinner" /><div><strong>Loading match card…</strong><p>Getting squads and saved scores.</p></div></div> : sheet?.status === "error" ? <div className="manage-error" role="alert">{sheet.message} <button onClick={() => setSheetRetry((x) => x+1)}>Try again</button></div> : sheet?.status === "ready" ? <form className="results-entry" onSubmit={(event) => { void save(event); }} noValidate>
        <div className="results-match-banner"><span className="results-match-mark">{String(sheet.data.match.match_index).padStart(2, "0")}</span><div className="results-match-copy"><p>{dateText(sheet.data.match.date)} <i /> {scoringLabel(typeof sheet.data.match.scoring.preset_name === "string" ? sheet.data.match.scoring.preset_name : null, "Custom scoring")}</p><h2>{sheet.data.match.map_label}<small>Game {sheet.data.match.match_index}</small></h2><span>Record what you know. Add players, swap substitutes, and finish details anytime.</span></div><div className="results-match-tally"><strong>{activeCount}<small> / {sheet.data.squads.length}</small></strong><span>squads playing</span></div></div>
        {!sheet.data.squads.length && <p className="results-empty">No squads are assigned to this game. <a href={`/manage/competitions/${encodeURIComponent(event.data.id)}/entries`}>Assign game slots</a></p>}
        {!!sheet.data.squads.length && <>
          <div className="results-list-heading"><div><span>02 <i /> SCORECARD</span><h2>Squad results</h2><p>Mark who played, then enter their match results.</p></div><div className="results-attendance-actions"><button type="button" disabled={saving} onClick={() => setParticipationForAll(true)}>All played</button><button type="button" disabled={saving} onClick={() => setParticipationForAll(false)}>Clear all</button></div></div>
          <div className="results-list has-individual-kills">{sheet.data.squads.map((squad, index) => {
            const row = rows[squad.id]; if (!row) return null;
            const score = saved?.results.find((item) => item.squad_id === squad.id && item.participation_status === "present");
            const scoringRules = sheet.data.match.scoring.rules as { mode?: string } | undefined;
            const kills = Object.values(row.players).reduce((sum, value) => sum + (/^\d+$/.test(value) ? Number(value) : 0), 0);
            const identity = squadIdentity({name:squad.name,squadNumber:squad.squad_number,clanTag:squad.clan_tag,clanName:squad.clan,clanSquadCount:squad.clan_squad_count});
            return <article className={`results-squad${row.present ? " is-present" : ""}`} key={squad.id}>
              <div className="results-squad-head"><span className="results-slot">{squad.slot_number ?? index + 1}<small>SLOT</small></span><div className="results-squad-identity"><strong>{identity}</strong><span>{squad.name}{squad.slot_number ? ` · Game slot ${squad.slot_number}` : ""}</span></div><label className="results-attendance"><input type="checkbox" checked={row.present} disabled={saving} onChange={(e) => update(squad.id, (old) => ({...old,present:e.target.checked}))}/><span>{row.present ? "Playing" : "Absent"}</span></label></div>
              {row.present && <div className="results-squad-body">
                <div className="results-number-fields"><label className="results-number-field"><span>Placement</span><div><input type="number" inputMode="numeric" min="1" max="100" placeholder="—" value={row.placement} disabled={saving} aria-invalid={!!errors[`${squad.id}.placement`]} onChange={(e) => update(squad.id,(old) => ({...old,placement:e.target.value}))}/><small>of {sheet.data.event.maximum_position}</small></div>{errors[`${squad.id}.placement`] && <small className="results-error">{errors[`${squad.id}.placement`]}</small>}</label>
                  <label className="results-number-field"><span>Known team total (optional)</span><div><input type="number" inputMode="numeric" min="0" max="999" placeholder="Auto from players" value={row.teamKills} disabled={saving} aria-invalid={!!errors[`${squad.id}.team_kills`]} onChange={(e) => update(squad.id, (old) => ({ ...old, teamKills: e.target.value }))}/><small>total</small></div>{errors[`${squad.id}.team_kills`] && <small className="results-error">{errors[`${squad.id}.team_kills`]}</small>}</label>
                  <div className="results-points-preview"><span>Match points</span><strong>{score && !dirty ? `${displayDecimal(score.total_points, scoringRules?.mode === "multiplier" ? 1 : 0)} <small>pts</small>` : "—"}</strong></div>
                </div>
                <p className="results-input-hint">{kills} kills credited to players{row.teamKills !== "" ? ` · ${Math.max(kills, +row.teamKills || 0)} team kills` : ""}. Blank fields stay unknown. {+row.teamKills > kills ? `${+row.teamKills - kills} team kills still need player details.` : row.teamKills !== "" && +row.teamKills < kills ? "Player kills exceed the entered total; their sum will be used. Clear the total to calculate automatically." : ""}</p>
                {row.placement && Object.entries(rows).some(([id, other]) => id !== squad.id && other.present && other.placement === row.placement) && <p className="results-input-hint">This placement is shared with another squad. You can save and correct it later.</p>}
                <div className="results-roster">
                  <div className="results-roster-heading"><strong>Actual players in this game</strong><span>{countLabel(Object.keys(row.players).length, "player")} selected</span></div>
                  {!Object.keys(row.players).length && <p className="results-input-hint">Player details can be added later. Saving is available now.</p>}
                  {[...new Map([...squad.eligible_players, ...(extraPlayers[squad.id] ?? [])].map((player) => [player.id, player])).values()].map((player) => {
                    const selected = Object.hasOwn(row.players, player.id); const key = `${squad.id}.${player.id}`;
                    return <div className={`results-player${selected ? " is-selected" : ""}`} key={player.id}>
                      <label><input type="checkbox" checked={selected} disabled={saving} onChange={(e) => {
                        if (e.target.checked) selectParticipant(squad.id, player);
                        else update(squad.id, (old) => { const players = { ...old.players }; delete players[player.id]; return { ...old, players }; });
                      }} /><span>{player.ign}</span></label>
                      {selected && <label className="results-player-kills"><span>Kills</span><input type="number" inputMode="numeric" min="0" max="999" placeholder="?" aria-label={`Kills for ${player.ign}`} value={row.players[player.id]} disabled={saving} aria-invalid={!!errors[key]} onChange={(e) => update(squad.id, (old) => ({ ...old, players: { ...old.players, [player.id]: e.target.value } }))} />{errors[key] && <small className="results-error">{errors[key]}</small>}</label>}
                      {!player.id.startsWith("new:") && <a className="results-profile-link" href={`/players/${encodeURIComponent(player.id)}`} target="_blank" rel="noreferrer" aria-label={`Public profile for ${player.ign}`}><Icon name="arrow" /></a>}
                    </div>;
                  })}
                  <ParticipantPicker token={session.token} matchId={game!} clanId={squad.clan_id} disabled={saving} onSelect={(player) => selectParticipant(squad.id, player)} />
                </div>
                {score && !dirty && <div className="results-score-breakdown"><Icon name="check" /><span>Saved breakdown</span><strong>{displayDecimal(score.kill_points ?? "0")} kill pts</strong>{score.placement_points !== null && <strong>{displayDecimal(score.placement_points)} placement pts</strong>}{score.placement_multiplier !== null && <strong>×{displayDecimal(score.placement_multiplier, 1)} placement bonus</strong>}</div>}
              </div>}
            </article>;
          })}</div>
        </>}
        {errors.form && <div className="manage-error" role="alert">{errors.form}{conflict && <><p>Your edits are still here. Save your changed squads onto the latest sheet, keeping other squads’ updates.</p><button type="button" disabled={saving} onClick={() => { void save(undefined, true); }}>Save my changed squads</button><button type="button" onClick={() => { if (window.confirm("Discard your unsaved edits and load the latest sheet?")) setSheetRetry((value) => value + 1); }}>Discard my edits & reload</button></>}</div>}{Object.keys(errors).length > 0 && !errors.form && <div className="manage-error" role="alert">Check the highlighted fields before saving.</div>}{notice && <div className="manage-success" role="status">{notice}</div>}
        <div className="results-save"><div><span className={`results-save-indicator${dirty ? " is-dirty" : ""}`} /><div><strong>{dirty ? "Changes not saved" : saved ? "All changes saved" : "Ready to enter"}</strong><small>{countLabel(activeCount, "squad")} playing · partial saves welcome</small></div></div><button className="manage-primary" type="submit" disabled={saving || !dirty || !sheet.data.squads.length}>{saving ? "Saving results…" : "Save results"}<Icon name="check" /></button></div>
      </form> : null}
    </div>}
  </Shell>;
}

function ParticipantPicker({ token, matchId, clanId, disabled, onSelect }: { token: string; matchId: string; clanId: string; disabled: boolean; onSelect: (player: { id: string; ign: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<MatchParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      api.matchParticipants(token, matchId, search.trim(), search.trim() ? undefined : clanId, controller.signal)
        .then(({ data, meta }) => { setPlayers(data); setHasMore(meta.has_more); })
        .catch((error) => { if (!controller.signal.aborted) { setPlayers([]); setError(errorText(error)); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [token, matchId, clanId, search, open]);
  function choose(player: { id: string; ign: string }) { onSelect(player); setOpen(false); setSearch(""); }
  return <div className="results-participant-picker">
    <button type="button" className="results-add-player" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="plus" />{open ? "Close player picker" : "Add / change actual player"}</button>
    {open && <div className="results-participant-panel">
      <label>Player name (no tag needed)<input type="search" autoFocus maxLength={100} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder="Search a player or type a new name" /></label>
      <p>{search.trim() ? "Existing players across clans. Picking a substitute changes this game only." : "Your clan’s players. Search to find a substitute from any clan."} Selecting a player already in this game moves them to this squad.</p>
      {loading ? <p role="status">Finding players…</p> : error ? <p role="alert">{error}</p> : <ul>{players.map((player) => <li key={player.id}><button type="button" disabled={disabled} onClick={() => choose(player)}><span><strong>{player.ign}</strong><small>{player.clan ?? "Independent player"}</small></span><Icon name="plus" /></button></li>)}</ul>}
      {!loading && !error && !players.length && <p>No matching players. You can create their public profile below.</p>}
      {hasMore && <p>More players available. Type more of their name to narrow the list.</p>}
      {search.trim() && <button className="results-create-player" type="button" disabled={disabled} onClick={() => choose({ id: `new:${crypto.randomUUID()}`, ign: search.trim() })}><Icon name="plus" />New player: {search.trim()}</button>}
      <small>A new player’s public profile is created when you save results. No account or squad registration needed.</small>
    </div>}
  </div>;
}
