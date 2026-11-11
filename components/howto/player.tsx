"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { HOWTO, clock, howtoPath } from "@/lib/howto";

// Which videos this person has watched, kept on their own phone or computer (nothing is saved to the app).
const KEY = "howto-watched";
function readWatched(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}
function markWatched(slug: string) {
  try {
    const all = readWatched();
    if (!all.includes(slug)) localStorage.setItem(KEY, JSON.stringify([...all, slug]));
  } catch {
    /* private browsing: just don't remember */
  }
}

/** A small "Watched" check on the video list. */
export function WatchedMark({ slug }: { slug: string }) {
  const [seen, setSeen] = useState(false);
  useEffect(() => setSeen(readWatched().includes(slug)), [slug]);
  return seen ? (
    <span className="howto-seen"><CircleCheck size={14} strokeWidth={2.4} /> Watched</span>
  ) : null;
}

/** The video, with its steps underneath: tap a step to jump to it; the step playing is highlighted. */
export function HowToPlayer({ slug, src, poster, chapters }: { slug: string; src: string; poster: string; chapters: { t: number; label: string }[] }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(-1);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const tick = () => {
      let i = -1;
      for (let k = 0; k < chapters.length; k++) if (v.currentTime + 0.05 >= chapters[k].t) i = k;
      setNow(v.currentTime > 0 ? i : -1);
      if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime / v.duration > 0.9) markWatched(slug);
    };
    const done = () => markWatched(slug);
    v.addEventListener("timeupdate", tick);
    v.addEventListener("seeked", tick);
    v.addEventListener("ended", done);
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("seeked", tick);
      v.removeEventListener("ended", done);
    };
  }, [slug, chapters]);

  const jump = (t: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => {});
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      <video ref={ref} className="lesson-video" src={src} poster={poster} controls playsInline preload="metadata" />
      <section className="section">
        <div className="eyebrow">Steps · tap one to jump to it</div>
        <ol className="howto-steps">
          {chapters.map((c, i) => (
            <li key={i}>
              <button type="button" className={i === now ? "on" : ""} onClick={() => jump(c.t)}>
                <span className="n">{i + 1}</span>
                <span className="l">{c.label}</span>
                <span className="t">{clock(c.t)}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/** Admins only: upload (or replace) this video. It goes straight from the browser to storage. */
export function HowToUpload({ slug, has }: { slug: string; has: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(false);
    setBusy(`Uploading ${file.name} (${Math.max(1, Math.round(file.size / 1048576))} MB). Keep this page open.`);
    const up = await supabase.storage.from("academy").upload(howtoPath(slug), file, { contentType: "video/mp4", upsert: true, cacheControl: "3600" });
    setBusy(null);
    if (input.current) input.current.value = "";
    if (up.error) {
      setError(`The upload didn't work: ${up.error.message}`);
      return;
    }
    setDone(true);
    router.refresh();
  };

  return (
    <div className="card howto-admin">
      <div className="row between" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 2 }}>
          <b className="small">Admin: {has ? "replace this video" : "upload this video"}</b>
          <span className="tiny faint">MP4 file. Only admins see this box.</span>
        </div>
        <label className="btn sm">
          <Upload size={16} /> {has ? "Replace video" : "Upload video"}
          <input
            ref={input}
            id="howto-upload-input"
            type="file"
            accept="video/mp4"
            hidden
            disabled={!!busy}
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
      </div>
      {busy ? <div className="tiny muted" role="status">{busy}</div> : null}
      {done ? <div className="tiny" role="status" style={{ color: "var(--ok-text)" }}>Uploaded. Everyone at AMBIT can watch it now.</div> : null}
      {error ? <div className="tiny" role="alert" style={{ color: "var(--err-text)" }}>{error}</div> : null}
    </div>
  );
}

/** Which video a file is for: "3 - How to See What's in Stock.mp4" -> video 3 (or a file named after the video's slug). */
function matchVideo(name: string) {
  const n = /^\s*(\d{1,2})\s*[-–.)_ ]/.exec(name)?.[1];
  const byNo = n ? HOWTO.find((v) => v.n === Number(n)) : null;
  if (byNo) return byNo;
  const low = name.toLowerCase();
  return HOWTO.find((v) => low.includes(v.slug)) ?? null;
}

/** Admins only, on the video list: pick several MP4s at once and each goes to its video by the number at the start of its name. */
export function HowToBulkUpload() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<{ text: string; ok?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true);
    const out: { text: string; ok?: boolean }[] = files.map((f) => ({ text: `${f.name}: waiting` }));
    setLines([...out]);
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const v = matchVideo(f.name);
      if (!v) {
        out[i] = { text: `${f.name}: skipped (start the file name with the video number, like "3 - ...")`, ok: false };
        setLines([...out]);
        continue;
      }
      out[i] = { text: `Video ${v.n}, ${v.title}: uploading (${Math.max(1, Math.round(f.size / 1048576))} MB)...` };
      setLines([...out]);
      const up = await supabase.storage.from("academy").upload(howtoPath(v.slug), f, { contentType: "video/mp4", upsert: true, cacheControl: "3600" });
      out[i] = up.error ? { text: `Video ${v.n}, ${v.title}: didn't upload (${up.error.message})`, ok: false } : { text: `Video ${v.n}, ${v.title}: uploaded`, ok: true };
      if (!up.error) done++;
      setLines([...out]);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    out.push({ text: done ? `Done: ${done} video${done === 1 ? "" : "s"} uploaded. Everyone at AMBIT can watch ${done === 1 ? "it" : "them"} now.` : "Nothing was uploaded.", ok: done > 0 });
    setLines([...out]);
    router.refresh();
  };

  return (
    <div className="card howto-admin">
      <div className="row between" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 2 }}>
          <b className="small">Admin: upload videos</b>
          <span className="tiny faint">Pick one or more MP4s at once. A file named &ldquo;3 - &hellip;&rdquo; goes to video 3 (it replaces the old one). Only admins see this box.</span>
        </div>
        <label className="btn sm">
          <Upload size={16} /> {busy ? "Uploading..." : "Upload videos"}
          <input ref={input} id="howto-bulk-input" type="file" accept="video/mp4" multiple hidden disabled={busy} onChange={(e) => pick(e.target.files)} />
        </label>
      </div>
      {lines.length ? (
        <div className="col" style={{ gap: 3 }} role="status">
          {lines.map((l, i) => (
            <div key={i} className="tiny" style={{ color: l.ok === true ? "var(--ok-text)" : l.ok === false ? "var(--err-text)" : "var(--text2)" }}>{l.text}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
