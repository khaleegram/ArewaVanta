import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { activityFullTime, activityText, activityTime } from "./presentation";
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
function needsIosHomeScreenInstall() {
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}
export default function AdminAlerts({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [subscriptionReady, setSubscriptionReady] = useState(false);
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
        .then((sub) => {
          setSubscribed(!!sub);
          setSubscriptionReady(true);
        })
        .catch(() => setSubscriptionReady(true));
    else setSubscriptionReady(true);
    return () => {
      c.abort();
      clearInterval(interval);
    };
  }, [token]);
  async function toggle() {
    if (needsIosHomeScreenInstall()) {
      setError(
        "On iPhone or iPad, first add ArewaVanta to your Home Screen, then open it from its icon and enable notifications here. Web Push requires iOS/iPadOS 16.4 or later.",
      );
      return;
    }
    if (!data?.push_public_key) {
      setError("Push notifications aren’t configured for this service yet.");
      return;
    }
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setError("This browser doesn’t support notifications.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Safari on iOS requires the permission request to come directly from
      // the user's tap, so start it before awaiting service-worker operations.
      const permissionRequest = subscribed
        ? null
        : Notification.requestPermission();
      const reg = await navigator.serviceWorker.register(
        "/service-worker.js",
      );
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api.unsubscribePush(token, existing.endpoint);
        await existing.unsubscribe();
        setSubscribed(false);
      } else {
        const permission = await (permissionRequest ?? Promise.resolve(Notification.permission));
        if (permission !== "granted")
          throw new Error(
            "Notifications are blocked. Allow them in your browser settings and try again.",
          );
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
        err instanceof Error
          ? err.message
          : "We couldn’t update your notification settings.",
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
          : "We couldn’t mark your updates as read.",
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
        <section className="admin-alert-panel" aria-label="Recent activity">
          <div className="admin-alert-heading">
            <strong>Notifications & activity</strong>
            {data.unread > 0 && <button onClick={read}>Mark all read</button>}
          </div>
          <p className="admin-alert-help">Get alerts when team slots change or match results are published.</p>
          <button
            className="admin-push-toggle"
            disabled={busy || !subscriptionReady}
            onClick={toggle}
          >
            {busy
              ? "Updating…"
              : !subscriptionReady
                ? "Loading notification settings…"
              : subscribed
                ? "Turn off push notifications"
                : "Enable push notifications"}
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
                  <p>{activityText(item.message)}</p>
                  <small title={activityFullTime(item.created_at)}>
                    {activityTime(item.created_at)}
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
