import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
type Data = {
  items: {
    id: number;
    message: string;
    read_at: string | null;
    created_at: string;
  }[];
  unread: number;
  push_public_key: string | null;
};
export async function disableAdminPush(token: string) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await api.unsubscribePush(token, subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
function keyBytes(value: string) {
  const raw = atob(
    (value + "=".repeat((4 - (value.length % 4)) % 4))
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export default function AdminAlerts({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const refresh = () =>
      api
        .activity(token, c.signal)
        .then((res) => setData(res.data))
        .catch(() => {});
    refresh();
    const interval = window.setInterval(refresh, 30000);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .getRegistration("/")
        .then((reg) => reg?.pushManager.getSubscription())
        .then((sub) => setSubscribed(!!sub))
        .catch(() => {});
    return () => {
      c.abort();
      clearInterval(interval);
    };
  }, [token]);
  async function toggle() {
    if (!data?.push_public_key) {
      setError("Push notifications are not configured yet.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("Push notifications are not supported in this browser.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reg = await navigator.serviceWorker.register(
        "/notification-worker.js",
      );
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api.unsubscribePush(token, existing.endpoint);
        await existing.unsubscribe();
        setSubscribed(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw new Error("Allow notifications in your browser settings.");
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(data.push_public_key) as BufferSource,
        });
        try {
          await api.subscribePush(token, subscription.toJSON());
        } catch (err) {
          await subscription.unsubscribe();
          throw err;
        }
        setSubscribed(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update notifications.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function read() {
    try {
      await api.markActivityRead(token);
      setData((d) =>
        d
          ? {
              ...d,
              unread: 0,
              items: d.items.map((item) => ({
                ...item,
                read_at: item.read_at ?? new Date().toISOString(),
              })),
            }
          : d,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not mark notifications read.",
      );
    }
  }
  if (!data) return null;
  return (
    <div className="admin-alerts">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Activity
        {data.unread > 0 && (
          <span className="admin-alert-count">{data.unread}</span>
        )}
      </button>
      {open && (
        <section className="admin-alert-panel" aria-label="Admin activity">
          <div className="admin-alert-heading">
            <strong>Community activity</strong>
            {data.unread > 0 && <button onClick={read}>Mark read</button>}
          </div>
          <button
            className="admin-push-toggle"
            disabled={busy}
            onClick={toggle}
          >
            {busy
              ? "Updating…"
              : subscribed
                ? "Turn off browser push"
                : "Enable browser push"}
          </button>
          {error && (
            <p className="admin-alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-alert-items">
            {data.items.length ? (
              data.items.map((item) => (
                <div key={item.id} className={item.read_at ? "" : "unread"}>
                  <p>{item.message}</p>
                  <small>
                    {new Date(
                      item.created_at.endsWith("Z")
                        ? item.created_at
                        : item.created_at.replace(" ", "T") + "Z",
                    ).toLocaleString("en-NG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Africa/Lagos",
                    })}
                  </small>
                </div>
              ))
            ) : (
              <p>No activity yet.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
