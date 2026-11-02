import { useSyncExternalStore } from "react";

let pendingRelease: string | null = null;
let workerRegistration: Promise<ServiceWorkerRegistration> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => pendingRelease;

export function appWorker(): Promise<ServiceWorkerRegistration> {
  if (!workerRegistration) {
    workerRegistration = navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready).catch((error) => { workerRegistration = null; throw error; });
  }
  return workerRegistration;
}

function isEditing() {
  return document.querySelector('[data-unsaved="true"], form[data-update-dirty="true"]') !== null;
}
function reloadRelease() {
  if (!pendingRelease) return;
  // Protect against stale CDN responses causing repeated reloads during a rollout.
  try {
    const last = JSON.parse(sessionStorage.getItem("arewavanta-last-update") || "null");
    if (last?.buildId === pendingRelease && Date.now() - last.at < 60000) return;
    sessionStorage.setItem("arewavanta-last-update", JSON.stringify({ buildId: pendingRelease, at: Date.now() }));
  } catch {}
  window.location.reload();
}

export function startAppUpdates() {
  if (!import.meta.env.PROD) return () => {};
  let stopped = false;
  let checking = false;
  let lastCheck = 0;
  const apply = () => {
    if (pendingRelease && !stopped && document.visibilityState === "visible" && !isEditing()
      && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement)) reloadRelease();
  };
  const foundRelease = (buildId: unknown) => {
    if (typeof buildId !== "string" || !/^[a-z0-9-]{8,80}$/i.test(buildId) || buildId === __APP_BUILD_ID__ || stopped) return;
    pendingRelease = buildId;
    notify();
    apply();
  };
  const check = async () => {
    apply();
    if (stopped || checking || !navigator.onLine || document.visibilityState !== "visible" || Date.now() - lastCheck < 5000) return;
    lastCheck = Date.now(); checking = true;
    try {
      const response = await fetch(`/release.json?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) foundRelease((await response.json()).buildId);
      if ("serviceWorker" in navigator) void appWorker().then((registration) => registration.update()).catch(() => {});
    } catch { /* Keep the current page available while disconnected. */ }
    finally { checking = false; }
  };
  const message = (event: MessageEvent) => { if (event.data?.type === "AREWAVANTA_RELEASE") foundRelease(event.data.buildId); };
  const markForm = (event: Event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    const form = field.closest("form");
    if (!form || field.type === "search" || form.matches('[role="search"], [class*="search"], [class*="filter"]')) return;
    form.dataset.updateDirty = "true";
  };
  const resetForm = (event: Event) => { if (event.target instanceof HTMLFormElement) delete event.target.dataset.updateDirty; };
  const interval = window.setInterval(check, 60000);
  const applyInterval = window.setInterval(apply, 2000);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  window.addEventListener("pageshow", check);
  document.addEventListener("visibilitychange", check);
  document.addEventListener("input", markForm);
  document.addEventListener("change", markForm);
  document.addEventListener("reset", resetForm);
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", message);
  void check();
  return () => {
    stopped = true;
    clearInterval(interval); clearInterval(applyInterval);
    window.removeEventListener("focus", check); window.removeEventListener("online", check); window.removeEventListener("pageshow", check);
    document.removeEventListener("visibilitychange", check); document.removeEventListener("input", markForm); document.removeEventListener("change", markForm); document.removeEventListener("reset", resetForm);
    if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", message);
  };
}

export function AppUpdateNotice() {
  const release = useSyncExternalStore(subscribe, snapshot);
  if (!release) return null;
  return <aside className="app-update-notice" role="status"><div><strong>A new version is ready</strong><span>Finish your changes, then refresh to update.</span></div><button type="button" onClick={reloadRelease}>Refresh app ↗</button></aside>;
}
