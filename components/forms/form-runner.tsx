"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Eye, EyeOff, FileText, LoaderCircle, Lock, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { answer, arr, check, files, isReq, isShown, optL, optV, str, visibleSteps, type Data, type Field, type FileRef, type Val } from "@/lib/forms/engine";
import { SPECS } from "@/lib/forms/specs";
import { saveForm } from "@/lib/forms/actions";

export type Person = { id: string; name: string };
export type Cust = { id: string; name: string; phone: string | null; email: string | null; contact_name: string | null; city: string | null; state: string | null };

const fmtTel = (v: string) => { const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10); return d.length < 4 ? d : d.length < 7 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
const fmtSsn = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 9); return d.length < 4 ? d : d.length < 6 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`; };
const fmtEin = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 9); return d.length < 3 ? d : `${d.slice(0, 2)}-${d.slice(2)}`; };

/** Draw a signature with a finger or mouse. */
function SignaturePad({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2; c.height = r.height * 2;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div className="fx-sign">
      <canvas ref={ref} aria-label={`${label}: sign here`} role="img"
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext("2d")!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; }}
        onPointerUp={() => { drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL("image/png")); }} />
      <span className="fx-sign-line">✕ Sign above</span>
      {value ? <button type="button" className="fx-sign-clear" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(""); }}><X size={14} /> Clear</button> : null}
    </div>
  );
}

function Uploads({ value, onChange, token, multi, accept }: { value: FileRef[]; onChange: (v: FileRef[]) => void; token?: string; multi?: boolean; accept?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function add(list: FileList) {
    setBusy(true); setErr("");
    const out = [...value];
    for (const f of Array.from(list)) {
      const fd = new FormData(); fd.set("file", f); if (token) fd.set("token", token);
      const r = await fetch("/api/forms/upload", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ error: "Upload failed. Try again." }));
      if (r.error) { setErr(r.error); break; }
      out.push(r as FileRef);
    }
    onChange(multi ? out : out.slice(-1));
    setBusy(false);
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      {value.map((f) => (
        <div key={f.path} className="fx-file"><FileText size={16} /><span className="grow ellipsis">{f.name}</span>
          <button type="button" className="icon-btn" onClick={() => onChange(value.filter((x) => x.path !== f.path))} aria-label={`Remove ${f.name}`}><Trash2 size={15} /></button></div>
      ))}
      {multi || !value.length ? (
        <label className={`fx-drop${busy ? " busy" : ""}`}>
          {busy ? <LoaderCircle size={18} className="spin" /> : <Paperclip size={18} />}
          <span>{busy ? "Uploading…" : value.length ? "Add another" : "Take a photo or pick a file"}</span>
          <input type="file" hidden multiple={multi} accept={accept} onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ""; }} />
        </label>
      ) : null}
      {err ? <span className="small red">{err}</span> : null}
    </div>
  );
}

function CustomerPick({ value, customers, onPick }: { value: string; customers: Cust[]; onPick: (c: Cust | null) => void }) {
  const cur = customers.find((c) => c.id === value);
  const [q, setQ] = useState(cur?.name ?? "");
  const [open, setOpen] = useState(false);
  const t = q.trim().toLowerCase();
  const list = t ? customers.filter((c) => c.name.toLowerCase().includes(t)).slice(0, 8) : [];
  return (
    <div className="fx-combo">
      <input className="input" value={q} placeholder="Start typing a customer" onChange={(e) => { setQ(e.target.value); setOpen(true); if (cur) onPick(null); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label="Customer" />
      {open && list.length ? (
        <div className="fx-combo-list" role="listbox">
          {list.map((c) => <button key={c.id} type="button" role="option" aria-selected={c.id === value} onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(c.name); setOpen(false); onPick(c); }}>
            <b>{c.name}</b><span className="tiny faint">{[c.contact_name, c.city && c.state ? `${c.city}, ${c.state}` : null].filter(Boolean).join(" · ")}</span></button>)}
        </div>
      ) : null}
      {cur ? <span className="tiny ok-text"><Check size={12} /> {cur.name}</span> : null}
    </div>
  );
}

function Secret({ f, v, set, err }: { f: Extract<Field, { t: "secret" }>; v: string; set: (v: string) => void; err?: string }) {
  const [show, setShow] = useState(false);
  const saved = v.startsWith("••••");
  if (saved) return <div className="fx-secret-saved"><Lock size={15} /> Saved {v} <button type="button" className="link-btn" onClick={() => set("")}>Change</button></div>;
  return (
    <div className="fx-secret">
      <input className={`input${err ? " bad" : ""}`} type={show ? "text" : "password"} autoComplete="off" inputMode={f.kind === "dl" ? "text" : "numeric"} value={v}
        placeholder={f.kind === "ssn" ? "123-45-6789" : f.kind === "ein" ? "12-3456789" : ""} onChange={(e) => set(f.kind === "ssn" ? fmtSsn(e.target.value) : f.kind === "ein" ? fmtEin(e.target.value) : e.target.value)} aria-label={f.label} />
      <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? "Hide" : "Show"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
}

/** One field. */
function Input({ f, d, set, err, ctx }: { f: Field; d: Data; set: (k: string, v: Val) => void; err?: string; ctx: { staff: Person[]; customers: Cust[]; token?: string; fill: (c: Cust | null) => void } }) {
  if (f.t === "head") return <div className="fx-head"><b>{f.text}</b>{f.sub ? <span className="small muted">{f.sub}</span> : null}</div>;
  if (f.t === "note") return <div className={`fx-note ${f.tone ?? "info"}`}>{f.text}</div>;
  const v = d[f.k];
  const s = str(v);
  const req = isReq(f, d);
  const id = `fx-${f.k}`;
  const label = f.label ? <label className="fx-label" htmlFor={id}>{f.label}{req ? <i aria-hidden="true">*</i> : null}</label> : null;
  let el: React.ReactNode = null;
  const cls = `input${err ? " bad" : ""}`;
  switch (f.t) {
    case "textarea": el = <textarea id={id} className={`${cls} fx-area`} value={s} rows={3} onChange={(e) => set(f.k, e.target.value)} placeholder={f.ph} />; break;
    case "number": case "money":
      el = <div className={`fx-affix${f.t === "money" ? " pre" : ""}`}>{f.t === "money" ? <span>$</span> : null}<input id={id} className={cls} inputMode="decimal" value={s} placeholder={f.ph}
        onChange={(e) => set(f.k, e.target.value.replace(f.t === "money" ? /[^\d.,]/g : /[^\d.-]/g, ""))} />{f.t === "number" && f.unit ? <span>{f.unit}</span> : null}</div>; break;
    case "choice":
      if (f.style === "select") el = <select id={id} className={`select${err ? " bad" : ""}`} value={s} onChange={(e) => set(f.k, e.target.value)}><option value="">Pick one</option>{f.opts.map((o) => <option key={optV(o)} value={optV(o)}>{optL(o)}</option>)}</select>;
      else el = (
        <div className={f.style === "cards" ? "fx-cards" : "fx-pills"} role={f.multi ? "group" : "radiogroup"} aria-label={f.label || undefined}>
          {f.opts.map((o) => {
            const on = f.multi ? arr(v).includes(optV(o)) : s === optV(o);
            return <button key={optV(o)} type="button" role={f.multi ? "checkbox" : "radio"} aria-checked={on} className={on ? "on" : ""}
              onClick={() => set(f.k, f.multi ? (on ? arr(v).filter((x) => x !== optV(o)) : [...arr(v), optV(o)]) : optV(o))}>
              {f.multi || f.style !== "cards" ? <span className="fx-tick">{on ? <Check size={13} /> : null}</span> : null}
              <span className="col tight" style={{ textAlign: "left" }}><span>{optL(o)}</span>{typeof o !== "string" && o.hint ? <span className="tiny faint">{o.hint}</span> : null}</span>
            </button>;
          })}
        </div>
      ); break;
    case "combo": el = <><input id={id} className={cls} list={`${id}-l`} value={s} placeholder={f.ph} onChange={(e) => set(f.k, e.target.value)} /><datalist id={`${id}-l`}>{f.opts.map((o) => <option key={o} value={o} />)}</datalist></>; break;
    case "staff": el = !ctx.staff.length ? <input id={id} className={cls} value={s} onChange={(e) => set(f.k, e.target.value)} placeholder="Name" /> : <select id={id} className={`select${err ? " bad" : ""}`} value={s} onChange={(e) => set(f.k, e.target.value)}><option value="">Pick a person</option>{ctx.staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>; break;
    case "customer": el = <CustomerPick value={s} customers={ctx.customers} onPick={(c) => { set(f.k, c?.id ?? ""); ctx.fill(c); }} />; break;
    case "signature": el = <SignaturePad value={s} onChange={(x) => set(f.k, x)} label={f.label} />; break;
    case "file": el = <Uploads value={files(v)} onChange={(x) => set(f.k, x)} token={ctx.token} multi={f.multi} accept={f.accept} />; break;
    case "secret": el = <Secret f={f} v={s} set={(x) => set(f.k, x)} err={err} />; break;
    case "calc": { const c = f.calc(d); el = <div className={`fx-calc${c ? "" : " empty"}`}>{c ?? "Fills in as you type"}</div>; break; }
    default: {
      const type = f.t === "email" ? "email" : f.t === "date" ? "date" : f.t === "time" ? "time" : f.t === "url" ? "url" : "text";
      const mode = f.t === "tel" ? "tel" : f.t === "zip" ? "numeric" : f.t === "email" ? "email" : undefined;
      const fmt = (x: string) => (f.t === "tel" ? fmtTel(x) : f.t === "state" ? x.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() : f.t === "ein" ? fmtEin(x) : f.t === "zip" ? x.replace(/[^\d-]/g, "").slice(0, 10) : x);
      const auto = f.t === "email" ? "email" : f.t === "tel" ? "tel" : f.t === "zip" ? "postal-code" : f.t === "state" ? "address-level1" : undefined;
      el = <input id={id} className={cls} type={type} inputMode={mode} autoComplete={auto} value={s} placeholder={"ph" in f ? f.ph : undefined} onChange={(e) => set(f.k, fmt(e.target.value))} />;
    }
  }
  return (
    <div className={`fx-field w${f.w ?? (f.t === "choice" || f.t === "signature" || f.t === "file" || f.t === "calc" || f.t === "textarea" ? 6 : 3)}`}>
      {label}
      {el}
      {err ? <span className="fx-err"><CircleAlert size={13} /> {err}</span> : f.hint ? <span className="fx-hint">{f.hint}</span> : null}
    </div>
  );
}

/**
 * Fills in any form: one short step at a time, with a progress bar, checks as you go, a review page and a score
 * (Daily Pulse). The same component runs for staff in the app and for customers on an emailed link.
 */
export function FormRunner({ formKey, initial = {}, id, token, staff, people = [], customers = [], prf, company, forDay, after, intro }: {
  formKey: string; initial?: Data; id?: number; token?: string; staff: boolean; people?: Person[]; customers?: Cust[]; prf?: number | null; company?: string | null;
  forDay?: string; after?: { label: string; href: string; note?: string }[]; intro?: React.ReactNode;
}) {
  const spec = SPECS[formKey];
  const [d, setD] = useState<Data>(initial);
  const [at, setAt] = useState(0);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ id: number; ref: string | null } | null>(null);
  const [pending, go] = useTransition();
  const top = useRef<HTMLDivElement>(null);
  const steps = useMemo(() => visibleSteps(spec, d, staff), [spec, d, staff]);
  const review = at >= steps.length;
  const step = steps[Math.min(at, steps.length - 1)];
  const score = spec.score?.(d);
  const set = (k: string, v: Val) => { setD((x) => ({ ...x, [k]: v })); if (errs[k]) setErrs((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const fill = (c: Cust | null) => {
    if (!c) return;
    setD((x) => ({ ...x, company_name: x.company_name || c.name, contact: x.contact || c.contact_name || "", contractor: x.contractor || c.name, phone: x.phone || (c.phone ? fmtTel(c.phone) : ""),
      email: x.email || c.email || "", cust_city: x.cust_city || c.city || "", cust_state: x.cust_state || c.state || "" }));
  };
  const scrollTop = () => setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);

  function next() {
    const e = check(spec, d, { staff, step: step.key, secretsKept: Object.entries(d).filter(([, v]) => str(v).startsWith("••••")).map(([k]) => k) });
    setErrs(e);
    if (Object.keys(e).length) { setMsg("Fill in the boxes marked in red."); return; }
    setMsg("");
    if (token) go(async () => { await saveForm({ key: formKey, data: d, token, draft: true }); });
    setAt(at + 1); scrollTop();
  }
  function submit() {
    go(async () => {
      const r = await saveForm({ key: formKey, data: d, id, token, prf, company, forDay });
      if (!r.ok) {
        setMsg(r.error);
        if (r.fields) { setErrs(r.fields); const first = steps.findIndex((s) => s.fields.some((f) => r.fields![f.k])); if (first >= 0) { setAt(first); scrollTop(); } }
        return;
      }
      setDone({ id: r.id, ref: r.ref }); scrollTop();
    });
  }

  if (done) return (
    <div className="fx-done card" ref={top}>
      <span className="fx-done-icon"><CircleCheck size={34} /></span>
      <h2 className="h2" style={{ margin: 0 }}>{token ? "Thank you! It's on its way to AMBIT." : spec.group === "pulse" ? "Pulse sent. Nice work today." : `${spec.title} sent`}</h2>
      {done.ref ? <span className="pill info lg">{done.ref}</span> : null}
      {score ? <div className="fx-score big"><b>{score.pct}%</b><span className="small muted">{score.total} of {score.max} points</span></div> : null}
      <p className="small muted center" style={{ margin: 0, maxWidth: 440 }}>{token ? "Your AMBIT rep will be in touch. You can close this page." : spec.decide ? "You'll get a notification when it's decided." : "The team can see it now."}</p>
      {!token ? (
        <div className="row wrap center" style={{ gap: 8 }}>
          {(after ?? []).map((a) => <Link key={a.href} href={a.href} className="btn">{a.label}</Link>)}
          <Link href={`/forms/s/${done.id}`} className="btn dark">Open it</Link>
          <Link href="/forms" className="btn dark">All forms</Link>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="fx" ref={top}>
      {intro}
      <ol className="fx-steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.key} className={i < at ? "done" : i === at ? "now" : ""}>
            <button type="button" disabled={i > at} onClick={() => { setAt(i); setMsg(""); }}><span className="fx-dot">{i < at ? <Check size={12} /> : i + 1}</span><span className="fx-step-name">{s.title}</span></button>
          </li>
        ))}
        <li className={review ? "now" : ""}><button type="button" disabled={!review}><span className="fx-dot">{steps.length + 1}</span><span className="fx-step-name">Review</span></button></li>
      </ol>
      <div className="fx-bar" aria-hidden="true"><span style={{ width: `${Math.round((Math.min(at, steps.length) / steps.length) * 100)}%` }} /></div>

      <section className="fx-card card">
        {review ? (
          <>
            <header className="fx-card-head"><h2 className="h2">Check it over</h2><span className="small muted">Tap a section to change it.</span></header>
            {score ? (
              <div className="fx-score">
                <div className="row between"><b>Today&apos;s score</b><b className={score.pct >= 85 ? "ok-text" : score.pct >= 60 ? "warn-text" : "red"}>{score.pct}%</b></div>
                <div className="use-bar" style={{ height: 8 }}><span style={{ width: `${score.pct}%`, background: score.pct >= 85 ? "var(--ok)" : score.pct >= 60 ? "var(--warn)" : "var(--red)" }} /></div>
                <div className="fx-score-parts">{score.parts.map((p) => <span key={p.label} className="tiny"><b>{p.pts}</b>/{p.max} {p.label}</span>)}</div>
                {score.flags.length ? <div className="row wrap" style={{ gap: 6 }}>{score.flags.map((f) => <span key={f} className="pill red">{f}</span>)}</div> : null}
              </div>
            ) : null}
            {steps.map((s, i) => (
              <div key={s.key} className="fx-review">
                <button type="button" className="fx-review-head" onClick={() => { setAt(i); scrollTop(); }}><b>{s.title}</b><Pencil size={14} /></button>
                <dl>
                  {s.fields.filter((f) => f.t !== "note" && f.t !== "head" && isShown(f, d)).map((f) => {
                    const a = answer(f, d);
                    return a ? <div key={f.k}><dt>{f.label || "Agreed"}</dt><dd>{f.t === "signature" ? <img src={str(d[f.k])} alt="Signature" className="fx-sig-img" /> : a}</dd></div> : null;
                  })}
                </dl>
              </div>
            ))}
          </>
        ) : (
          <>
            <header className="fx-card-head"><span className="tiny faint">Step {at + 1} of {steps.length}</span><h2 className="h2">{step.title}</h2>{step.sub ? <span className="small muted">{step.sub}</span> : null}{step.staffOnly ? <span className="pill warn"><Lock size={11} /> AMBIT only</span> : null}</header>
            <div className="fx-grid">
              {step.fields.filter((f) => isShown(f, d)).map((f) => <Input key={f.k} f={f} d={d} set={set} err={errs[f.k]} ctx={{ staff: people, customers, token, fill }} />)}
            </div>
          </>
        )}
      </section>

      {msg ? <div className="alert err" role="alert"><CircleAlert size={18} /><span>{msg}</span></div> : null}
      <div className="fx-nav">
        {at > 0 ? <button type="button" className="btn dark" onClick={() => { setAt(at - 1); setMsg(""); scrollTop(); }}><ArrowLeft size={16} /> Back</button> : <span />}
        {review
          ? <button type="button" className="btn fx-go" disabled={pending} onClick={submit}>{pending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} {token ? "Send to AMBIT" : spec.group === "pulse" ? "Send my pulse" : "Submit"}</button>
          : <button type="button" className="btn fx-go" onClick={next}>{at === steps.length - 1 ? "Review" : "Next"} <ArrowRight size={16} /></button>}
      </div>
    </div>
  );
}
