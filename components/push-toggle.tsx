"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, LoaderCircle } from "lucide-react";
import { pushKey, removePush, savePush, testPush } from "@/app/(app)/push-actions";

// Phone notifications on this phone or computer. iPhone: the app has to be on the Home Screen first
// (Share > Add to Home Screen), then opened from there.

function toKey(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
const deviceName = () => {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows computer" : "This device";
};

export function PushToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"checking" | "off" | "on" | "blocked" | "unsupported" | "iphone">("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !standalone ? "iphone" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        return;
      }
      const key = await pushKey();
      if (!key) {
        setMsg("Notifications aren't set up on the server yet. Ask Jeremiah.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) }));
      const res = await savePush(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, deviceName());
      if (!res.ok) return setMsg(res.error ?? "Couldn't turn them on.");
      setState("on");
      await testPush();
      setMsg("On. A test notification is on its way.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't turn them on.");
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const note =
    state === "iphone"
      ? "On iPhone: tap Share, then Add to Home Screen, open AMBIT Intelligence from the Home Screen, and turn notifications on here."
      : state === "blocked"
        ? "Notifications are blocked for this site. Allow them in the browser or phone settings, then come back."
        : state === "unsupported"
          ? "This browser can't show notifications."
          : state === "on"
            ? "You'll get a notification for direct messages, @mentions and conversations you follow."
            : "Get a notification on this phone or computer for direct messages and @mentions.";

  return (
    <div className={`push-toggle${compact ? " compact" : ""}`}>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <b className="small">{state === "on" ? "Notifications are on" : "Phone notifications"}</b>
        <span className="tiny muted">{msg ?? note}</span>
      </div>
      {state === "off" || state === "on" ? (
        <button type="button" className={`btn sm${state === "on" ? " dark" : ""}`} onClick={state === "on" ? turnOff : turnOn} disabled={busy}>
          {busy ? <LoaderCircle size={15} className="spin" /> : state === "on" ? <BellOff size={15} /> : <Bell size={15} />} {state === "on" ? "Turn off" : "Turn on"}
        </button>
      ) : null}
    </div>
  );
}
