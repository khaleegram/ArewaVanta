import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ManageEvent, MatchResultInput, ResultSheet, SavedResult } from "./api/types";
import { Shell, SignIn, tokenKey, type Session } from "./CompetitionManager";
import { disableAdminPush } from "./AdminAlerts";
import { countLabel, formatDate, scoringLabel, squadIdentity } from "./presentation";
import "./results-manager.css";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };
type Row = { present: boolean; placement: string; players: Record<string, string> };
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
    return [squad.id, { present: saved?.participation_status === "present", placement: saved?.placement?.toString() ?? "", players: Object.fromEntries((saved?.players ?? []).map((player) => [player.player_id, String(player.kills)])) }];
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
    const token = sessionStorage.getItem(tokenKey);
    if (!token) { setChecking(false); return; }
    const c = new AbortController();
    api.me(token, c.signal).then(({data}) => setSession({token, user: data})).catch((e) => { if (!c.signal.aborted) { if (e instanceof ApiError && e.status === 401) sessionStorage.removeItem(tokenKey); setAuthError(errorText(e)); } }).finally(() => { if (!c.signal.aborted) setChecking(false); });
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
  const update = (id: string, change: (row: Row) => Row) => { setRows((old) => ({...old, [id]:change(old[id])})); setNotice(""); };
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
      setSaved(result.data); setBaseline(JSON.stringify(rows)); setNotice("Results saved. Standings and player statistics are updated.");
      setSheet((current) => current?.status === "ready" ? { ...current, data: { ...current.data, result: result.data } } : current);
      setEvent((previous) => previous.status !== "ready" ? previous : {...previous, data:{...previous.data, days:previous.data.days?.map((day) => ({...day, matches:day.matches.map((match) => match.id === game ? {...match, has_results:true} : match)}))}});
    } catch (err) {
      const next: Record<string,string> = {form:errorText(err)};
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      if (err instanceof ApiError) for (const [path, messages] of Object.entries(err.errors)) {
        const match = path.match(/^results\.(\d+)(?:\.players\.(\d+)\.(?:kills|player_id)|\.(placement|players))?/);
        if (match) { const item = input[Number(match[1])]; if (item) { const key = match[2] !== undefined ? `${item.squad_id}.${item.players[Number(match[2])]?.player_id}` : `${item.squad_id}.${match[3] ?? "players"}`; next[key] = messages.join(" "); } }
        else if (path === "results") next.form = messages.join(" ");
      }
      setErrors(next);
    } finally { setSaving(false); }
  }
  async function logout() { if (dirty && !window.confirm("Discard unsaved results and sign out?")) return; if (session) { await disableAdminPush(session.token).catch(() => {}); await api.logout(session.token).catch(() => {}); } sessionStorage.removeItem(tokenKey); setSession(null); }
  return <Shell session={session} onLogout={logout}>
    {checking ? <p className="manage-notice">Checking your session…</p> : !session ? <><SignIn onSuccess={setSession}/>{authError && <p className="manage-error">{authError}</p>}</> : event.status === "loading" ? <p className="manage-notice">Loading competition…</p> : event.status === "error" ? <div className="manage-notice">{event.message} <button onClick={() => setEventRetry((x) => x+1)}>Try again</button></div> : <>
      <a className="manage-back" href={`/manage/competitions/${encodeURIComponent(event.data.id)}`}>← {event.data.title}</a>
      <div className="results-heading"><p className="manage-eyebrow">ENTER RESULTS</p><h1>{event.data.title}<span>.</span></h1><p>Select a game, then enter placements and player kills.</p></div>
      <section className="results-schedule" aria-label="Competition games">
        {(event.data.days ?? []).length === 0 && <p>No games have been configured for this competition.</p>}
        {(event.data.days ?? []).map((day) => <div className="results-day" key={day.id}><h2>{day.label ? `${day.label}, ${formatDate(day.date)}` : formatDate(day.date)}</h2><div className="results-games">{day.matches.map((match) => <button type="button" key={match.id} disabled={saving} aria-pressed={game === match.id} onClick={() => chooseGame(match.id)}><strong>Game {match.match_index}</strong><span>{match.map_label}</span><small>{match.has_results ? "Results saved" : "Results pending"}</small></button>)}</div></div>)}
      </section>
      {!game ? <p className="manage-notice">Choose a game to enter results.</p> : sheet?.status === "loading" ? <p className="manage-notice">Loading game details…</p> : sheet?.status === "error" ? <div className="manage-error" role="alert">{sheet.message} <button onClick={() => setSheetRetry((x) => x+1)}>Try again</button></div> : sheet?.status === "ready" ? <form onSubmit={save} noValidate>
        <div className="results-title"><div><p className="manage-eyebrow">{dateText(sheet.data.match.date)}</p><h2>Game {sheet.data.match.match_index} · {sheet.data.match.map_label}</h2><p>Scoring: {scoringLabel(typeof sheet.data.match.scoring.preset_name === "string" ? sheet.data.match.scoring.preset_name : null, "Custom scoring")}</p><p>Select the players who played. Leave anyone out if they didn’t play.</p></div><span>{countLabel(activeCount, "squad")} playing</span></div>
        {!sheet.data.squads.length && <p className="manage-notice">No squads are assigned to this game yet. <a href={`/manage/competitions/${encodeURIComponent(event.data.id)}/entries`}>Review squad entries and assign slots.</a></p>}
        <div className="results-list">{sheet.data.squads.map((squad) => {
          const row = rows[squad.id]; if (!row) return null;
          const score = saved?.results.find((item) => item.squad_id === squad.id && item.participation_status === "present");
          const scoringRules = sheet.data.match.scoring.rules as { mode?: string } | undefined;
          const kills = Object.values(row.players).reduce((sum, value) => sum + (/^\d+$/.test(value) ? Number(value) : 0), 0);
          return <section className={`results-squad${row.present ? " is-present" : ""}`} key={squad.id}>
            <div className="results-squad-head"><label className="results-participate"><input type="checkbox" checked={row.present} disabled={saving} onChange={(e) => update(squad.id, (old) => ({...old,present:e.target.checked}))}/><span><strong>{squadIdentity({name:squad.name,squadNumber:squad.squad_number,clanTag:squad.clan_tag,clanName:squad.clan,clanSquadCount:squad.clan_squad_count})}</strong><small>{squad.name}{squad.slot_number ? ` · Game slot ${squad.slot_number}` : ""}</small></span></label><span className="results-state">{row.present ? countLabel(kills, "kill") : "Absent"}</span></div>
            {row.present && <div className="results-squad-body"><label className="results-placement">Placement <input type="number" inputMode="numeric" min="1" max={sheet.data.event.maximum_position} value={row.placement} disabled={saving} aria-invalid={!!errors[`${squad.id}.placement`]} onChange={(e) => update(squad.id,(old) => ({...old,placement:e.target.value}))}/></label>{errors[`${squad.id}.placement`] && <p className="results-error">{errors[`${squad.id}.placement`]}</p>}
              <p className="results-label">Players who played <span>Select players and enter kills.</span></p>{!squad.eligible_players.length && <p className="results-hint">No players have been added to this squad yet.</p>}{errors[`${squad.id}.players`] && <p className="results-error">{errors[`${squad.id}.players`]}</p>}
              {squad.eligible_players.map((player) => { const selected = Object.hasOwn(row.players, player.id); const key = `${squad.id}.${player.id}`; return <div className="results-player" key={player.id}><label><input type="checkbox" checked={selected} disabled={saving} onChange={(e) => update(squad.id,(old) => {const next={...old.players}; if(e.target.checked) next[player.id]="0"; else delete next[player.id]; return {...old,players:next};})}/><span>{player.ign}</span></label>{selected && <div><label className="results-kills"><span>Kills</span><input type="number" inputMode="numeric" min="0" max="999" value={row.players[player.id]} disabled={saving} aria-invalid={!!errors[key]} onChange={(e) => update(squad.id,(old) => ({...old,players:{...old.players,[player.id]:e.target.value}}))}/></label>{errors[key] && <p className="results-error">{errors[key]}</p>}</div>}</div>; })}
              {score && !dirty && <div className="results-score">Saved score: <strong>{displayDecimal(score.total_points, scoringRules?.mode === "multiplier" ? 1 : 0)} pts</strong> · Kill points: {displayDecimal(score.kill_points ?? "0")}{score.placement_points !== null ? ` · Placement points: ${displayDecimal(score.placement_points)}` : ""}{score.placement_multiplier !== null ? ` · Placement bonus ×${displayDecimal(score.placement_multiplier, 1)}` : ""}</div>}
            </div>}
          </section>;
        })}</div>
        {errors.form && <div className="manage-error" role="alert">{errors.form}{conflict && <button type="button" onClick={() => { if (!dirty || window.confirm("Reload latest results? Your unsaved changes will be lost.")) setSheetRetry((value) => value + 1); }}>Reload latest results</button>}</div>}{Object.keys(errors).length > 0 && !errors.form && <div className="manage-error" role="alert">Check the highlighted fields before saving.</div>}{notice && <div className="manage-success" role="status">{notice}</div>}
        <div className="results-save"><span>{dirty ? "Unsaved changes" : saved ? "All changes saved" : "Ready to enter results"}</span><button className="manage-primary" type="submit" disabled={saving || !sheet.data.squads.length}>{saving ? "Saving…" : "Save results"}</button></div>
      </form> : null}
    </>}
  </Shell>;
}
