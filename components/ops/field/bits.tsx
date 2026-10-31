"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Bundle, FieldTrip, Op } from "@/lib/ops/field/types";

// Shared pieces of the crew field app: the app context, and inputs that save when you leave the box
// (so a change goes out once per field, not once per letter).

export type FieldCtx = {
  bundle: Bundle;
  queue: (ops: Op | Op[]) => void;
  /** Can change anything on this trip's work order (crew lead or the office). */
  isLead: (t: FieldTrip) => boolean;
  /** The work order is still open on this phone. */
  editable: (t: FieldTrip) => boolean;
  photoUrl: (id: string, path: string) => string | null;
  addPhoto: (trip: FieldTrip, file: File, kind: "before" | "after" | "issue" | "other", date: string) => Promise<string | null>;
  online: boolean;
};

export const Ctx = createContext<FieldCtx | null>(null);
export const useField = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Field app context missing");
  return c;
};

export const nowIso = () => new Date().toISOString();
export const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Today on the phone (YYYY-MM-DD, local time). */
export const localDate = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const timeOf = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "–");
export const dayLabel = (d: string | null | undefined) => {
  if (!d) return "";
  const today = localDate();
  const t = new Date(`${d}T12:00:00`);
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  const yesterday = localDate(new Date(Date.now() - 86400000));
  const base = t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return d === today ? `Today · ${base}` : d === tomorrow ? `Tomorrow · ${base}` : d === yesterday ? `Yesterday · ${base}` : base;
};
/** "HH:MM" for a time box, from an ISO time. */
export const hhmm = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** An ISO time from a day (YYYY-MM-DD) and a time box value (HH:MM), in the phone's time zone. */
export const atTime = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString();

type Common = { label: string; hint?: string; disabled?: boolean; unit?: string; wide?: boolean };

/** A text box that saves when you leave it (or press Enter). */
export function TextField({ label, value, onSave, hint, disabled, placeholder, multiline, wide, maxLength = 300 }: Common & { value: string | null | undefined; onSave: (v: string) => void; placeholder?: string; multiline?: boolean; maxLength?: number }) {
  const [v, setV] = useState(value ?? "");
  const last = useRef(value ?? "");
  useEffect(() => {
    if ((value ?? "") !== last.current) {
      last.current = value ?? "";
      setV(value ?? "");
    }
  }, [value]);
  const commit = () => {
    const t = v.trim();
    if (t !== (last.current ?? "").trim()) {
      last.current = t;
      onSave(t);
    }
  };
  return (
    <label className={`field fld-f${wide ? " wide" : ""}`}>
      <span className="fld-l">{label}</span>
      {multiline ? (
        <textarea className="input" rows={3} value={v} maxLength={maxLength} disabled={disabled} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      ) : (
        <input className="input" value={v} maxLength={maxLength} disabled={disabled} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      )}
      {hint ? <span className="tiny faint">{hint}</span> : null}
    </label>
  );
}

/** A number box that saves when you leave it. Empty = no reading. */
export function NumField({ label, value, onSave, hint, disabled, unit, wide, step = "any", min, max }: Common & { value: unknown; onSave: (v: number | null) => void; step?: string; min?: number; max?: number }) {
  const show = value === null || value === undefined || value === "" ? "" : String(value);
  const [v, setV] = useState(show);
  const last = useRef(show);
  useEffect(() => {
    if (show !== last.current) {
      last.current = show;
      setV(show);
    }
  }, [show]);
  const commit = () => {
    const t = v.trim().replace(/,/g, "");
    if (t === last.current) return;
    const n = t === "" ? null : Number(t);
    if (n !== null && !Number.isFinite(n)) {
      setV(last.current);
      return;
    }
    if (n !== null && ((min !== undefined && n < min) || (max !== undefined && n > max))) {
      setV(last.current);
      return;
    }
    last.current = t;
    onSave(n);
  };
  return (
    <label className={`field fld-f${wide ? " wide" : ""}`}>
      <span className="fld-l">{label}{unit ? <i> {unit}</i> : null}</span>
      <input className="input" inputMode="decimal" type="text" step={step} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      {hint ? <span className="tiny faint">{hint}</span> : null}
    </label>
  );
}

/** Pick one (buttons). Tap the picked one again to clear it. */
export function Pick({ label, value, options, onSave, disabled, wide }: Common & { value: unknown; options: (string | { v: string; l: string })[]; onSave: (v: string | null) => void }) {
  const opts = options.map((o) => (typeof o === "string" ? { v: o, l: o } : o));
  return (
    <div className={`field fld-f${wide ? " wide" : ""}`} role="radiogroup" aria-label={label}>
      <span className="fld-l">{label}</span>
      <div className="chips wrap fld-chips">
        {opts.map((o) => (
          <button key={o.v} type="button" className={`chip sm${value === o.v ? " on" : ""}`} disabled={disabled} aria-pressed={value === o.v} onClick={() => onSave(value === o.v ? null : o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

export const YES_NO = [{ v: "yes", l: "Yes" }, { v: "no", l: "No" }];

export function Badge({ check, children }: { check: "ok" | "bad" | null; children: React.ReactNode }) {
  return <span className={`pill ${check === "ok" ? "ok" : check === "bad" ? "red" : "grey"}`}>{children}</span>;
}

/** Signature box: draw with a finger (or mouse). Gives back a PNG data URL, or null when cleared. */
export function SignaturePad({ onChange, disabled }: { onChange: (png: string | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = c.clientWidth || 320;
    const h = c.clientHeight || 160;
    c.width = Math.round(w * ratio);
    c.height = Math.round(h * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d");
    const p = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const p = pos(e);
    ctx?.lineTo(p.x, p.y);
    ctx?.stroke();
    inked.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (inked.current && ref.current) onChange(exportPng(ref.current));
  };
  const clear = () => {
    const c = ref.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    inked.current = false;
    onChange(null);
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <canvas ref={ref} className="fld-sig" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Sign here" />
      <div className="row between">
        <span className="tiny faint">Sign with your finger</span>
        <button type="button" className="btn sm ghost" onClick={clear} disabled={disabled}>Clear</button>
      </div>
    </div>
  );
}

/** The signature as a white-backed PNG, at most 600 px wide (small enough to send with no signal). */
function exportPng(c: HTMLCanvasElement) {
  const scale = Math.min(1, 600 / c.width);
  const out = document.createElement("canvas");
  out.width = Math.round(c.width * scale);
  out.height = Math.round(c.height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return c.toDataURL("image/png");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(c, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
