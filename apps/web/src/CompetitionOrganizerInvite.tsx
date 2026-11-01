import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { Shell } from "./CompetitionManager";
import { storeToken } from "./authStorage";

type Invite = { event_id: string; competition: string; email: string; existing_account: boolean };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Invite };

export default function CompetitionOrganizerInvite() {
  const [token] = useState(() => /^[a-f0-9]{64}$/.test(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "");
  const [state, setState] = useState<State>({ status: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setState({ status: "error", message: "The invitation link is missing. Please use the link in your email." });
      return;
    }
    const controller = new AbortController();
    api.inspectCompetitionOrganizerInvitation(token, controller.signal)
      .then(({ data }) => setState({ status: "ready", data }))
      .catch((reason) => {
        if (!controller.signal.aborted) setState({ status: "error", message: reason instanceof ApiError ? reason.message : "We couldn’t load this invitation." });
      });
    return () => controller.abort();
  }, [token]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (state.status !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.acceptCompetitionOrganizerInvitation(
        token,
        state.data.existing_account ? undefined : name.trim(),
        password,
        state.data.existing_account ? undefined : confirmation,
      );
      storeToken(data.token);
      const target = `/manage/competitions/${encodeURIComponent(state.data.event_id)}`;
      window.history.pushState(null, "", target);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (reason) {
      setError(reason instanceof ApiError ? [reason.message, ...Object.values(reason.errors).flat()].join(" ") : "We couldn’t accept the invitation.");
      setBusy(false);
    }
  }

  return <Shell session={null} onLogout={() => {}}>
    {state.status === "loading" ? <div className="manage-notice">Checking invitation…</div>
      : state.status === "error" ? <div className="manage-notice" role="alert">{state.message}</div>
        : <section className="manage-login">
          <p className="manage-eyebrow">COMPETITION ORGANIZER INVITATION</p>
          <h1>Join the organizers<span>.</span></h1>
          <p>You’ve been invited to help manage <strong>{state.data.competition}</strong>.</p>
          <form onSubmit={(e) => void accept(e)}>
            <label>Email<input value={state.data.email} disabled /></label>
            {!state.data.existing_account && <label>Your name<input required maxLength={255} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>}
            <label>{state.data.existing_account ? "Your password" : "Choose a password"}<input required type="password" autoComplete={state.data.existing_account ? "current-password" : "new-password"} minLength={state.data.existing_account ? undefined : 12} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {!state.data.existing_account && <label>Confirm password<input required type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>}
            {!state.data.existing_account && <small>Use at least 12 characters.</small>}
            {error && <div className="manage-error" role="alert">{error}</div>}
            <button className="manage-primary" disabled={busy}>{busy ? "Joining…" : "Accept invitation"}</button>
          </form>
        </section>}
  </Shell>;
}
