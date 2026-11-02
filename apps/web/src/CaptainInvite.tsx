import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { Shell, tokenKey } from "./CompetitionManager";
type Invitation = { clan: string; email: string; existing_account: boolean };
export default function CaptainInvite() {
  const [invitationToken] = useState(() => /^[a-f0-9]{64}$/.test(window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : "");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: Invitation }
  >({ status: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    const c = new AbortController();
    if (!invitationToken) {
      setState({
        status: "error",
        message:
          "The invitation link is missing. Please use the link in your email.",
      });
      return;
    }
    api
      .inspectInvitation(invitationToken, c.signal)
      .then(({ data }) => setState({ status: "ready", data }))
      .catch((err) => {
        if (!c.signal.aborted)
          setState({
            status: "error",
            message:
              err instanceof ApiError
                ? err.message
                : "We couldn’t load this invitation.",
          });
      });
    return () => c.abort();
  }, []);
  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.acceptInvitation(
        invitationToken,
        state.status === "ready" && state.data.existing_account
          ? undefined
          : name.trim(),
        password,
        state.status === "ready" && state.data.existing_account
          ? undefined
          : confirmation,
      );
      sessionStorage.setItem(tokenKey, data.token);
      window.history.pushState(null, "", "/manage/directory");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [err.message, ...Object.values(err.errors).flat()].join(" ")
          : "We couldn’t accept the invitation.",
      );
      setBusy(false);
    }
  }
  return (
    <Shell session={null} onLogout={() => {}} section="directory">
      {state.status === "loading" ? (
        <div className="manage-notice">Checking invitation…</div>
      ) : state.status === "error" ? (
        <div className="manage-notice" role="alert">
          {state.message}
        </div>
      ) : (
        <section className="manage-login">
          <p className="manage-eyebrow">CLAN CAPTAIN INVITATION</p>
          <h1>
            Join {state.data.clan}
            <span>.</span>
          </h1>
          <p>
            {state.data.existing_account
              ? "Sign in with your existing account to accept."
              : "Create your account to manage your clan, squads and players."}
          </p>
          <form onSubmit={accept}>
            <label>
              Email
              <input value={state.data.email} disabled />
            </label>
            {!state.data.existing_account && (
              <label>
                Your name
                <input
                  required
                  maxLength={255}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              {state.data.existing_account
                ? "Your password"
                : "Choose a password"}
              <input
                required
                type="password"
                autoComplete={
                  state.data.existing_account
                    ? "current-password"
                    : "new-password"
                }
                minLength={state.data.existing_account ? undefined : 12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {!state.data.existing_account && (
              <label>
                Confirm password
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            {!state.data.existing_account && (
              <small>Use at least 12 characters.</small>
            )}
            {error && (
              <div className="manage-error" role="alert">
                {error}
              </div>
            )}
            <button className="manage-primary" disabled={busy}>
              {busy ? "Joining…" : "Accept invitation"}
            </button>
          </form>
        </section>
      )}
    </Shell>
  );
}
