import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api/client";
import type { ManageEvent } from "./api/types";
import type { AssistantCsv, AssistantEvidence, AssistantIssue, AssistantMessage, AssistantMessageInput, AssistantProposal, AssistantProposalEdit, AssistantScore, AssistantThread, AssistantThreadSummary } from "./assistantTypes";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { formatDate } from "./presentation";
import { extractFrames, isVideoFile } from "./videoFrames";
import "./organizer-assistant.css";

const explain = (error: unknown) => error instanceof ApiError
  ? [...new Set([error.message, ...Object.values(error.errors).flat()])].slice(0, 3).join(" ")
  : error instanceof Error ? error.message : "Could not complete that request. Please try again.";
const unknown = (value: number | string | null | undefined) => value ?? "Unknown";
const isCsvUpload = (file: File) => /\.csv$/i.test(file.name);
function openReviewDestination(data: AssistantThread) {
  location.replace(assistantPath(data.event_id, data.id));
}
const assistantPath = (eventId: string, threadId?: string | null) => `/manage/competitions/${encodeURIComponent(eventId)}/assistant${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;
const threadFromLocation = () => decodeURIComponent(location.pathname.replace(/\/+$/, "").match(/\/assistant\/([^/]+)$/)?.[1] ?? "") || new URLSearchParams(location.search).get("thread");
function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
  const flush = () => { if (list.length) { const items = list; blocks.push(<ul key={`l${blocks.length}`}>{items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>); list = []; } };
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) list.push(item[1]);
    else { flush(); if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>); }
  }
  flush();
  return <div className="assistant-message-text">{blocks}</div>;
}
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="chat-sheet" ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}><div className="chat-sheet-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close">×</button></div>{children}</dialog>;
}
function DoneCard({ proposal, disabled, onUndo, resultUrl }: { proposal: AssistantProposal; disabled: boolean; onUndo: () => void; resultUrl: string }) {
  const rows = proposal.preview.rows ?? [];
  const label = { accepted: "Saved", rejected: "Discarded", superseded: "Replaced by a newer review", undone: "Undone", pending: "" }[proposal.status];
  const quiet = proposal.status === "rejected" || proposal.status === "superseded";
  return <section className={`done-card is-${proposal.status}`}><p><b>{proposal.status === "accepted" ? "✓ " : ""}{label}</b><span>{proposal.title.replace(/ · Isolated$/, "")}{quiet ? "" : ` · ${rows.length} teams`}</span></p>
    {proposal.status === "accepted" && <div className="done-actions"><a href={resultUrl} target="_blank" rel="noreferrer">View results ↗</a><button type="button" disabled={disabled} onClick={onUndo}>Undo</button></div>}
    {!quiet && !!rows.length && <details><summary>What changed</summary><ScoreChanges proposal={proposal} /></details>}
  </section>;
}
function Summary({ text, clamp }: { text: string; clamp: boolean }) {
  const [open, setOpen] = useState(false);
  const long = clamp && text.length > 220;
  return <div className={`assistant-summary${long && !open ? " is-clamped" : ""}`}><RichText text={text} />{long && <button type="button" className="assistant-link-button" onClick={() => setOpen((v) => !v)}>{open ? "Show less" : "Read full reply"}</button>}</div>;
}
function ReviewSheet({ proposal, issues, disabled, proofButtons, onAccept, onReject, onEdit, onAsk, onWrite }: { proposal: AssistantProposal; issues: AssistantIssue[]; disabled: boolean; proofButtons: (ids: string[]) => React.ReactNode; onAccept: () => void; onReject: () => void; onEdit: (edits: AssistantProposalEdit[]) => void; onAsk: (question: string) => void; onWrite: (text: string) => void }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const rows = [...proposal.preview.rows].sort((a, b) => (a.after.placement ?? 99) - (b.after.placement ?? 99));
  const kills = rows.reduce((sum, row) => sum + (row.after.team_kills ?? 0), 0);
  const fresh = rows.flatMap((row) => row.after.players.filter((p) => p.creates_profile).map((p) => ({ id: `new:${row.squad_id}:${p.ign}`, ign: p.ign, slot: row.slot, kills: p.kills })));
  const open = (key: string) => !dismissed.includes(key);
  const unmatched = issues.filter((i) => i.kind === "unmatched_player" && open(`u:${i.team}:${i.name}`));
  const skipped = issues.filter((i) => i.kind === "not_entered");
  const newProfiles = fresh.filter((f) => open(f.id));
  const needs = unmatched.length + newProfiles.length + skipped.length;
  const movers = proposal.preview.standings?.rows.slice(0, 5) ?? [];
  const ordinal = (n: number | null) => n === null ? "?" : n + (["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]);
  return <section id={`assistant-proposal-${proposal.id}`} className="review-sheet" aria-label="Review before saving">
    <header className="review-head"><div><h3>{proposal.title.replace(/ · Isolated$/, "")}</h3><p><strong>{rows.length}</strong> teams · <strong>{kills}</strong> kills</p></div><span className="review-pill">Not saved yet</span></header>
    {needs === 0 ? <p className="review-ok">✓ Nothing needs you. Check the teams, then save.</p> : <div className="review-needs"><h4>Needs you · {needs}</h4>
      {unmatched.map((issue) => { const key = `u:${issue.team}:${issue.name}`; return <div className="review-card" key={key}>
        <p><strong>Who is “{issue.name}”?</strong><span>{issue.team}{issue.kills != null ? ` · ${issue.kills} kills` : ""} · counted in the team total for now</span></p>
        <div className="review-choices">{issue.candidates?.map((c) => <button key={c.player_id} type="button" disabled={disabled} onClick={() => onAsk(`${issue.team}: "${issue.name}" is ${c.ign} (profile ${c.player_id}). Use that profile.`)}>It’s {c.ign}</button>)}<button type="button" disabled={disabled} onClick={() => onWrite(`${issue.team}: "${issue.name}" is `)}>Someone else</button><button type="button" className="review-quiet" onClick={() => setDismissed((d) => [...d, key])}>Skip</button></div></div>; })}
      {newProfiles.map((f) => <div className="review-card" key={f.id}>
        <p><strong>New player: {f.ign}</strong><span>Slot {f.slot ?? "?"}{f.kills != null ? ` · ${f.kills} kills` : ""} · a profile is created when you save</span></p>
        <div className="review-choices"><button type="button" onClick={() => setDismissed((d) => [...d, f.id])}>Create it</button><button type="button" disabled={disabled} onClick={() => onWrite(`"${f.ign}" already exists as `)}>Already exists</button></div></div>)}
      {skipped.map((i, index) => <div className="review-card is-info" key={index}><p><strong>{i.team} left out</strong><span>{i.text}</span></p></div>)}
    </div>}
    <ul className="review-teams">{rows.map((row) => <li key={row.squad_id} className={openRow === row.squad_id ? "is-open" : ""}>
      <button type="button" className="review-team" aria-expanded={openRow === row.squad_id} onClick={() => setOpenRow(openRow === row.squad_id ? null : row.squad_id)}>
        <b>{ordinal(row.after.placement)}</b><span><strong>Slot {row.slot ?? "?"} · {row.clan}</strong></span><em>{row.after.team_kills ?? "?"} kills</em><i>{Number(row.after.total_points)} pts</i></button>
      {openRow === row.squad_id && <ul className="review-players">{row.after.players.map((p) => <li key={p.player_id || p.ign}><span>{p.ign}{p.creates_profile ? " · new" : ""}</span><b>{p.kills ?? "?"}</b></li>)}</ul>}
    </li>)}</ul>
    {!!movers.length && <div className="review-standings"><h4>Standings after saving</h4><ol>{movers.map((m) => <li key={m.squad_id}><b>{m.after_rank}</b><span>{m.clan}{m.slot !== null ? ` · slot ${m.slot}` : ""}</span><i>{Number(m.after_points)} pts</i></li>)}</ol></div>}
    <details className="review-more"><summary>Edit numbers or see every change</summary>
      <EditProposal proposal={proposal} disabled={disabled} onEdit={onEdit} />
      <ScoreChanges proposal={proposal} />
      {!!proposal.preview.standings?.rows.length && <StandingsImpact standings={proposal.preview.standings} />}
      <div className="assistant-proof-links">{proofButtons(proposal.preview.evidence_ids)}</div>
    </details>
    <div className="review-actions"><button type="button" className="assistant-primary" disabled={disabled} onClick={onAccept}>Save {rows.length} teams</button><button type="button" disabled={disabled} onClick={onReject}>Discard</button></div>
  </section>;
}
function Notes({ items }: { items: string[] }) {
  if (items.length <= 2) return <>{items.map((item, index) => <p className="assistant-warning" key={index}>{item}</p>)}</>;
  return <details className="assistant-notes"><summary>{items.length} notes to check</summary>{items.map((item, index) => <p key={index}>{item}</p>)}</details>;
}
function Working() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const timer = setInterval(() => setSeconds((n) => n + 1), 1000); return () => clearInterval(timer); }, []);
  return <p className="assistant-working" role="status"><span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span>Reading proof and checking slots, players and saved results… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}<small>Usually under a minute. It is safe to leave and come back.</small></p>;
}
const gameKey = (eventId: string) => `assistant-game:${eventId}`;

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
  const [threadId, setThreadId] = useState<string | null>(threadFromLocation);
  const [thread, setThread] = useState<AssistantThread | null>(null);
  const [matchId, setMatchId] = useState(() => new URLSearchParams(location.search).get("match") || localStorage.getItem(gameKey(eventId)) || "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState<{ name: string; pct: number } | null>(null);
  const clipOf = useRef(new WeakMap<File, string>());
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(!!threadId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [proof, setProof] = useState<AssistantEvidence | null>(null);
  const [sheet, setSheet] = useState<"context" | "history" | null>(null);
  const [retry, setRetry] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const dataVersion = useRef(0);
  const endMarker = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const openedScroll = useRef<string | null>(null);
  const blocked = busy || !!thread?.processing || opening || !!extracting;
  const matches = (event?.days ?? []).flatMap((day) => day.matches.map((match) => ({ ...match, date: day.date, dayLabel: day.label })));
  const pendingProposals = (thread?.proposals ?? []).filter((p) => p.status === "pending");
  const currentGame = (() => { const m = matches.find((item) => item.id === matchId); return m ? `${formatDate(m.date)} · G${m.match_index}` : "All games"; })();
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

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => endMarker.current?.scrollIntoView({ block: "end", behavior: reduceMotion() ? "instant" : behavior });

  useEffect(() => { if (!text && composer.current) composer.current.style.height = "auto"; }, [text]);

  useEffect(() => {
    if (opening || !thread || openedScroll.current === thread.id) return;
    openedScroll.current = thread.id;
    requestAnimationFrame(() => scrollToLatest("instant"));
  }, [opening, thread?.id]);

  useEffect(() => {
    const latest = thread?.messages.at(-1);
    if (latest?.role !== "assistant" || opening || openedScroll.current !== thread?.id) return;
    document.getElementById(`assistant-turn-${latest.id}`)?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "instant" : "smooth" });
  }, [thread?.messages.at(-1)?.id]);

  useEffect(() => {
    const marker = endMarker.current;
    if (!marker) return;
    const observer = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting), { rootMargin: "0px 0px 160px 0px" });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [opening, loading, thread?.id]);

  function updateUrl(id: string | null, match = matchId) {
    if (match) localStorage.setItem(gameKey(eventId), match); else localStorage.removeItem(gameKey(eventId));
    history.replaceState(null, "", assistantPath(eventId, id));
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
  async function attach(selected: FileList | null) {
    if (!selected) return;
    const picked = Array.from(selected);
    const videos = picked.filter(isVideoFile);
    const others = picked.filter((file) => !isVideoFile(file));
    let next = [...files, ...others];
    if (others.some((file) => isCsvUpload(file) ? file.size > 1024 * 1024 : !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError("Use CSV files up to 1 MB, JPEG, PNG or WebP images up to 5 MB each, or a screen recording."); return;
    }
    for (const video of videos) {
      setError(""); setExtracting({ name: video.name, pct: 0 });
      try {
        const frames = await extractFrames(video, (pct) => setExtracting({ name: video.name, pct }));
        frames.forEach((frame) => clipOf.current.set(frame, video.name));
        next = [...next, ...frames];
      } catch (e) { setExtracting(null); setError(e instanceof Error ? e.message : "Could not read that video."); return; }
    }
    setExtracting(null);
    if (next.length > 40) { setError("That is more than 40 files. Remove some, or record a shorter video."); return; }
    if (next.filter(isCsvUpload).length > 2) { setError("Attach up to two CSV files per message."); return; }
    if (next.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { setError("Keep this message's files under 20 MB. Record a shorter video."); return; }
    setFiles(next); setError("");
    if (videos.length) setNotice(`Video ready: ${next.filter((f) => clipOf.current.has(f)).length} clear frames cut out. Tap Enter these results.`);
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
  const hasMessages = !!thread?.messages.length;
  const working = busy || !!thread?.processing;
  const quick: [string, string][] = files.length
    ? [["Enter these results", "Enter these results for the selected game."], ["Only check them", "Compare these with the saved results and tell me what differs. Do not prepare changes yet."]]
    : [["Enter results", "Extract and enter the results for the selected game."], ["Check slots", "Check that every team in the selected game is in the right slot and tell me anything off."], ["Dispute", "These players dispute their kills. Compare the proof with the saved results and propose the supported corrections."]];
  function quickSend(message: string) {
    if (files.length) void send({ client_id: crypto.randomUUID(), message, match_id: matchId || null, images: files.filter((file) => !isCsvUpload(file)), csv_files: files.filter(isCsvUpload) });
    else { setText(message); composer.current?.focus(); }
  }
  return <div className="assistant-page chat-app">
    <header className="chat-top">
      <a className="chat-icon" href={`/manage/competitions/${encodeURIComponent(eventId)}`} aria-label={`Back to ${event.title}`}>←</a>
      <button type="button" className="chat-title" onClick={() => setSheet("context")} aria-label="Change game"><strong>{thread?.title || "New review"}</strong><small>{currentGame} · {event.title}</small></button>
      <button type="button" className="chat-icon" onClick={() => setSheet("history")} aria-label="Past reviews">☰</button>
    </header>
    {!validMatch && <p className="chat-banner is-error" role="alert">The linked game is not in this competition. Pick the game again.</p>}
    <div className="chat-body">
      <div className="chat-scroll">
        {opening ? <p className="chat-hint">Opening review…</p> : <div className="chat-feed" aria-label="Conversation">
          {!hasMessages && <div className="chat-row is-assistant"><div className="chat-bubble"><RichText text={`Hi. Send me the scoreboard screenshots or a CSV and say which game.\n\nI will read them, match every team to its slot and players, and show you a short review to approve. Nothing is saved until you tap Save.`} /></div></div>}
          {thread?.messages.map((message) => {
            const proposals = thread.proposals.filter((p) => p.message_id === message.id);
            const assistant = message.role === "assistant";
            const extras = (message.details?.findings?.length ?? 0) + (message.details?.warnings?.length ?? 0) + (message.details?.ruling ? 1 : 0);
            const proofIds = message.details?.read_evidence_ids ?? [];
            return <div className={`chat-row is-${message.role}`} id={`assistant-turn-${message.id}`} key={message.id}>
              <div className="chat-bubble">
                {assistant ? <Summary text={message.content} clamp={proposals.length > 0} /> : <div className="assistant-message-text">{message.content}</div>}
                {!assistant && !!proofIds.length && <div className="chat-attached">{proofIds.length > 4 ? <button type="button" className="assistant-proof-link" onClick={() => setProof(thread.evidence.find((e) => e.id === proofIds[0]) ?? null)}>🎞 {proofIds.length} frames</button> : proofButtons(proofIds)}</div>}
                {message.role === "user" && message.status !== "completed" && !thread.processing && <button type="button" className="chat-retry" disabled={blocked} onClick={() => retryMessage(message)}>Retry this message</button>}
              </div>
              {proposals.map((proposal) => proposal.preview.kind ? <ProposalCard key={proposal.id} proposal={proposal} disabled={blocked} proofButtons={proofButtons} onAccept={() => void decide(proposal, "accept")} onReject={() => void decide(proposal, "reject")} onUndo={() => void decide(proposal, "undo")} onEdit={(edits) => void edit(proposal, edits)} resultUrl={`${matchLink}?match=${encodeURIComponent(proposal.match_id)}`} />
                : proposal.status === "pending"
                  ? <ReviewSheet key={proposal.id} proposal={proposal} issues={message.details?.issues ?? []} disabled={blocked} proofButtons={proofButtons} onAccept={() => void decide(proposal, "accept")} onReject={() => void decide(proposal, "reject")} onEdit={(edits) => void edit(proposal, edits)} onAsk={(question) => void send({ client_id: crypto.randomUUID(), message: question, match_id: matchId || null })} onWrite={(value) => { setText(value); composer.current?.focus(); }} />
                  : <DoneCard key={proposal.id} proposal={proposal} disabled={blocked} onUndo={() => void decide(proposal, "undo")} resultUrl={`${matchLink}?match=${encodeURIComponent(proposal.match_id)}`} />)}
              {assistant && (extras > 0 || !!proofIds.length) && <details className="chat-more"><summary>Details{extras ? ` · ${extras}` : ""}</summary>
                {!!proofIds.length && proofIds.length <= 8 && <div className="assistant-proof-links">{proofButtons(proofIds)}</div>}
                {!!message.details?.duplicate_uploads?.length && <p className="assistant-context-note">Repeated uploads count once: {message.details.duplicate_uploads.join(", ")}.</p>}
                {message.details?.ruling && <section className="assistant-ruling"><h3>Suggested ruling</h3><p>{message.details.ruling}</p></section>}
                {!!message.details?.findings?.length && <ul className="assistant-findings-list">{[...message.details.findings].sort((a, b) => Number(b.kind === "unresolved") - Number(a.kind === "unresolved")).map((finding, index) => <li key={index}><span className={`assistant-finding-kind is-${finding.kind}`}>{finding.kind === "observed" ? "Seen" : finding.kind === "inferred" ? "Inferred" : "Needs a decision"}</span><p>{finding.text}</p><div className="assistant-proof-links">{proofButtons(finding.evidence_ids)}</div></li>)}</ul>}
                {!!message.details?.warnings?.length && <ul className="assistant-findings-list">{message.details.warnings.map((warning, index) => <li key={index}><p>{warning}</p></li>)}</ul>}
              </details>}
            </div>;
          })}
          {working && <div className="chat-row is-assistant"><div className="chat-bubble"><Working /></div></div>}
          <div ref={endMarker} aria-hidden="true" className="assistant-end" />
        </div>}
      </div>
      {!atEnd && !opening && hasMessages && <button type="button" className="assistant-jump" onClick={() => scrollToLatest()} aria-label="Jump to the latest message">↓</button>}
    </div>
    {(notice || error) && <p className={`chat-banner${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}<button type="button" aria-label="Dismiss" onClick={() => { setError(""); setNotice(""); }}>×</button></p>}
    <form className="assistant-composer chat-composer" onSubmit={submit} aria-label="Message the organizer assistant">
      {!working && <div className="chat-quick" role="group" aria-label="Suggestions">{quick.map(([label, message]) => <button type="button" key={label} disabled={blocked} onClick={() => quickSend(message)}>{label}</button>)}</div>}
      {extracting && <p className="chat-extracting" role="status"><span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span>Reading video “{extracting.name}” on your phone… {Math.round(extracting.pct * 100)}%</p>}
      {!!files.length && <ul className="assistant-attachments">
        {[...new Set(files.filter((f) => clipOf.current.has(f)).map((f) => clipOf.current.get(f)!))].map((clip) => <li key={`clip:${clip}`} className="assistant-clip"><span>🎞 {clip} · {files.filter((f) => clipOf.current.get(f) === clip).length} frames</span><button type="button" disabled={blocked} aria-label={`Remove video ${clip}`} onClick={() => setFiles((old) => old.filter((f) => clipOf.current.get(f) !== clip))}>×</button></li>)}
        {files.filter((f) => !clipOf.current.has(f)).map((file, index) => <Attachment key={`${file.name}:${index}`} file={file} disabled={blocked} onRemove={() => setFiles((old) => old.filter((f) => f !== file))} />)}
      </ul>}
      <div className="assistant-composer-row">
        <label className="assistant-attach" aria-label="Add screenshots, a screen recording or a CSV" title="Add screenshots, a screen recording or a CSV"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><input type="file" multiple accept=".csv,text/csv,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mp4,.mov" disabled={blocked} onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} /></label>
        <label htmlFor="assistant-message" className="assistant-sr">Your message</label>
        <textarea id="assistant-message" ref={composer} value={text} maxLength={12000} disabled={blocked} onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Message the assistant…" rows={1} />
        <button className="assistant-primary assistant-send" aria-label={blocked ? "Working" : "Send"} disabled={blocked || !validMatch || (!text.trim() && !files.length)}>{blocked ? "…" : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}</button>
      </div>
    </form>
    {sheet === "context" && <Sheet title="Game for this review" onClose={() => setSheet(null)}>
      <label className="chat-field">Game<select value={validMatch ? matchId : ""} disabled={blocked} onChange={(e) => { setMatchId(e.target.value); updateUrl(threadId, e.target.value); }}><option value="">Compare this competition</option>{matches.map((match) => <option key={match.id} value={match.id}>{formatDate(match.date)} · G{match.match_index} · {match.map_label}</option>)}</select></label>
      <p className="assistant-context-note">Results go to {(event.days ?? []).map((day) => formatDate(day.date)).join(" / ")}. If you name another game in your message, I use that one.</p>
      <div className="chat-sheet-actions"><a href={`${matchLink}${matchId ? `?match=${encodeURIComponent(matchId)}` : ""}`} target="_blank" rel="noreferrer">Open Match desk ↗</a><button type="button" className="assistant-primary" onClick={() => setSheet(null)}>Done</button></div>
    </Sheet>}
    {sheet === "history" && <Sheet title="Reviews" onClose={() => setSheet(null)}>
      <button type="button" className="chat-history-item is-new" disabled={blocked} onClick={() => { chooseThread(""); setSheet(null); }}>＋ New review</button>
      <ul className="chat-history">{threadId && !threads.some((item) => item.id === threadId) && <li><button type="button" className="chat-history-item is-current" onClick={() => setSheet(null)}>{thread?.title || "Linked review"}</button></li>}{threads.map((item) => <li key={item.id}><button type="button" className={`chat-history-item${item.id === threadId ? " is-current" : ""}`} disabled={blocked} onClick={() => { chooseThread(item.id); setSheet(null); }}><strong>{item.title}</strong><small>{new Date(item.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small></button></li>)}</ul>
    </Sheet>}
    {proof && thread && <ProofDialog key={proof.id} token={token} threadId={thread.id} evidence={proof} number={evidenceNumber(proof.id)} onClose={() => setProof(null)} disabled={blocked} onRecheck={() => { const { id, csv } = proof; setProof(null); void send({ client_id: crypto.randomUUID(), message: csv ? "Review this CSV against the latest saved results again. Verify game and slot linkage, repeated rows, missing values, and player versus team totals. Explain any changes from your previous review." : "Re-read this image carefully. Check the exact digits, match linkage and slot, and compare against the latest saved results. Explain any changes from your previous reading.", match_id: matchId || null, recheck_evidence_ids: [id] }); }} />}
  </div>;
}

function ProposalCard({ proposal, disabled, proofButtons, onAccept, onReject, onUndo, onEdit, resultUrl }: { proposal: AssistantProposal; disabled: boolean; proofButtons: (ids: string[]) => React.ReactNode; onAccept: () => void; onReject: () => void; onUndo: () => void; onEdit: (edits: AssistantProposalEdit[]) => void; resultUrl: string }) {
  const pending = proposal.status === "pending";
  const rows = proposal.preview.rows ?? [];
  const newProfiles = rows.reduce((sum, row) => sum + row.after.players.filter((p) => p.creates_profile).length, 0);
  return <section id={`assistant-proposal-${proposal.id}`} className={`assistant-proposal is-${proposal.status}`} aria-label="Proposed result correction">
    <div className="assistant-proposal-heading"><h3>{proposal.title}</h3><span>{pending ? "Awaiting your acceptance" : proposal.status === "accepted" ? "Accepted & saved" : proposal.status === "undone" ? "Undone" : proposal.status === "superseded" ? "Replaced by a newer review" : "Rejected"}</span></div>
    {pending && !proposal.preview.kind && <div className="assistant-chips"><span className="assistant-chip is-strong">{rows.length} {rows.length === 1 ? "team" : "teams"}</span>{newProfiles > 0 && <span className="assistant-chip is-warn">{newProfiles} new {newProfiles === 1 ? "profile" : "profiles"}</span>}{!!proposal.preview.standings?.rows.length && <span className="assistant-chip">{proposal.preview.standings.rows.length} standings move</span>}</div>}
    <details className="assistant-reason" open={!pending}><summary>Why these changes</summary><RichText text={proposal.reason} /></details>
    {proposal.preview.kind === "admin_action" ? <AdminActionChanges proposal={proposal} /> : proposal.preview.kind === "csv_import" ? <CsvImportChanges proposal={proposal} /> : pending ? <details open><summary>Before and after for each team</summary><ScoreChanges proposal={proposal} /></details> : <details><summary>View proposed changes</summary><ScoreChanges proposal={proposal} /></details>}
    {!!proposal.preview.standings?.rows.length && <StandingsImpact standings={proposal.preview.standings} />}
    {pending && !proposal.preview.kind && <EditProposal proposal={proposal} disabled={disabled} onEdit={onEdit} />}
    <div className="assistant-proof-links">{proofButtons(proposal.preview.evidence_ids)}</div>
    {pending && <div className="assistant-proposal-actions is-sticky"><button type="button" className="assistant-primary" disabled={disabled} onClick={onAccept}>{proposal.preview.kind === "admin_action" ? `Accept & apply ${proposal.preview.items?.length ?? 0} changes` : proposal.preview.kind === "csv_import" ? `Accept & save ${proposal.preview.games?.length ?? 0} games` : "Accept & update results"}</button><button type="button" disabled={disabled} onClick={onReject}>Reject</button></div>}
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
  const [all, setAll] = useState(false);
  const shown = all ? standings.rows : standings.rows.slice(0, 8);
  const arrow = (before: number | null, after: number) => before === null ? "new" : after < before ? `▲ ${before - after}` : after > before ? `▼ ${after - before}` : "–";
  return <details className="assistant-standings"><summary>Standings impact · {standings.scope} · {standings.rows.length} of {standings.teams} teams move or score</summary>
    <table><thead><tr><th>Team</th><th>Rank</th><th>Points</th></tr></thead><tbody>{shown.map((row) => <tr key={row.squad_id}>
      <th>{row.clan}{row.slot !== null ? ` · slot ${row.slot}` : ""}</th>
      <td>{row.before_rank ?? "–"} → <strong>{row.after_rank}</strong> <small>{arrow(row.before_rank, row.after_rank)}</small></td>
      <td>{Number(row.before_points)} → <strong>{Number(row.after_points)}</strong></td></tr>)}</tbody></table>
    {standings.rows.length > 8 && <button type="button" className="assistant-link-button" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${standings.rows.length}`}</button>}
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
