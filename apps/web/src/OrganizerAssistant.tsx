import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api/client";
import type { ManageEvent } from "./api/types";
import type { AssistantCsv, AssistantEvidence, AssistantMessage, AssistantMessageInput, AssistantProposal, AssistantProposalEdit, AssistantScore, AssistantThread, AssistantThreadSummary } from "./assistantTypes";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { formatDate } from "./presentation";
import "./organizer-assistant.css";

const explain = (error: unknown) => error instanceof ApiError
  ? [...new Set([error.message, ...Object.values(error.errors).flat()])].slice(0, 3).join(" ")
  : error instanceof Error ? error.message : "Could not complete that request. Please try again.";
const unknown = (value: number | string | null | undefined) => value ?? "Unknown";
const isCsvUpload = (file: File) => /\.csv$/i.test(file.name);
function openReviewDestination(data: AssistantThread) {
  location.replace(`/manage/competitions/${encodeURIComponent(data.event_id)}/assistant?thread=${encodeURIComponent(data.id)}`);
}

export default function OrganizerAssistant({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    const controller = new AbortController();
    api.me(token, controller.signal).then(({ data }) => setSession({ token, user: data }))
      .catch((e) => { if (!controller.signal.aborted) { if (e instanceof ApiError && e.status === 401) clearStoredToken(); setError(explain(e)); } })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  async function logout() {
    if (session) {
      await disableAdminPush(session.token).catch(() => {});
      await api.logout(session.token).catch(() => {});
    }
    clearStoredToken(); setSession(null);
  }
  return <Shell session={session} onLogout={logout}>
    {checking ? <p className="manage-notice">Checking your session…</p>
      : !session ? <><SignIn onSuccess={setSession} />{error && <p className="manage-error">{error}</p>}</>
      : <AssistantDesk key={`${session.user.id}:${eventId}`} token={session.token} eventId={eventId} />}
  </Shell>;
}

function AssistantDesk({ token, eventId }: { token: string; eventId: string }) {
  const [event, setEvent] = useState<ManageEvent | null>(null);
  const [threads, setThreads] = useState<AssistantThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(() => new URLSearchParams(location.search).get("thread"));
  const [thread, setThread] = useState<AssistantThread | null>(null);
  const [matchId, setMatchId] = useState(() => new URLSearchParams(location.search).get("match") || "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(!!threadId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [proof, setProof] = useState<AssistantEvidence | null>(null);
  const [retry, setRetry] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const dataVersion = useRef(0);
  const blocked = busy || !!thread?.processing || opening;
  const matches = (event?.days ?? []).flatMap((day) => day.matches.map((match) => ({ ...match, date: day.date, dayLabel: day.label })));
  const validMatch = matchId === "" || matches.some((m) => m.id === matchId);
  const matchLink = `/manage/competitions/${encodeURIComponent(eventId)}/results`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    Promise.all([api.manageEvent(token, eventId, controller.signal), api.assistantThreads(token, eventId, controller.signal)])
      .then(([competition, chats]) => { setEvent(competition.data); setThreads(chats.data); })
      .catch((e) => { if (!controller.signal.aborted) setError(explain(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, eventId, retry]);

  useEffect(() => {
    if (!threadId) { setThread(null); setOpening(false); return; }
    const controller = new AbortController();
    const version = dataVersion.current;
    setOpening(true);
    api.assistantThread(token, threadId, controller.signal).then(({ data }) => {
      if (data.event_id !== eventId) { openReviewDestination(data); return; }
      if (version === dataVersion.current) setThread(data);
    }).catch((e) => { if (!controller.signal.aborted) { setThread(null); setError(explain(e)); } })
      .finally(() => { if (!controller.signal.aborted) setOpening(false); });
    return () => controller.abort();
  }, [token, eventId, threadId]);

  useEffect(() => {
    if (!thread?.processing) return;
    const controller = new AbortController();
    const version = dataVersion.current;
    const timer = setTimeout(() => {
      api.assistantThread(token, thread.id, controller.signal).then(({ data }) => { if (version === dataVersion.current) setThread(data); })
        .catch((e) => { if (!controller.signal.aborted) { setError(explain(e)); setThread((old) => old ? { ...old, processing: false } : old); } });
    }, 3000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [thread, token]);

  useEffect(() => {
    if (!threadId) return;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "visible" || sending.current) return;
      const version = dataVersion.current;
      api.assistantThread(token, threadId, controller.signal).then(({ data }) => { if (version === dataVersion.current) setThread(data); }).catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); controller.abort(); };
  }, [token, threadId]);

  useEffect(() => {
    const latest = thread?.messages.at(-1);
    if (latest?.role !== "assistant") return;
    document.getElementById(`assistant-turn-${latest.id}`)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [thread?.messages.at(-1)?.id]);

  function updateUrl(id: string | null, match = matchId) {
    const url = new URL(location.href);
    if (id) url.searchParams.set("thread", id); else url.searchParams.delete("thread");
    if (match) url.searchParams.set("match", match); else url.searchParams.delete("match");
    history.replaceState(null, "", url);
  }
  function chooseThread(id: string) {
    setError(""); setNotice(""); setProof(null);
    setThreadId(id || null); updateUrl(id || null);
  }
  function remember(data: AssistantThread) {
    if (data.event_id !== eventId) { openReviewDestination(data); return; }
    dataVersion.current++;
    setThread(data);
    setThreads((old) => [{ id: data.id, title: data.title, updated_at: new Date().toISOString() }, ...old.filter((item) => item.id !== data.id)]);
  }
  async function send(input: AssistantMessageInput) {
    if (sending.current || blocked || !validMatch) return;
    sending.current = true; setBusy(true); setError(""); setNotice("");
    let id = threadId;
    try {
      if (!id) {
        const { data } = await api.createAssistantThread(token, eventId);
        id = data.id; setThreadId(id); remember(data); updateUrl(id);
      }
      const { data } = await api.sendAssistantMessage(token, id, input);
      remember(data); setText(""); setFiles([]);
      setNotice("Review saved. Results change only when you accept a correction below.");
    } catch (e) {
      setError(explain(e));
      if (id) {
        await api.assistantThread(token, id).then(({ data }) => {
          remember(data);
          if (data.messages.some((m) => m.client_id === input.client_id)) { setText(""); setFiles([]); }
        }).catch(() => {});
      }
    } finally { sending.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && !files.length) return;
    void send({ client_id: crypto.randomUUID(), message: text.trim(), match_id: matchId || null, images: files.filter((file) => !isCsvUpload(file)), csv_files: files.filter(isCsvUpload) });
  }
  async function edit(proposal: AssistantProposal, edits: AssistantProposalEdit[]) {
    if (!thread || sending.current || blocked) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const { data } = await api.editAssistantProposal(token, thread.id, proposal.id, edits);
      remember(data);
      setNotice("Edits applied. Check the updated preview and standings, then accept.");
    } catch (e) { setError(explain(e)); }
    finally { sending.current = false; setBusy(false); }
  }
  async function decide(proposal: AssistantProposal, decision: "accept" | "reject" | "undo") {
    if (!thread || sending.current || blocked) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const { data } = await api.decideAssistantProposal(token, thread.id, proposal.id, decision);
      remember(data);
      setNotice(decision === "accept" ? "Accepted and saved. Open the latest results to view current scores." : decision === "undo" ? "Change undone. Everything it touched is back as it was." : "Proposal rejected. Nothing was changed.");
    } catch (e) { setError(explain(e)); }
    finally { sending.current = false; setBusy(false); }
  }
  function attach(selected: FileList | null) {
    if (!selected) return;
    const next = [...files, ...Array.from(selected)];
    if (next.length > 8) { setError("Attach up to eight files per message. You can send more in a follow-up."); return; }
    if (next.filter(isCsvUpload).length > 2) { setError("Attach up to two CSV files per message."); return; }
    if (next.some((file) => isCsvUpload(file) ? file.size > 1024 * 1024 : !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError("Use CSV files up to 1 MB or JPEG, PNG and WebP images up to 5 MB each."); return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { setError("Keep this message's files under 20 MB."); return; }
    setFiles(next); setError("");
  }
  const evidenceNumber = (id: string) => (thread?.evidence.findIndex((e) => e.id === id) ?? -1) + 1;
  function proofButtons(ids: string[]) {
    return ids.map((id) => {
      const item = thread?.evidence.find((e) => e.id === id);
      return item ? <button className="assistant-proof-link" type="button" key={id} onClick={() => setProof(item)}>{item.csv ? "CSV · " : ""}Proof {evidenceNumber(id)}{item.csv ? ` · ${item.csv.row_count} rows` : ""}</button> : null;
    });
  }
  function retryMessage(message: AssistantMessage) {
    if (!message.client_id) return;
    void send({ client_id: message.client_id, message: message.content, match_id: message.details?.match_id, recheck_evidence_ids: message.details?.read_evidence_ids });
  }

  if (loading) return <p className="manage-notice">Loading organizer assistant…</p>;
  if (!event) return <p className="manage-error" role="alert">{error || "Could not load this competition."} <button onClick={() => setRetry((n) => n + 1)}>Retry</button></p>;
  return <div className="assistant-page">
    <a className="score-back" href={`/manage/competitions/${encodeURIComponent(eventId)}`}>← {event.title}</a>
    <header className="assistant-heading">
      <div><p className="assistant-eyebrow">ORGANIZER ASSISTANT</p><h1>Review it together<span>.</span></h1><p>Describe the issue. Add proof. Review a ruling and accept exact corrections.</p></div>
      <a href={`${matchLink}${matchId ? `?match=${encodeURIComponent(matchId)}` : ""}`} target="_blank" rel="noreferrer">Open Match desk ↗</a>
    </header>
    <p className="assistant-destination"><span>Score destination</span><strong>{(event.days ?? []).map((day) => formatDate(day.date)).join(" / ")}</strong><small>Tell the assistant if this review belongs to another weekend. Your files stay with the review.</small></p>
    <div className="assistant-controls">
      <label>Review<select value={threadId ?? ""} disabled={blocked} onChange={(e) => chooseThread(e.target.value)}><option value="">New review</option>{threadId && !threads.some((item) => item.id === threadId) && <option value={threadId}>{thread?.title || "Linked review"}</option>}{threads.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Game context<select value={validMatch ? matchId : ""} disabled={blocked} onChange={(e) => { setMatchId(e.target.value); updateUrl(threadId, e.target.value); }}><option value="">Compare this competition</option>{matches.map((match) => <option key={match.id} value={match.id}>{formatDate(match.date)} · G{match.match_index} · {match.map_label}</option>)}</select></label>
    </div>
    <p className="assistant-context-note">Reads saved results, assigned slots, scoring rules and player profiles. Reviews and proof stay saved to your account across devices. Unsaved Match desk drafts stay on that device.</p>
    {!validMatch && <p className="manage-error" role="alert">The linked game is not in this competition. Choose the correct game context.</p>}
    {opening ? <p className="manage-notice">Opening saved review…</p> : <div className="assistant-conversation" aria-label="Review conversation">
      {!thread?.messages.length && <section className="assistant-welcome"><h2>What needs checking?</h2><p>Upload a weekly CSV or screenshots to check scores, players and slots against saved results.</p><div className="assistant-welcome-actions"><button type="button" disabled={blocked} onClick={() => { setText("These players dispute their individual and team kills. Compare the attached proof with saved results, explain any differences and propose the supported corrections. Ask me about any uncertain game or slot."); composer.current?.focus(); }}>Review a score dispute</button><button type="button" disabled={blocked} onClick={() => { setText(`Prepare an import of the attached CSV into the games on ${(event.days ?? []).map((day) => day.date).join(" and ")}. Check game/slot mappings, duplicates and player/team kills. Search the full directory, reuse existing players and propose profiles for genuinely missing players. Preserve known team totals and leave uncertain details unknown. Show one review of all supported games for my acceptance.`); composer.current?.focus(); }}>Enter weekly CSV</button></div></section>}
      {thread?.messages.map((message) => <article className={`assistant-message assistant-message-${message.role}`} id={`assistant-turn-${message.id}`} key={message.id}>
        <p className="assistant-message-author">{message.role === "user" ? "You" : "Assistant"}</p>
        <div className="assistant-message-text">{message.content}</div>
        {!!message.details?.read_evidence_ids?.length && <div className="assistant-proof-links">{proofButtons(message.details.read_evidence_ids)}</div>}
        {!!message.details?.duplicate_uploads?.length && <p className="assistant-context-note">Repeated uploads linked to the same saved proof: {message.details.duplicate_uploads.join(", ")}. They count once.</p>}
        {message.details?.ruling && <section className="assistant-ruling"><h3>Suggested ruling</h3><p>{message.details.ruling}</p></section>}
        {!!message.details?.findings?.length && <details className="assistant-findings"><summary>Evidence and uncertainties ({message.details.findings.length})</summary><ul>{[...message.details.findings].sort((a, b) => Number(b.kind === "unresolved") - Number(a.kind === "unresolved")).map((finding, index) => <li key={index}><span className={`assistant-finding-kind is-${finding.kind}`}>{finding.kind === "observed" ? "Visible in proof / saved data" : finding.kind === "inferred" ? "Inferred" : "Needs a decision"}</span><p>{finding.text}</p><div className="assistant-proof-links">{proofButtons(finding.evidence_ids)}</div></li>)}</ul></details>}
        {message.details?.warnings?.map((warning, index) => <p className="assistant-warning" key={index}>{warning}</p>)}
        {thread.proposals.filter((p) => p.message_id === message.id).map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} disabled={blocked} proofButtons={proofButtons} onAccept={() => void decide(proposal, "accept")} onReject={() => void decide(proposal, "reject")} onUndo={() => void decide(proposal, "undo")} onEdit={(edits) => void edit(proposal, edits)} resultUrl={`${matchLink}?match=${encodeURIComponent(proposal.match_id)}`} />)}
        {message.role === "user" && message.status !== "completed" && !thread.processing && <button type="button" disabled={blocked} onClick={() => retryMessage(message)}>Retry this saved message</button>}
      </article>)}
      {(busy || thread?.processing) && <p className="assistant-working" role="status">Reviewing saved data and proof… You can return to this review on either device.</p>}
    </div>}
    {notice && <p className="assistant-notice" role="status">{notice}</p>}
    {error && <p className="assistant-warning" role="alert">{error}</p>}
    <form className="assistant-composer" onSubmit={submit} aria-label="Message the organizer assistant">
      <label htmlFor="assistant-message">Your message</label>
      <textarea id="assistant-message" ref={composer} value={text} maxLength={12000} disabled={blocked} onChange={(e) => setText(e.target.value)} placeholder="Tell me what looks wrong, or ask about these results…" rows={2} />
      {!!files.length && <ul className="assistant-attachments">{files.map((file, index) => <Attachment key={`${file.name}:${index}`} file={file} disabled={blocked} onRemove={() => setFiles((old) => old.filter((_, i) => i !== index))} />)}</ul>}
      <div className="assistant-composer-actions"><label className="assistant-attach">＋ Add files<input type="file" multiple accept=".csv,text/csv,image/jpeg,image/png,image/webp" disabled={blocked} onChange={(e) => { attach(e.target.files); e.target.value = ""; }} /></label><span>{files.length ? `${files.length}/8 files` : "CSV or screenshots"}</span><button className="assistant-primary" disabled={blocked || !validMatch || (!text.trim() && !files.length)}>{blocked ? "Working…" : "Send"}</button></div>
    </form>
    {proof && thread && <ProofDialog key={proof.id} token={token} threadId={thread.id} evidence={proof} number={evidenceNumber(proof.id)} onClose={() => setProof(null)} disabled={blocked} onRecheck={() => { const { id, csv } = proof; setProof(null); void send({ client_id: crypto.randomUUID(), message: csv ? "Review this CSV against the latest saved results again. Verify game and slot linkage, repeated rows, missing values, and player versus team totals. Explain any changes from your previous review." : "Re-read this image carefully. Check the exact digits, match linkage and slot, and compare against the latest saved results. Explain any changes from your previous reading.", match_id: matchId || null, recheck_evidence_ids: [id] }); }} />}
  </div>;
}

function ProposalCard({ proposal, disabled, proofButtons, onAccept, onReject, onUndo, onEdit, resultUrl }: { proposal: AssistantProposal; disabled: boolean; proofButtons: (ids: string[]) => React.ReactNode; onAccept: () => void; onReject: () => void; onUndo: () => void; onEdit: (edits: AssistantProposalEdit[]) => void; resultUrl: string }) {
  const pending = proposal.status === "pending";
  return <section className={`assistant-proposal is-${proposal.status}`} aria-label="Proposed result correction">
    <div className="assistant-proposal-heading"><h3>{proposal.title}</h3><span>{pending ? "Awaiting your acceptance" : proposal.status === "accepted" ? "Accepted & saved" : proposal.status === "undone" ? "Undone" : proposal.status === "superseded" ? "Replaced by a newer review" : "Rejected"}</span></div>
    <p className="assistant-message-text">{proposal.reason}</p>
    {proposal.preview.kind === "admin_action" ? <AdminActionChanges proposal={proposal} /> : proposal.preview.kind === "csv_import" ? <CsvImportChanges proposal={proposal} /> : pending ? <ScoreChanges proposal={proposal} /> : <details><summary>View proposed changes</summary><ScoreChanges proposal={proposal} /></details>}
    {!!proposal.preview.standings?.rows.length && <StandingsImpact standings={proposal.preview.standings} />}
    {pending && !proposal.preview.kind && <EditProposal proposal={proposal} disabled={disabled} onEdit={onEdit} />}
    <div className="assistant-proof-links">{proofButtons(proposal.preview.evidence_ids)}</div>
    {pending && <div className="assistant-proposal-actions"><button type="button" className="assistant-primary" disabled={disabled} onClick={onAccept}>{proposal.preview.kind === "admin_action" ? `Accept & apply ${proposal.preview.items?.length ?? 0} changes` : proposal.preview.kind === "csv_import" ? `Accept & save ${proposal.preview.games?.length ?? 0} games` : "Accept & update results"}</button><button type="button" disabled={disabled} onClick={onReject}>Reject</button></div>}
    {proposal.status === "accepted" && proposal.preview.kind !== "csv_import" && <div className="assistant-proposal-actions"><button type="button" disabled={disabled} onClick={onUndo}>Undo this change</button></div>}
    {proposal.status === "accepted" && proposal.preview.kind !== "admin_action" && <a href={resultUrl} target="_blank" rel="noreferrer">View updated results ↗</a>}
  </section>;
}

function AdminActionChanges({ proposal }: { proposal: AssistantProposal }) {
  const { items = [], warnings = [] } = proposal.preview;
  return <div className="assistant-import-review">
    <ul className="assistant-admin-items">{items.map((item, index) => <li key={index}><strong>{item.label}</strong><br /><span>{item.before}</span> → <strong>{item.after}</strong>{item.note && <small><br />{item.note}</small>}</li>)}</ul>
    {!!warnings.length && <details className="assistant-import-issues" open><summary>{warnings.length} to review</summary>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    <p className="assistant-context-note">Nothing changes until you accept. If someone else edits these records first, the acceptance is refused and you can ask for a fresh review.</p>
  </div>;
}

function CsvImportChanges({ proposal }: { proposal: AssistantProposal }) {
  const preview = proposal.preview;
  return <div className="assistant-import-review">
    <p><strong>{preview.games?.length} games · {preview.team_count} team entries</strong><br />Known team totals stay intact while incomplete player details remain unattributed.</p>
    {!!preview.slot_changes?.length && <section className="assistant-import-slots"><h4>Slot allocation changes included</h4>{preview.slot_changes.map((change) => <p key={change.slot}>Slot {change.slot}: <span>{change.before}</span> → <strong>{change.after}</strong></p>)}<small>Permanent allocation and these weekends: {preview.affected_weeks?.map((week) => formatDate(week.date)).join(", ")}. Other historical weekends stay as saved.</small></section>}
    {!!preview.omitted_players?.length && <details className="assistant-import-issues"><summary>{preview.omitted_players.length} excluded or unresolved appearances · totals retained</summary><ul>{preview.omitted_players.map((player, index) => <li key={index}><strong>{player.name}</strong> · record {player.record}<br />{player.reason}</li>)}</ul></details>}
    {!!preview.warnings?.length && <details className="assistant-import-issues"><summary>Review {preview.warnings.length} data warnings</summary>{preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    {!!preview.new_players?.length && <details><summary>{preview.new_players.length} new player profiles proposed after directory search</summary><ul>{preview.new_players.map((player, index) => <li key={index}>{player.ign}{player.clan_id === null ? " · clan unknown" : ""}</li>)}</ul><p className="assistant-context-note">Created only when you accept. Existing players keep their permanent clan.</p></details>}
    <div className="assistant-import-games">{preview.games?.map((game) => <details key={game.match_id}><summary>{game.title}<small>{game.rows.length} team changes · {game.rows.reduce((sum, row) => sum + (row.after.team_kills ?? 0), 0)} team kills</small></summary><ScoreChanges proposal={{ ...proposal, preview: { evidence_ids: preview.evidence_ids, rows: game.rows } }} /></details>)}</div>
    <p className="assistant-context-note">Acceptance saves all changes shown here together. If another organizer has edited these games or slots since this review, refresh the proposal first.</p>
  </div>;
}

function StandingsImpact({ standings }: { standings: NonNullable<AssistantProposal["preview"]["standings"]> }) {
  const arrow = (before: number | null, after: number) => before === null ? "new" : after < before ? `▲ ${before - after}` : after > before ? `▼ ${after - before}` : "–";
  return <details className="assistant-standings" open><summary>Standings impact · {standings.scope} · {standings.rows.length} of {standings.teams} teams move or score</summary>
    <table><thead><tr><th>Team</th><th>Rank</th><th>Points</th></tr></thead><tbody>{standings.rows.map((row) => <tr key={row.squad_id}>
      <th>{row.clan}{row.slot !== null ? ` · slot ${row.slot}` : ""}</th>
      <td>{row.before_rank ?? "–"} → <strong>{row.after_rank}</strong> <small>{arrow(row.before_rank, row.after_rank)}</small></td>
      <td>{Number(row.before_points)} → <strong>{Number(row.after_points)}</strong></td></tr>)}</tbody></table>
    <p className="assistant-context-note">Calculated with this competition&apos;s real scoring and tie-break rules. Nothing is saved until you accept.</p></details>;
}

function EditProposal({ proposal, disabled, onEdit }: { proposal: AssistantProposal; disabled: boolean; onEdit: (edits: AssistantProposalEdit[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, AssistantProposalEdit>>({});
  const num = (value: string) => value.trim() === "" ? null : Math.max(0, Math.floor(Number(value)));
  const set = (squadId: string, patch: Partial<AssistantProposalEdit>) => setDraft((current) => ({ ...current, [squadId]: { ...current[squadId], squad_id: squadId, ...patch } }));
  const setPlayer = (squadId: string, player: AssistantScore["players"][number], patch: { kills?: number | null; remove?: boolean }) => setDraft((current) => {
    const existing = current[squadId]?.players ?? [];
    const key = player.player_id || null;
    const same = (p: { player_id?: string | null; ign?: string | null }) => (p.player_id ?? null) === key && (p.ign ?? null) === (key ? null : player.ign);
    const previous = existing.find(same);
    return { ...current, [squadId]: { ...current[squadId], squad_id: squadId, players: [...existing.filter((p) => !same(p)), { player_id: key, ign: key ? null : player.ign, ...previous, ...patch }] } };
  });
  if (!open) return <button type="button" className="assistant-edit-toggle" disabled={disabled} onClick={() => setOpen(true)}>Edit before accepting</button>;
  const edits = Object.values(draft);
  return <section className="assistant-edit-panel" aria-label="Edit proposal">
    <h4>Edit before accepting</h4>
    {proposal.preview.rows.map((row) => <fieldset key={row.squad_id}><legend>Slot {row.slot ?? "?"} · {row.clan}</legend>
      <label>Placement <input type="number" min={1} max={100} defaultValue={row.after.placement ?? ""} disabled={disabled} onChange={(e) => set(row.squad_id, { placement: num(e.target.value) })} /></label>
      <label>Team kills <input type="number" min={0} max={999} defaultValue={row.after.team_kills ?? ""} disabled={disabled} onChange={(e) => set(row.squad_id, { team_kills: num(e.target.value) })} /></label>
      {row.after.players.map((player) => <div key={player.player_id || `new:${player.ign}`} className="assistant-edit-player">
        <span>{player.ign}</span>
        <input aria-label={`${player.ign} kills`} type="number" min={0} max={999} defaultValue={player.kills ?? ""} disabled={disabled} onChange={(e) => setPlayer(row.squad_id, player, { kills: num(e.target.value) })} />
        <label><input type="checkbox" disabled={disabled} onChange={(e) => setPlayer(row.squad_id, player, { remove: e.target.checked })} /> remove</label>
      </div>)}
    </fieldset>)}
    <div className="assistant-proposal-actions"><button type="button" className="assistant-primary" disabled={disabled || !edits.length} onClick={() => { onEdit(edits); setOpen(false); setDraft({}); }}>Apply edits</button><button type="button" disabled={disabled} onClick={() => { setOpen(false); setDraft({}); }}>Cancel</button></div>
    <p className="assistant-context-note">Changing a total below the player kills keeps the player sum. Leave a box empty to mark it unknown.</p>
  </section>;
}

function ScoreChanges({ proposal }: { proposal: AssistantProposal }) {
  return <div className="assistant-changes">{proposal.preview.rows.map((row) => <section key={row.squad_id}>
    <h4>Slot {unknown(row.slot)} · {row.clan}{row.source_team_number !== null && row.source_team_number !== row.slot ? ` · played TEAM${row.source_team_number}` : ""}</h4>
    {row.warnings?.map((warning, index) => <p className="assistant-warning" key={index}>{warning}</p>)}
    <table><caption>Before and proposed result</caption><thead><tr><th>Result</th><th>Saved</th><th>Proposed</th></tr></thead><tbody>
      <tr><th>Status</th><td>{row.before.status}</td><td>{row.after.status}</td></tr>
      <tr><th>Placement</th><td>{unknown(row.before.placement)}</td><td>{unknown(row.after.placement)}</td></tr>
      <tr><th>Team kills</th><td>{unknown(row.before.team_kills)}</td><td>{unknown(row.after.team_kills)}</td></tr>
      <tr><th>Points</th><td>{Number(row.before.total_points)}{row.before.status === "present" && (row.before.placement === null || row.before.team_kills === null) && <small> · partial</small>}</td><td>{Number(row.after.total_points)}{row.after.status === "present" && (row.after.placement === null || row.after.team_kills === null) && <small> · partial</small>}</td></tr>
    </tbody></table>
    <PlayerChanges before={row.before} after={row.after} />
    {row.after.team_kills !== null && row.after.team_kills > row.after.players.reduce((sum, player) => sum + (player.kills ?? 0), 0) && <p className="assistant-context-note">Some team kills remain unattributed. The total stays saved while player details are completed.</p>}
  </section>)}</div>;
}

function PlayerChanges({ before, after }: { before: AssistantScore; after: AssistantScore }) {
  const key = (p: AssistantScore["players"][number]) => p.player_id || `new:${p.ign}`;
  const previous = new Map(before.players.map((p) => [key(p), p]));
  const next = new Map(after.players.map((p) => [key(p), p]));
  const changed = [...new Set([...previous.keys(), ...next.keys()])].filter((id) => !previous.has(id) || !next.has(id) || previous.get(id)?.kills !== next.get(id)?.kills);
  if (!changed.length) return <p className="assistant-context-note">Player details unchanged.</p>;
  return <table className="assistant-player-changes"><caption>Player changes in this match</caption><thead><tr><th>Player</th><th>Saved kills</th><th>Proposed kills</th></tr></thead><tbody>{changed.map((id) => {
    const a = previous.get(id), b = next.get(id), player = b || a!;
    return <tr key={id}><th>{player.clan_tag ? `${player.clan_tag} · ` : ""}{player.ign}{b?.creates_profile && <small>Creates a new permanent profile</small>}{!a && !b?.creates_profile && <small>Adds an existing player to this match</small>}{!b && <small>Removes this match appearance</small>}</th><td>{a ? unknown(a.kills) : "Not recorded"}</td><td>{b ? unknown(b.kills) : "Removed"}</td></tr>;
  })}</tbody></table>;
}

function Attachment({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return <li>{url && (isCsvUpload(file) ? <a className="assistant-csv-file" href={url} download={file.name} aria-label={`Download selected CSV ${file.name}`}>CSV</a> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Selected proof: ${file.name}`} /></a>)}<span>{file.name}</span><button type="button" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={onRemove}>×</button></li>;
}

function ProofDialog({ token, threadId, evidence, number, disabled, onClose, onRecheck }: { token: string; threadId: string; evidence: AssistantEvidence; number: number; disabled: boolean; onClose: () => void; onRecheck: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    api.assistantEvidence(token, threadId, evidence.id, controller.signal).then((blob) => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch((e) => { if (!controller.signal.aborted) setError(explain(e)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, threadId, evidence.id]);
  return <dialog className="assistant-dialog assistant-proof-dialog" ref={dialog} onClose={onClose} aria-labelledby="assistant-proof-title"><div className="assistant-dialog-heading"><h2 id="assistant-proof-title">{evidence.csv ? "CSV · " : ""}Proof {number}</h2><button type="button" onClick={onClose} aria-label="Close proof">×</button></div><p className="assistant-file-name">{evidence.name}</p>{url ? (evidence.csv ? <a className="assistant-csv-download" href={url} download={evidence.name}>Download original CSV</a> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Original submitted proof ${number}`} /></a>) : <p role="status">{error || "Loading original proof…"}</p>}
    {evidence.csv && <CsvPreview csv={evidence.csv} />}
    {evidence.observations?.map((observation, index) => <section className="assistant-proof-read" key={index}><h3>AI reading {index + 1}</h3><p>{observation.printed_datetime || "Printed date/time unknown"} · {observation.map || "Map unknown"}</p><p>Placement {unknown(observation.placement)} · {observation.team_number ? `TEAM${observation.team_number}` : "Slot not shown / unknown"}{observation.lobby_teams ? ` · ${observation.lobby_teams} teams shown in lobby count` : ""}</p>{!!observation.players?.length && <ul>{observation.players.map((player, i) => <li key={i}><span>{player.name}</span><strong>{unknown(player.kills)}</strong></li>)}</ul>}<p>Visible kills: {observation.visible_player_kills}{observation.all_visible_kills_read ? "" : " or more; some digits unreadable"}. {observation.team_kills !== null && observation.team_kills !== undefined ? `Printed team total: ${observation.team_kills}.` : "A visible sum may not include every player."}</p>{observation.note && <p className="assistant-warning">{observation.note}</p>}</section>)}
    {!evidence.observations && !evidence.csv && <p className="assistant-warning">No complete reading saved yet.</p>}
    <button type="button" disabled={disabled} onClick={onRecheck}>{evidence.csv ? "Compare CSV again" : "Re-read this image"}</button>
  </dialog>;
}

function CsvPreview({ csv }: { csv: AssistantCsv }) {
  const [page, setPage] = useState(0);
  const size = 25;
  const start = page * size;
  const rows = csv.rows.slice(start, start + size);
  const columns = Math.max(csv.headers.length, ...rows.map((row) => row.values.length));
  return <section className="assistant-csv-preview" aria-label="CSV contents">
    <h3>{csv.row_count} data rows · {csv.headers.length} columns</h3>
    <p className="assistant-context-note">Read directly from your file. Blank and missing cells stay unknown. Repeated rows are flagged and preserved for review.</p>
    {csv.warnings.map((warning, index) => <p className="assistant-warning" key={index}>{warning}</p>)}
    <div className="assistant-csv-scroll" tabIndex={0} role="region" aria-label="CSV table; scroll to view more columns">
      <table><caption>Submitted CSV values. Record numbers count CSV records, including the header, rather than physical text lines.</caption><thead><tr><th scope="col">Record</th>{Array.from({ length: columns }, (_, index) => <th scope="col" key={index}>{csv.headers[index] || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.record} className={row.duplicate_of ? "is-repeated" : undefined}><th scope="row">{row.record}{row.duplicate_of && <small>Repeats {row.duplicate_of}</small>}</th>{Array.from({ length: columns }, (_, index) => <td key={index}>{row.values[index] === undefined ? <em>Missing</em> : row.values[index] === "" ? <em>Blank</em> : row.values[index]}</td>)}</tr>)}</tbody></table>
    </div>
    <div className="assistant-csv-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((old) => old - 1)}>Previous</button><span role="status">Rows {start + 1}–{Math.min(start + size, csv.row_count)} of {csv.row_count}</span><button type="button" disabled={start + size >= csv.row_count} onClick={() => setPage((old) => old + 1)}>Next</button></div>
  </section>;
}
