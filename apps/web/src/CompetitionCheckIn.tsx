import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import type { EventCheckIn } from "./api/types";
import { Shell, SignIn, type Session } from "./CompetitionManager";
import { clearStoredToken, getStoredToken } from "./authStorage";
import { disableAdminPush } from "./AdminAlerts";
import { Icon } from "./ui";
import { formatDateRange } from "./presentation";
import { usePageSeo } from "./seo";
import SlotSheet, { saveSlotSheetImage } from "./SlotSheet";
import "./competition-check-in.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: EventCheckIn };

export default function CompetitionCheckIn({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [report, setReport] = useState<Load>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [dayId, setDayId] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(true);
  const sheet = useRef<SVGSVGElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  usePageSeo({ title: `${report.status === "ready" ? report.data.event.title : "Competition"} · Slot check-in | ArewaVanta`, description: "Organizer slot and player verification sheet.", path: `/manage/competitions/${eventId}/check-in`, noIndex: true });
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    const controller = new AbortController();
    api.me(token, controller.signal).then(({ data }) => setSession({ token, user: data })).catch((error) => {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && error.status === 401) clearStoredToken();
        setAuthError(error instanceof ApiError ? error.message : "Couldn’t check your session.");
      }
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(); setReport({ status: "loading" });
    api.eventCheckIn(session.token, eventId, controller.signal).then(({ data }) => setReport({ status: "ready", data })).catch((error) => {
      if (!controller.signal.aborted) setReport({ status: "error", message: error instanceof ApiError ? error.message : "Couldn’t load the slot sheet." });
    });
    return () => controller.abort();
  }, [session?.token, eventId, revision]);
  async function logout() {
    if (session) {
      await disableAdminPush(session.token).catch(() => {});
      await api.logout(session.token).catch(() => {});
    }
    clearStoredToken(); setSession(null); setReport({ status: "loading" });
  }
  const data = report.status === "ready" ? report.data : null;
  const dateParts = data ? new Intl.DateTimeFormat("en", { timeZone: data.event.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(data.generated_at)) : [];
  const today = ["year", "month", "day"].map((type) => dateParts.find((part) => part.type === type)?.value ?? "").join("-");
  const selectedDay = data?.event.days.find((day) => day.id === dayId)
    ?? data?.event.days.find((day) => day.date >= today) ?? data?.event.days.at(-1);
  async function saveImage() {
    if (!sheet.current || !data || exporting) return;
    setExporting(true); setExportError("");
    try {
      const name = data.event.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "competition";
      await saveSlotSheetImage(sheet.current, `${name}-slots${selectedDay ? `-${selectedDay.date}` : ""}.png`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Couldn’t save the image. Try Print / Save PDF.");
    } finally { setExporting(false); }
  }
  return <Shell section="competitions" session={session} onLogout={logout}>
    {checking ? <div className="manage-notice">Checking your session…</div> : !session ? <><SignIn onSuccess={setSession} />{authError && <p role="alert">{authError}</p>}</> : <div className="check-in-page">
      <div className="check-in-toolbar"><a href={`/manage/competitions/${encodeURIComponent(eventId)}`}>← Competition</a><div><button type="button" onClick={() => setRevision((value) => value + 1)} disabled={!data}>Refresh lineups</button><button type="button" onClick={saveImage} disabled={!data || exporting}>{exporting ? "Creating image…" : "Save image"}</button><button type="button" className="check-in-print" onClick={() => window.print()} disabled={!data}><Icon name="print" />Print / Save PDF</button></div></div>
      <div className="check-in-intro"><p>MATCH-DAY VERIFICATION</p><h1>Slots & players<span>.</span></h1><p>One clean page. Save it as an image, share it, or print it.</p></div>
      {report.status === "loading" && <p className="manage-notice" role="status">Loading current slots and players…</p>}
      {report.status === "error" && <div className="manage-error" role="alert">{report.message}<button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div>}
      {data && <>
        <div className="check-in-controls">
          {data.event.days.length > 0 && <div className="check-in-day"><label htmlFor="check-in-match-day">Sheet for match day</label><select id="check-in-match-day" value={selectedDay?.id ?? ""} onChange={(event) => setDayId(event.target.value)}>{data.event.days.map((day) => <option key={day.id} value={day.id}>{day.label || "Match day"} · {formatDateRange(day.date, null)}</option>)}</select></div>}
          <label className="check-in-empty-toggle"><input type="checkbox" checked={includeEmpty} onChange={(event) => setIncludeEmpty(event.target.checked)} />Show unassigned slots</label>
          <span>All players stay visible. Refresh to include lineup changes.</span>
        </div>
        {exportError && <p className="manage-error" role="alert">{exportError}</p>}
        <div className="check-in-preview"><SlotSheet ref={sheet} data={data} day={selectedDay} includeEmpty={includeEmpty} /></div>
      </>}
    </div>}
  </Shell>;
}
