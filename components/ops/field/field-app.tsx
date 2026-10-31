"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronRight, CircleAlert, CloudOff, CloudUpload, MapPin, RefreshCw, Truck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/photo-upload";
import { applyOps, mergeOps, sameTarget } from "@/lib/ops/field/apply";
import { openStore, type FieldStore } from "@/lib/ops/field/store";
import { syncNow } from "@/lib/ops/field/sync";
import type { Bundle, Failed, FieldTrip, Op, Queued } from "@/lib/ops/field/types";
import { Ctx, dayLabel, localDate, nowIso, uuid, type FieldCtx } from "./bits";
import { TripView } from "./trip-view";

// AMBIT-OPS crew work orders, on the phone, with or without signal. Everything the crew does is kept
// on the phone first and sent when there's signal; the screen never waits for the network.

const OP_LABEL: Record<Op["t"], string> = { time: "Time punch", day: "Spray log", mat: "Material", area: "Area", photo: "Photo", wo: "Notes", finish: "Finish" };

export function FieldApp({ userId, brand }: { userId: string; brand: string }) {
  const [store, setStore] = useState<FieldStore | null>(null);
  const [base, setBase] = useState<Bundle | null>(null);
  const [box, setBox] = useState<Queued[]>([]);
  const [failed, setFailed] = useState<Failed[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const syncingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- open the phone's copy, then try to send and refresh
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await openStore(userId);
      if (!alive) return;
      setStore(s);
      const [b, q, f] = await Promise.all([s.getBundle(), s.outbox(), s.failed()]);
      if (!alive) return;
      setBase(b);
      setBox(q);
      setFailed(f);
      setLoaded(true);
      try {
        // "Open in field view" from the office links straight to a trip.
        const fromLink = new URLSearchParams(window.location.search).get("trip");
        const t = fromLink && /^[0-9a-f-]{36}$/i.test(fromLink) ? fromLink : sessionStorage.getItem("ambit-field-trip");
        if (t) setTripId(t);
        if (fromLink) window.history.replaceState(null, "", "/ops/field");
      } catch {
        /* private mode */
      }
    })();
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    return () => {
      alive = false;
    };
  }, [userId]);

  const doSync = useCallback(
    async (pull = true) => {
      if (!store || syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const r = await syncNow(store, { pull });
        const [q, f] = await Promise.all([store.outbox(), store.failed()]);
        setBox(q);
        setFailed(f);
        if (r.bundle) setBase(r.bundle);
        if (r.ok) {
          setLastSync(Date.now());
          setErr(null);
          setOnline(true);
        } else if (r.offline) {
          setOnline(false);
        } else {
          setErr(r.error ?? "Couldn't reach the office. Your work is saved on this phone.");
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [store],
  );

  useEffect(() => {
    if (!store) return;
    doSync();
    const on = () => {
      setOnline(true);
      doSync();
    };
    const off = () => setOnline(false);
    const vis = () => document.visibilityState === "visible" && doSync();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    const every = setInterval(() => navigator.onLine !== false && doSync(), 45000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(every);
    };
  }, [store, doSync]);

  // ---------- keep this page on the phone for no-signal days
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => navigator.serviceWorker.ready.then(() => (reg.active ?? reg.waiting ?? reg.installing)?.postMessage("save-field")))
      .catch(() => {});
  }, []);

  // ---------- making a change
  // One change at a time, in the order they were made (two quick taps never overwrite each other).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queue = useCallback(
    (ops: Op | Op[]) => {
      if (!store) return;
      const list = Array.isArray(ops) ? ops : [ops];
      chain.current = chain.current.then(async () => {
        let cur = await store.outbox();
        for (const op of list) {
          // While a send is running, add instead of merging (the running send may already have the older one).
          const prev = !syncingRef.current ? [...cur].reverse().find((q) => sameTarget(q.op, op)) : undefined;
          const lastSame = prev && cur[cur.length - 1]?.seq === prev.seq;
          if (prev && (lastSame || op.t === "day" || op.t === "wo")) {
            await store.replace(prev.seq, mergeOps(prev.op, op));
          } else {
            await store.add(op);
          }
          cur = await store.outbox();
        }
        setBox(cur);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => navigator.onLine !== false && doSync(), 1200);
      }).catch(() => {});
    },
    [store, doSync],
  );

  const view = useMemo(() => applyOps(base, box.map((q) => q.op)), [base, box]);

  // ---------- photos: the phone's own copy first, otherwise a link from the server
  const blobUrls = useRef<Record<string, string>>({});
  const photoUrl = useCallback((id: string) => urls[id] ?? blobUrls.current[id] ?? null, [urls]);
  useEffect(() => {
    if (!store || !view) return;
    const photos = view.trips.flatMap((t) => t.photos);
    const missing = photos.filter((p) => !urls[p.id]);
    if (!missing.length) return;
    let alive = true;
    (async () => {
      const add: Record<string, string> = {};
      const need: { id: string; path: string }[] = [];
      for (const p of missing) {
        const b = await store.blob(p.id);
        if (b) {
          if (!blobUrls.current[p.id]) blobUrls.current[p.id] = URL.createObjectURL(b.blob);
          add[p.id] = blobUrls.current[p.id];
        } else need.push({ id: p.id, path: p.path });
      }
      if (need.length && navigator.onLine !== false) {
        const { data } = await createClient().storage.from("ops-photos").createSignedUrls(need.map((n) => n.path), 3600);
        for (const d of data ?? []) {
          const hit = need.find((n) => n.path === d.path);
          if (hit && d.signedUrl) add[hit.id] = d.signedUrl;
        }
      }
      if (alive && Object.keys(add).length) setUrls((u) => ({ ...u, ...add }));
    })();
    return () => {
      alive = false;
    };
  }, [store, view, urls]);

  const addPhoto = useCallback(
    async (trip: FieldTrip, file: File, kind: "before" | "after" | "issue" | "other", date: string) => {
      if (!store || !view) return "This phone can't save photos.";
      if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return "Only photos can be added.";
      const blob = await shrink(file);
      const type = blob.type === "image/png" || blob.type === "image/webp" ? blob.type : "image/jpeg";
      const id = uuid();
      const path = `${view.company}/${trip.id}/${id}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
      await store.putBlob({ id, path, trip: trip.id, type, blob, uploaded: false, at: nowIso() });
      blobUrls.current[id] = URL.createObjectURL(blob);
      queue({ t: "photo", trip: trip.id, at: nowIso(), id, date, kind, path, taken_at: nowIso() });
      return null;
    },
    [store, view, queue],
  );

  const pickTrip = (id: string | null) => {
    setTripId(id);
    try {
      if (id) sessionStorage.setItem("ambit-field-trip", id);
      else sessionStorage.removeItem("ambit-field-trip");
    } catch {
      /* private mode */
    }
    window.scrollTo({ top: 0 });
  };

  const ctx: FieldCtx | null = view
    ? {
        bundle: view,
        queue,
        isLead: (t) => view.office || view.lead || t.crew.some((c) => c.me && c.lead),
        editable: (t) => (t.wo?.status ?? "open") === "open",
        photoUrl,
        addPhoto,
        online,
      }
    : null;

  const waiting = box.length;
  const status = (
    <div className={`fld-status ${!online ? "off" : waiting ? "wait" : "ok"}`} role="status">
      {!online ? <CloudOff size={16} /> : waiting ? <CloudUpload size={16} /> : <RefreshCw size={16} className={syncing ? "spin" : ""} />}
      <span className="grow">
        {!online
          ? waiting
            ? `No signal · ${waiting} change${waiting === 1 ? "" : "s"} saved on this phone`
            : "No signal · your work saves on this phone"
          : syncing
            ? waiting
              ? `Sending ${waiting} change${waiting === 1 ? "" : "s"}…`
              : "Getting the latest…"
            : waiting
              ? `${waiting} change${waiting === 1 ? "" : "s"} waiting to send`
              : lastSync
                ? `All sent · ${agoText(lastSync)}`
                : "Connected"}
      </span>
      <button type="button" className="btn sm ghost" onClick={() => doSync()} disabled={syncing || !store}>
        {syncing ? "…" : "Send now"}
      </button>
    </div>
  );

  const trip = view && tripId ? view.trips.find((t) => t.id === tripId) ?? null : null;

  return (
    <main className="shell fld">
      {status}
      {err ? (
        <div className="alert warn small" role="alert">
          <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />
          <span className="grow">{err}</span>
          {/sign in/i.test(err) ? <a className="btn sm dark" href="/signin?next=/ops/field">Sign in</a> : null}
        </div>
      ) : null}
      {failed.length ? (
        <div className="alert err small" role="alert">
          <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />
          <span className="grow col tight">
            <b>{failed.length} change{failed.length === 1 ? "" : "s"} couldn&apos;t be saved</b>
            {failed.slice(-4).map((f, i) => (
              <span key={i} className="tiny">
                {OP_LABEL[f.op.t] ?? "Change"}: {f.error}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="iconbtn"
            aria-label="Got it"
            onClick={async () => {
              await store?.clearFailed();
              setFailed([]);
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {!loaded ? (
        <div className="card"><span className="muted small">Opening your work orders…</span></div>
      ) : !view ? (
        <div className="card col" style={{ gap: 8 }}>
          <b>Work orders</b>
          <span className="small muted">
            {online ? "Getting your trips…" : "No signal, and this phone hasn't downloaded your trips yet. Open this page once with signal and it will work offline after that."}
          </span>
        </div>
      ) : trip && ctx ? (
        <Ctx.Provider value={ctx}>
          <TripView trip={trip} onBack={() => pickTrip(null)} />
        </Ctx.Provider>
      ) : (
        <TripList bundle={view} brand={brand} onPick={pickTrip} />
      )}
    </main>
  );
}

function agoText(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}

function tripState(t: FieldTrip) {
  const s = t.wo?.status;
  if (s === "reviewed") return { label: "Reviewed", cls: "ok" };
  if (s === "done") return { label: "Finished", cls: "ok" };
  if (t.time.length || t.materials.length || t.days_log.length || t.status === "in_progress") return { label: "In progress", cls: "warn" };
  return { label: "Not started", cls: "grey" };
}

function TripList({ bundle, brand, onPick }: { bundle: Bundle; brand: string; onPick: (id: string) => void }) {
  const today = localDate();
  const groups: { title: string; trips: FieldTrip[] }[] = [
    { title: "Today", trips: bundle.trips.filter((t) => t.start_date && t.end_date && t.start_date <= today && t.end_date >= today) },
    { title: "Still open from earlier", trips: bundle.trips.filter((t) => t.end_date && t.end_date < today && (t.wo?.status ?? "open") === "open") },
    { title: "Coming up", trips: bundle.trips.filter((t) => t.start_date && t.start_date > today) },
    { title: "Finished", trips: bundle.trips.filter((t) => t.end_date && t.end_date < today && (t.wo?.status ?? "open") !== "open") },
  ].filter((g) => g.trips.length);
  return (
    <>
      <header className="col tight">
        <span className="eyebrow">{bundle.settings.brand || brand}</span>
        <h1 className="h1" style={{ margin: 0 }}>Work orders</h1>
        <span className="small muted">{bundle.me_name ? `${bundle.me_name} · ` : ""}{bundle.office ? "every rig" : "your trips"}</span>
      </header>
      {!bundle.trips.length ? (
        <div className="card col" style={{ gap: 6 }}>
          <b>No trips right now</b>
          <span className="small muted">When the office puts you on a trip, it shows here (the next 7 days).</span>
        </div>
      ) : null}
      {groups.map((g) => (
        <section key={g.title} className="col" style={{ gap: 8 }}>
          <b className="small muted fld-group">{g.title}</b>
          {g.trips.map((t) => {
            const st = tripState(t);
            return (
              <button key={t.id} type="button" className="card fld-trip" onClick={() => onPick(t.id)}>
                <span className="row between" style={{ gap: 8 }}>
                  <span className="tiny faint">
                    <CalendarDays size={13} style={{ verticalAlign: -2 }} /> {dayLabel(t.start_date)}
                    {t.days > 1 ? ` · ${t.days} days` : ""}
                    {t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ""}
                  </span>
                  <span className={`pill ${st.cls}`}>{st.label}</span>
                </span>
                <b className="fld-trip-name">{t.customer.name}</b>
                <span className="small muted ellipsis">{t.job.title || t.name} · Job #{t.job.number}{t.seq > 1 ? `-${t.seq}` : ""}</span>
                {t.address ? <span className="tiny faint ellipsis"><MapPin size={12} style={{ verticalAlign: -2 }} /> {t.address}</span> : null}
                <span className="row between">
                  <span className="tiny faint ellipsis">{t.rig ? <><Truck size={12} style={{ verticalAlign: -2 }} /> {t.rig.name} · </> : null}{t.crew.map((c) => c.name.split(" ")[0]).join(", ")}</span>
                  <ChevronRight size={18} className="faint" />
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}
