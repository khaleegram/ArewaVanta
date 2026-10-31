import { useEffect, useState } from "react";
import { ApiError, api } from "./api/client";
import { Shell } from "./CompetitionManager";
import "./competition-manager.css";

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <Shell session={null} onLogout={() => undefined}>
      <section className="manage-login manage-recovery">
        {children}
      </section>
    </Shell>
  );
}

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "Too many attempts. Wait a little and try again.";
    }

    return error.message;
  }

  return "Something went wrong. Please try again.";
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(
    new URLSearchParams(window.location.search).get("email") ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await api.sendPasswordResetLink(email.trim());
      setSent(true);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <p className="manage-eyebrow">ACCOUNT RECOVERY</p>
      <h1>
        Forgot password<span>.</span>
      </h1>
      <p>We’ll send a secure reset link if there’s an account for that email.</p>
      {sent ? (
        <div className="manage-success" role="status">
          Check your inbox if an ArewaVanta account exists for that address.
          The link expires in 60 minutes.
        </div>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error && (
            <div className="manage-error" role="alert">
              {error}
            </div>
          )}
          <button className="manage-primary" disabled={busy}>
            {busy ? "Sending link…" : "Send reset link"}
          </button>
        </form>
      )}
      <a className="manage-auth-link" href="/manage/competitions">
        ← Back to sign in
      </a>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (resetToken) window.history.replaceState(null, "", window.location.pathname);
  }, [resetToken]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetToken) {
      setError("This reset link is incomplete. Request a new one to continue.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api.resetPassword(
        email.trim(),
        resetToken,
        password,
        confirmation,
      );
      setComplete(true);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <p className="manage-eyebrow">ACCOUNT SECURITY</p>
      <h1>
        Set a new password<span>.</span>
      </h1>
      <p>Use a password with at least 12 characters.</p>
      {complete ? (
        <div className="manage-success" role="status">
          Your password has been updated. You can now sign in with it.
        </div>
      ) : !resetToken ? (
        <div className="manage-error" role="alert">
          This reset link is incomplete or has already been removed. Request a
          new link to continue.
        </div>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error && (
            <div className="manage-error" role="alert">
              {error}
            </div>
          )}
          <button className="manage-primary" disabled={busy}>
            {busy ? "Updating password…" : "Update password"}
          </button>
        </form>
      )}
      <a className="manage-auth-link" href="/manage/competitions">
        ← Back to sign in
      </a>
    </AuthFrame>
  );
}
