import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ClanMonthlyReport as Report, MonthlyPlayer } from "./api/types";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { Icon } from "./ui";
import { formatDate } from "./presentation";
import { usePageSeo } from "./seo";
import "./clan-monthly-report.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Report };
type Tab = "overview" | "squads" | "players" | "matches";
const tabs: Tab[] = ["overview", "squads", "players", "matches"];
const initialMonth = () => {
  const supplied = new URLSearchParams(window.location.search).get("month");
  if (supplied && /^\d{4}-(0[1-9]|1[0-2])$/.test(supplied)) return supplied;
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Lagos", month: "2-digit", year: "numeric" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
};
const number = (value: number | string | null) => value === null ? "—" : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value));
function csvDownload(name: string, rows: (string | number | null)[][]) {
  const csv = rows.map((row) => row.map((value) => {
    let text = value === null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ClanMonthlyReport({ clanId }: { clanId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [report, setReport] = useState<Load>({ status: "loading" });
  const [month, setMonth] = useState(initialMonth);
  const [refresh, setRefresh] = useState(0);
  const [squadId, setSquadId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  usePageSeo({ title: "Monthly clan report | ArewaVanta", description: "Clan and squad performance reports.", path: `/manage/clans/${clanId}/reports`, noIndex: true });
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    const controller = new AbortController();
    api.me(token, controller.signal).then(({ data }) => setSession({ token, user: data })).catch((error) => {
      if (!controller.signal.aborted) { if (error instanceof ApiError && error.status === 401) clearStoredToken(); setAuthError(error instanceof ApiError ? error.message : "Couldn’t check your session."); }
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(); setReport({ status: "loading" });
    api.clanMonthlyReport(session.token, clanId, month, controller.signal).then(({ data }) => setReport({ status: "ready", data })).catch((error) => {
      if (!controller.signal.aborted) setReport({ status: "error", message: error instanceof ApiError ? error.message : "Couldn’t load this report." });
    });
    const url = new URL(window.location.href); url.searchParams.set("month", month); window.history.replaceState(null, "", url);
    return () => controller.abort();
  }, [session?.token, clanId, month, refresh]);
  async function logout() {
    if (session) { await disableAdminPush(session.token).catch(() => {}); await api.logout(session.token).catch(() => {}); }
    clearStoredToken(); setSession(null); setReport({ status: "loading" });
  }
  const data = report.status === "ready" ? report.data : null;
  const squad = data?.squads.find((squad) => squad.id === squadId);
  const summary = squad?.summary ?? data?.summary;
  const previous = squad?.previous ?? data?.previous;
  const players = squad?.players ?? data?.players ?? [];
  const squads = squad ? [squad] : data?.squads ?? [];
  const matches = squads.flatMap((squad) => squad.matches.map((match) => ({ ...match, squad: squad.name, squadNumber: squad.number, squadId: squad.id }))).sort((a, b) => b.date.localeCompare(a.date) || b.game - a.game || a.squadNumber - b.squadNumber);
  const maxPoints = Math.max(1, ...(data?.timeline.map((day) => Number(day.summary.points)) ?? []));
  function shiftMonth(delta: number) {
    const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 1 + delta, 1));
    setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return <Shell section="directory" session={session} onLogout={logout}>
    {checking ? <p className="manage-notice">Checking your session…</p> : !session ? <><SignIn onSuccess={setSession} />{authError && <p role="alert">{authError}</p>}</> : <div className="monthly-page">
      <div className="monthly-toolbar"><a href="/manage/directory">← Clans & players</a><div><button type="button" disabled={!data} onClick={() => setRefresh((value) => value + 1)}>Refresh</button><button type="button" disabled={!data} onClick={() => window.print()}><Icon name="print" />Print / Save PDF</button></div></div>
      <header className="monthly-hero"><div className="monthly-brand"><img src="/favicon.svg" alt="" /><strong>arewavanta<span>.</span></strong><span>PERFORMANCE LAB</span></div><p>THE MONTH IN PLAY</p><h1>{data?.clan.name ?? "Clan performance"}<span>.</span></h1><div><span>{data?.month_label ?? month}</span><span>{squad ? squad.name : "All squads"}</span><span>Monthly report</span></div></header>
      <div className="monthly-controls"><div className="monthly-month"><button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>←</button><label>Report month<input type="month" value={month} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} /></label><button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>→</button></div><label>Squad<select value={squadId} onChange={(event) => setSquadId(event.target.value)}><option value="">All squads</option>{data?.squads.map((squad) => <option key={squad.id} value={squad.id}>{squad.name}</option>)}</select></label><span>Latest saved scores. Updates appear on refresh.</span></div>
      {report.status === "loading" && <p className="manage-notice" role="status">Building your monthly report…</p>}
      {report.status === "error" && <div className="manage-error" role="alert">{report.message}<button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div>}
      {data && summary && previous && <>
        <nav className="monthly-tabs" aria-label="Report sections">{tabs.map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <section className={`monthly-section${tab === "overview" ? " is-active" : ""}`} aria-label="Monthly overview">
          <div className="monthly-kpis"><Metric label="TOTAL POINTS" value={summary.points} before={previous.points} /><Metric label="TEAM KILLS" value={summary.kills} before={previous.kills} /><Metric label="WINS" value={summary.wins} before={previous.wins} /><Metric label="SQUAD APPEARANCES" value={summary.appearances} before={previous.appearances} /></div>
          <p className="monthly-comparison-note">Changes compared with {data.previous_month_label}. {summary.games} games across {summary.match_days} match days · {summary.players} players recorded.</p>
          {!summary.appearances && <div className="monthly-empty"><Icon name="calendar" /><h2>No played matches recorded this month.</h2><p>Choose a different month, or save match results. No scores are invented for unrecorded games.</p></div>}
          <div className="monthly-overview-grid"><section className="monthly-card"><header><span>CONSISTENCY</span><h2>Beyond the total</h2></header><dl className="monthly-facts"><div><dt>Win rate</dt><dd>{summary.win_rate === null ? "—" : `${summary.win_rate}%`}</dd></div><div><dt>Top 3 finishes</dt><dd>{summary.top_three}</dd></div><div><dt>Average placement</dt><dd>{number(summary.average_placement)}</dd></div><div><dt>Kills per squad appearance</dt><dd>{number(summary.average_kills)}</dd></div><div><dt>Best placement</dt><dd>{summary.best_placement === null ? "—" : `#${summary.best_placement}`}</dd></div><div><dt>Highest squad kills in a game</dt><dd>{number(summary.best_game_kills)}</dd></div><div><dt>Recorded absences</dt><dd>{summary.absences}</dd></div></dl></section>
          <section className="monthly-card"><header><span>DATA COVERAGE</span><h2>Room to fill in</h2></header><div className="monthly-coverage"><strong>{summary.appearances ? Math.round((summary.appearances - summary.partial_results) / summary.appearances * 100) : 0}<small>%</small></strong><span>played squad results with placement and named player kills complete</span></div><progress aria-label="Complete result details" value={summary.appearances - summary.partial_results} max={Math.max(1, summary.appearances)} /><dl className="monthly-facts"><div><dt>Results with missing details</dt><dd>{summary.partial_results}</dd></div><div><dt>Team kills not credited to players</dt><dd>{summary.unattributed_kills}</dd></div><div><dt>Missing placements</dt><dd>{summary.missing_placements}</dd></div><div><dt>Player scores still unknown</dt><dd>{summary.unknown_player_scores}</dd></div></dl><p className="monthly-muted">Partial results are included. Unknown player kills stay blank. You can finish details in the result manager at any time.</p></section></div>
          <section className="monthly-card monthly-chart"><header><span>MATCH-DAY FORM · ALL CLAN SQUADS</span><h2>Points through the month</h2></header>{data.timeline.length ? <div className="monthly-bars">{data.timeline.map((day) => <div key={day.date}><span>{formatDate(day.date)}</span><div className="monthly-bar-track"><i style={{ width: `${Math.max(Number(day.summary.points) ? 2 : 0, Number(day.summary.points) / maxPoints * 100)}%` }} /></div><strong>{number(day.summary.points)} <small>pts</small></strong><small>{day.summary.kills} kills · {day.summary.wins} wins</small></div>)}</div> : <p className="monthly-muted">The chart appears after match results are saved.</p>}</section>
          <section className="monthly-card"><header><span>COMPETITION BREAKDOWN · ALL CLAN SQUADS</span><h2>Where the month happened</h2></header><div className="monthly-competitions">{data.competitions.map((event) => <a key={event.id} href={`/competitions/${encodeURIComponent(event.slug)}`}><span><strong>{event.title}</strong><small>{event.summary.appearances} squad appearances · {event.summary.kills} kills</small></span><b>{number(event.summary.points)} pts</b></a>)}{!data.competitions.length && <p>No recorded competitions this month.</p>}</div></section>
        </section>
        <section className={`monthly-section${tab === "squads" ? " is-active" : ""}`} aria-label="Squad comparison"><div className="monthly-section-title"><div><p>SQUAD COMPARISON</p><h2>Each squad’s contribution</h2></div><span>Sorted by points</span></div><div className="monthly-squads">{squads.map((squad) => <article className="monthly-card" key={squad.id}><header><span>SQUAD {String(squad.number).padStart(2, "0")}</span><h2>{squad.name}</h2><a href={`/squads/${encodeURIComponent(squad.slug)}`}>Public squad profile ↗</a></header><div className="monthly-squad-score"><strong>{number(squad.summary.points)}<small>points</small></strong><span>{squad.summary.kills} kills · {squad.summary.wins} wins</span></div><dl className="monthly-facts"><div><dt>Appearances</dt><dd>{squad.summary.appearances}</dd></div><div><dt>Average placement</dt><dd>{number(squad.summary.average_placement)}</dd></div><div><dt>Kills per appearance</dt><dd>{number(squad.summary.average_kills)}</dd></div><div><dt>Players used</dt><dd>{squad.summary.players}</dd></div></dl><p className="monthly-muted">Previous month: {number(squad.previous.points)} pts · {squad.previous.kills} kills · {squad.previous.appearances} appearances</p><div className="monthly-mini-players">{squad.players.slice(0, 3).map((player) => <a key={player.id} href={`/players/${player.id}`}><span>{player.ign}</span><b>{player.kills} kills</b></a>)}</div></article>)}</div></section>
        <section className={`monthly-section${tab === "players" ? " is-active" : ""}`} aria-label="Monthly player statistics"><div className="monthly-section-title"><div><p>INDIVIDUAL IMPACT</p><h2>Players who made it happen</h2></div><button type="button" className="monthly-export" onClick={() => csvDownload(`${data.clan.slug}-${month}-players.csv`, [["Player", "Appearances", "Games with kills recorded", "Kills", "Average kills (recorded games)", "Best game", "Wins"], ...players.map((player) => [player.ign, player.appearances, player.recorded_games, player.kills, player.average_kills, player.best_game, player.wins])])}>Export player CSV</button></div><PlayerTable players={players} /><p className="monthly-muted">Includes substitutes who played for these squads. Average kills uses only games with a recorded player score. A blank score is never treated as zero.</p></section>
        <section className={`monthly-section${tab === "matches" ? " is-active" : ""}`} aria-label="Monthly match ledger"><div className="monthly-section-title"><div><p>EVERY GAME, ACCOUNTED FOR</p><h2>Match ledger</h2></div><button type="button" className="monthly-export" onClick={() => csvDownload(`${data.clan.slug}-${month}-matches.csv`, [["Date", "Competition", "Squad", "Game", "Map", "Status", "Placement", "Known team kills", "Kills confirmed", "Points", "Player kills"], ...matches.map((match) => [match.date, match.event, match.squad, match.game, match.map, match.status, match.placement, match.kills, match.kills_confirmed ? "Yes" : "No", match.points, match.players.map((player) => `${player.ign}: ${player.kills ?? "unknown"}`).join("; ")])])}>Export match CSV</button></div><div className="monthly-ledger">{matches.map((match) => <article key={`${match.id}-${match.squadId}`}><div><span className="monthly-ledger-date">{formatDate(match.date)}</span><strong>{match.squad} · Game {match.game}</strong><small>{match.event} · {match.map}</small></div><div className="monthly-ledger-score">{match.status === "absent" ? <span>Absent</span> : <><span>#{match.placement ?? "?"}</span><span>{match.kills_confirmed ? match.kills : `${match.kills}+`} kills</span><strong>{number(match.points)} pts</strong></>}</div>{match.players.length > 0 && <div className="monthly-ledger-players">{match.players.map((player) => <a key={player.id} href={`/players/${player.id}`}>{player.ign}<b>{player.kills ?? "?"}</b></a>)}</div>}<a className="monthly-edit-result" href={`/manage/competitions/${encodeURIComponent(match.event_id)}/results?match=${encodeURIComponent(match.id)}`}>Edit game →</a></article>)}{!matches.length && <p className="monthly-empty">No saved match rows in this selection.</p>}</div></section>
        <footer className="monthly-method"><strong>How this report is calculated</strong><ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul><span>ArewaVanta · {data.month_label} · Generated {new Date(data.generated_at).toLocaleString("en-NG", { timeZone: data.timezone })} WAT</span></footer>
      </>}
    </div>}
  </Shell>;
}
function Metric({ label, value, before }: { label: string; value: string | number; before: string | number }) {
  const change = Number(value) - Number(before);
  return <article><span>{label}</span><strong>{number(value)}</strong><small className={change > 0 ? "is-up" : ""}>{change > 0 ? "↗ +" : change < 0 ? "↘ " : "— "}{change === 0 ? "No change" : number(change)}<span>vs previous month</span></small></article>;
}
function PlayerTable({ players }: { players: MonthlyPlayer[] }) {
  return <div className="monthly-table-wrap"><table className="monthly-player-table"><thead><tr><th scope="col">Player</th><th scope="col">Games</th><th scope="col">Kills</th><th scope="col">Avg.</th><th scope="col">Best</th><th scope="col">Wins</th></tr></thead><tbody>{players.map((player, index) => <tr key={player.id}><th scope="row"><a href={`/players/${player.id}`}><small>{String(index + 1).padStart(2, "0")}</small><span>{player.ign}{player.recorded_games < player.appearances && <em>{player.appearances - player.recorded_games} scores pending</em>}</span></a></th><td>{player.appearances}</td><td><strong>{player.kills}</strong></td><td>{number(player.average_kills)}</td><td>{number(player.best_game)}</td><td>{player.wins}</td></tr>)}{!players.length && <tr><td colSpan={6}>No named participants recorded this month.</td></tr>}</tbody></table></div>;
}
