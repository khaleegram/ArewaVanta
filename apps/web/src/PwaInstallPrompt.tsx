import { useEffect, useRef, useState } from "react";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type PromptMode = "native" | "ios" | "android" | "android-help" | null;
const DISMISSED_KEY = "arewavanta-install-dismissed-until";
const DISMISS_DAYS = 14;

function wasDismissed() {
  try {
    return Number(localStorage.getItem(DISMISSED_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(
      DISMISSED_KEY,
      String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000),
    );
  } catch {}
}

function isStandalone() {
  const safariNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    safariNavigator.standalone === true
  );
}

function isAppleMobile() {
  const userAgent = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isIOS || isIPadOS;
}

export default function PwaInstallPrompt() {
  const deferredPrompt = useRef<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<PromptMode>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    if (isStandalone() || wasDismissed()) return;

    if (isAppleMobile()) setMode("ios");
    else if (/Android/i.test(navigator.userAgent)) setMode("android");

    function onInstallAvailable(event: Event) {
      event.preventDefault();
      if (wasDismissed() || isStandalone()) return;
      deferredPrompt.current = event as InstallPromptEvent;
      setMode("native");
    }

    function onInstalled() {
      deferredPrompt.current = null;
      setMode(null);
    }

    function onDisplayModeChange(event: MediaQueryListEvent) {
      if (event.matches) onInstalled();
    }

    window.addEventListener("beforeinstallprompt", onInstallAvailable);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallAvailable);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  if (!mode) return null;

  function dismiss() {
    rememberDismissal();
    deferredPrompt.current = null;
    setMode(null);
  }

  async function install() {
    const promptEvent = deferredPrompt.current;
    if (!promptEvent) {
      setMode("android-help");
      return;
    }
    setBusy(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      deferredPrompt.current = null;
      setMode(null);
    } catch {
      deferredPrompt.current = null;
      setMode(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className={`pwa-install-card${mode === "ios" ? " is-ios" : ""}${mode.startsWith("android") ? " is-android" : ""}`}
      aria-label="Install ArewaVanta"
      aria-live="polite"
    >
      <div className="pwa-install-heading">
        <img src="/favicon-192.png" width="44" height="44" alt="" />
        <div>
          <p className="pwa-install-eyebrow">
            {mode === "ios"
              ? "ADD TO HOME SCREEN"
              : mode.startsWith("android")
                ? "ADD TO YOUR HOME SCREEN"
                : "TAKE AREWAVANTA WITH YOU"}
          </p>
          <h2>
            {mode === "ios"
              ? "Install on iPhone or iPad"
              : mode === "android-help"
                ? "Install from your browser menu"
                : "Install ArewaVanta"}
          </h2>
        </div>
        <button
          className="pwa-install-close"
          type="button"
          aria-label="Dismiss install instructions"
          onClick={dismiss}
        >
          ×
        </button>
      </div>

      {mode === "ios" ? (
        <>
          <ol className="pwa-install-steps">
            <li>
              <span>1</span>
              In Safari, tap <strong>Share</strong>
              <svg className="pwa-share-icon" viewBox="0 0 20 20" aria-label="Share button">
                <path d="M10 12V2m-4 4 4-4 4 4" />
                <path d="M4 9v8h12V9" />
              </svg>
            </li>
            <li><span>2</span>Choose <strong>Add to Home Screen</strong>.</li>
            <li><span>3</span>Tap <strong>Add</strong> to finish.</li>
          </ol>
          <p className="pwa-install-ios-note">If you don’t see that option, open arewavanta.com in Safari first.</p>
        </>
      ) : mode === "android-help" ? (
        <ol className="pwa-install-steps">
          <li><span>1</span>Open your browser menu <strong>⋮</strong>.</li>
          <li><span>2</span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li><span>3</span>Confirm by tapping <strong>Install</strong> or <strong>Add</strong>.</li>
        </ol>
      ) : (
        <>
          <p className="pwa-install-copy">
            Keep weekly scrims, standings and results one tap away.
          </p>
          <button
            className="pwa-install-action"
            type="button"
            onClick={mode === "native" ? install : () => setMode("android-help")}
            disabled={busy}
          >
            {busy ? "Opening install…" : "Install app"}
            <span aria-hidden="true">↗</span>
          </button>
        </>
      )}
    </aside>
  );
}
