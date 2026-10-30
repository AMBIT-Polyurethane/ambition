"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleCheck, Clock, Eraser, FileDown, FileText, Mail, Phone } from "lucide-react";
import { groupByArea, isExpired, type Proposal } from "@/lib/ops/proposal";
import { declineProposal, signProposal } from "./actions";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");
const addr = (p: Proposal["property"]) => (p ? [p.street, [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "");

export function ProposalView({ p, token, logo, docs }: { p: Proposal; token: string; logo: string | null; docs: { title: string; doc_type: string; url: string }[] }) {
  const q = p.quote;
  const signed = q.status === "signed";
  const declined = q.status === "declined";
  const expired = isExpired(p);
  const canSign = !signed && !declined && !expired && ["sent", "viewed"].includes(q.status);
  const [opt, setOpt] = useState(q.signed_option_id ?? p.options[0]?.id ?? "");
  const [addons, setAddons] = useState<string[]>(q.signed_addons ?? []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(p.customer?.email ?? "");
  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const totals = q.totals ?? {};
  const optTot = totals.options?.[opt];
  const addTot = addons.reduce((a, id) => a + (totals.addons?.[id]?.total ?? 0), 0);
  const addTax = addons.reduce((a, id) => a + (totals.addons?.[id]?.tax ?? 0), 0);
  const total = (optTot?.total ?? 0) + addTot;
  const tax = (optTot?.tax ?? 0) + addTax;
  const deposit = q.deposit_pct ? Math.round(total * q.deposit_pct) / 100 : 0;
  const addonLines = p.lines.filter((l) => l.option_id === null);
  const showPrices = p.company.show_line_prices;
  const many = p.options.length > 1;

  const sign = async () => {
    setError(null);
    if (!opt) return setError("Pick one of the options.");
    if (name.trim().length < 2) return setError("Type your full name.");
    if (!sig) return setError("Draw your signature in the box.");
    if (!agree) return setError("Tick the box to agree to the proposal and its terms.");
    setBusy(true);
    const r = await signProposal(token, { option: opt, addons, name, email, signature: sig });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(true);
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <header className="prop-head">
        {logo ? <img src={logo} alt={p.company.name} className="lead-logo" /> : <b className="lead-name">{p.company.name}</b>}
        <span className="col tight prop-contact">
          {p.company.phone ? <a href={`tel:${p.company.phone}`}><Phone size={13} /> {p.company.phone}</a> : null}
          {p.company.email ? <a href={`mailto:${p.company.email}`}><Mail size={13} /> {p.company.email}</a> : null}
        </span>
      </header>

      <section className="col tight">
        <span className="eyebrow">Proposal #{q.number}{q.sent_at ? ` · ${day(q.sent_at)}` : ""}</span>
        <h1 className="h1" style={{ margin: "4px 0" }}>{q.title || "Your insulation proposal"}</h1>
        <span className="muted">For {p.customer?.name ?? "you"}{addr(p.property) ? ` · ${addr(p.property)}` : ""}</span>
        {q.valid_until && canSign ? <span className="tiny faint"><Clock size={12} style={{ verticalAlign: -2 }} /> Good until {day(q.valid_until)}</span> : null}
      </section>

      {signed || done ? (
        <div className="alert ok">
          <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>{done ? "Thank you! Your proposal is signed." : q.signature ? `Signed by ${q.signed_name} on ${day(q.signed_at)}.` : `Accepted on ${day(q.signed_at)}.`} {p.company.name} will reach out to schedule the work.{done ? " Reload the page any time to see it." : ""}</span>
        </div>
      ) : declined ? (
        <div className="alert warn"><span>You declined this proposal. If that changed, contact {p.company.name}{p.company.phone ? ` at ${p.company.phone}` : ""}.</span></div>
      ) : expired ? (
        <div className="alert warn"><span>This proposal ran out on {day(q.valid_until)}. Contact {p.company.name}{p.company.phone ? ` at ${p.company.phone}` : ""} for an updated one.</span></div>
      ) : null}

      {q.intro ? <p className="prop-intro">{q.intro}</p> : null}

      {many && canSign && !done ? <div className="eyebrow">Pick one option</div> : null}
      <div className="col" style={{ gap: 12 }}>
        {p.options.map((o) => {
          const mine = p.lines.filter((l) => l.option_id === o.id);
          const t = totals.options?.[o.id];
          const on = o.id === opt;
          const chosen = signed && q.signed_option_id === o.id;
          if (signed && !chosen) return null;
          return (
            <section key={o.id} className={`prop-opt${on && many ? " on" : ""}`} onClick={() => canSign && !done && setOpt(o.id)}>
              <div className="prop-opt-head">
                {many && canSign && !done ? <span className={`prop-radio${on ? " on" : ""}`} aria-hidden="true">{on ? <Check size={14} strokeWidth={3} /> : null}</span> : null}
                <span className="col tight grow">
                  <b className="prop-opt-name">{many || signed ? o.name : "The work"}</b>
                  {o.note ? <span className="small muted">{o.note}</span> : null}
                </span>
                <b className="prop-opt-total">{money(t?.price)}</b>
              </div>
              {groupByArea(mine, p.company.work_areas).map((g) => (
                <div key={g.code ?? "x"} className="prop-area">
                  <div className="prop-area-head"><span>{g.name}</span>{showPrices ? <span>{money(g.total)}</span> : null}</div>
                  {g.lines.map((l) => (
                    <div key={l.id} className="prop-line">
                      <span className="col tight grow">
                        <span>{l.name}</span>
                        {l.detail ? <span className="tiny faint">{l.detail}</span> : null}
                      </span>
                      {showPrices || l.kind === "credit" ? <span className="prop-price">{money(l.price)}</span> : null}
                    </div>
                  ))}
                </div>
              ))}
              {t?.min_adj ? <div className="prop-line tiny faint"><span className="grow">Minimum job charge</span><span>{money(t.min_adj)}</span></div> : null}
            </section>
          );
        })}
      </div>

      {addonLines.length && (!signed || (q.signed_addons ?? []).length) ? (
        <section className="col" style={{ gap: 8 }}>
          <div className="eyebrow">{signed ? "Add-ons you picked" : "Add-ons (optional)"}</div>
          {addonLines
            .filter((l) => !signed || (q.signed_addons ?? []).includes(l.id))
            .map((l) => {
              const on = addons.includes(l.id);
              return (
                <label key={l.id} className={`prop-addon${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} disabled={!canSign || done} onChange={() => setAddons((a) => (on ? a.filter((x) => x !== l.id) : [...a, l.id]))} />
                  <span className="col tight grow">
                    <span>{l.name}</span>
                    {l.detail ? <span className="tiny faint">{l.detail}</span> : null}
                  </span>
                  <b>{money(totals.addons?.[l.id]?.price ?? l.price)}</b>
                </label>
              );
            })}
        </section>
      ) : null}

      <section className="prop-total">
        {tax ? <div className="row between small"><span>Tax</span><span>{money(tax)}</span></div> : null}
        {q.tax_exempt ? <div className="row between small"><span>Tax</span><span>Exempt</span></div> : null}
        <div className="row between"><b>Total</b><b className="prop-big">{money(signed ? q.signed_total : total)}</b></div>
        {deposit && !signed ? <div className="row between small muted"><span>Deposit to schedule ({q.deposit_pct}%)</span><span>{money(deposit)}</span></div> : null}
      </section>

      {q.terms ? (
        <section className="col tight">
          <div className="eyebrow">Terms</div>
          <p className="small muted" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{q.terms}</p>
        </section>
      ) : null}

      {docs.length ? (
        <section className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Product information</div>
          <div className="prop-docs">
            {docs.map((d) => (
              <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer"><FileText size={15} /> {d.title}</a>
            ))}
          </div>
        </section>
      ) : null}

      {signed && q.signature ? (
        <section className="prop-signed">
          <img src={q.signature} alt={`Signature of ${q.signed_name}`} />
          <span className="small">{q.signed_name} · {day(q.signed_at)}</span>
        </section>
      ) : null}

      {canSign && !done ? (
        <section className="card col prop-sign" style={{ gap: 12 }}>
          <b style={{ fontSize: 17 }}>Accept and sign</b>
          <label className="field">
            <span className="label">Your full name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
          </label>
          <label className="field">
            <span className="label">Email (for your copy)</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={160} />
          </label>
          <SignaturePad onChange={setSig} />
          <label className="check small">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I accept {many ? `"${p.options.find((o) => o.id === opt)?.name ?? "this option"}"` : "this proposal"}{addons.length ? ` and ${addons.length} add-on${addons.length === 1 ? "" : "s"}` : ""} for {money(total)} and the terms above.
          </label>
          {error ? <div className="alert err small" role="alert"><span>{error}</span></div> : null}
          <button type="button" className="btn block lead-submit" disabled={busy} onClick={() => void sign()}>{busy ? "Signing…" : `Sign for ${money(total)}`}</button>
          {!declining ? (
            <button type="button" className="linkbtn small" onClick={() => setDeclining(true)}>Not right for you? Let them know</button>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <label className="field">
                <span className="label">What would make it work? (optional)</span>
                <textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn sm dark"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await declineProposal(token, reason);
                  setBusy(false);
                  if (!r.ok) setError(r.error);
                  else window.location.reload();
                }}
              >
                Decline this proposal
              </button>
            </div>
          )}
        </section>
      ) : null}

      <a className="btn sm dark" href={`/p/${token}/pdf`} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start" }}><FileDown size={15} /> Download PDF</a>
      <p className="tiny faint center" style={{ margin: "4px 0 0" }}>
        {[p.company.name, p.company.address, p.company.license_no ? `License ${p.company.license_no}` : null, p.company.website].filter(Boolean).join(" · ")} · Powered by AMBIT-OPS
      </p>
    </div>
  );
}

/** Sign with a finger or the mouse. Gives back a PNG (data URL), or null when empty. */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const [has, setHas] = useState(false);
  const dpr = useMemo(() => (typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1)), []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = () => {
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const g = c.getContext("2d")!;
      g.scale(dpr, dpr);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 2.4;
      g.strokeStyle = "#111";
      inked.current = false;
      setHas(false);
      onChange(null);
    };
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const finish = () => {
    drawing.current = false;
    last.current = null;
    if (inked.current) onChange(ref.current!.toDataURL("image/png"));
  };
  return (
    <div className="field">
      <span className="label">Sign here</span>
      <div className="sig-pad">
        <canvas
          ref={ref}
          aria-label="Signature box: draw your signature"
          onPointerDown={(e) => {
            e.preventDefault();
            ref.current!.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = at(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const g = ref.current!.getContext("2d")!;
            const p = at(e);
            g.beginPath();
            g.moveTo(last.current[0], last.current[1]);
            g.lineTo(p[0], p[1]);
            g.stroke();
            last.current = p;
            if (!inked.current) {
              inked.current = true;
              setHas(true);
            }
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        {!has ? <span className="sig-hint">Draw your signature</span> : null}
        {has ? (
          <button
            type="button"
            className="sig-clear"
            onClick={() => {
              const c = ref.current!;
              c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
              inked.current = false;
              setHas(false);
              onChange(null);
            }}
          >
            <Eraser size={14} /> Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
