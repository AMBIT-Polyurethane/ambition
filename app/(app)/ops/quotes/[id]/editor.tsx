"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleCheck,
  Copy,
  ExternalLink,
  FileDown,
  FileSignature,
  Layers,
  LoaderCircle,
  MessageSquare,
  Package,
  Plus,
  Ruler,
  Send,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import {
  KIND_LABEL,
  isFoamKind,
  lineMath,
  measureFor,
  money,
  newLine,
  pct,
  priceLines,
  quoteTotals,
  type QLine,
  type QOption,
  type QProduct,
  type QuoteParams,
} from "@/lib/ops/quote-calc";
import { atticRs, chartFor, wallFramings } from "@/lib/ops/coverage";
import type { LaborRate, WorkArea } from "@/lib/ops/defaults";
import { addressLine } from "@/lib/ops/crm";
import { dateShort, dateTime } from "@/lib/format";
import { Submit } from "@/components/forms";
import { approveQuote, copyQuote, deletePackage, deleteQuote, saveQuote, savePackage, sendQuote, takeoffLines, type QuoteFields, type QuoteRow } from "../actions";

type Customer = { id: string; name: string; phone: string | null; email: string | null; kind: string; price_level: string; tax_exempt: boolean; properties: { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null }[] };
type Settings = { labor: LaborRate[]; builder_margin: number | null; work_areas: WorkArea[]; min_job: number | null; quote_days: number; target_margin: number | null; floor_margin: number | null };
type Pkg = { id: string; name: string; lines: Partial<QLine>[] };
type Can = { edit: boolean; approve: boolean; remove: boolean; order: boolean };

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: "Spray foam", kinds: ["foam_oc", "foam_cc", "foam_roof", "foam_other"] },
  { title: "Blown fiberglass", kinds: ["blown"] },
  { title: "Batts", kinds: ["batt"] },
  { title: "Coatings", kinds: ["coating", "intumescent"] },
  { title: "Supplies", kinds: ["supply", "bibs_mesh", "other"] },
];
// Work with no product: labor only, or a credit.
const PLAIN: { kind: string; label: string; hint: string }[] = [
  { kind: "removal", label: "Insulation removal", hint: "Labor by the sq ft" },
  { kind: "air_seal", label: "Air sealing", hint: "Labor by the hour" },
  { kind: "labor", label: "Prep or other labor", hint: "By the hour" },
  { kind: "other", label: "Something else", hint: "Type a price" },
  { kind: "credit", label: "Credit or rebate", hint: "Takes money off" },
];

const FRIENDLY: Record<string, string> = {
  foam_oc: "Open cell spray foam",
  foam_cc: "Closed cell spray foam",
  foam_roof: "Spray foam roofing",
  foam_other: "Spray foam insulation",
  blown: "Blown-in fiberglass insulation",
  batt: "Fiberglass batt insulation",
  coating: "Roof coating",
  intumescent: "Intumescent (thermal barrier) coating",
  removal: "Remove existing insulation",
  air_seal: "Air sealing",
  labor: "Prep and labor",
  credit: "Credit",
  other: "Other",
};

const num = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }));

/** A number box that keeps what you type and reports a number (or blank). */
function NumBox({ value, onChange, placeholder, step, label, suffix, disabled, width }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; step?: string; label: string; suffix?: string; disabled?: boolean; width?: number }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null || value === undefined ? "" : String(value));
    }
  }, [value]);
  return (
    <label className="field q-num" style={width ? { maxWidth: width } : undefined}>
      <span className="label">{label}</span>
      <span className="q-num-in">
        <input
          className="input sm"
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const t = e.target.value.replace(/[$,\s]/g, "");
            setText(e.target.value);
            const v = t === "" ? null : Number(t);
            if (t === "" || Number.isFinite(v)) {
              last.current = v;
              onChange(v);
            }
          }}
        />
        {suffix ? <i>{suffix}</i> : null}
      </span>
    </label>
  );
}

export function QuoteEditor(props: {
  quote: QuoteRow;
  options: QOption[];
  lines: QLine[];
  products: QProduct[];
  customer: Customer | null;
  lead: { id: string; number: number; title: string | null; stage: string } | null;
  settings: Settings;
  reps: { id: string; name: string }[];
  packages: Pkg[];
  takeoffs: { id: string; name: string; customer: string | null; updated_at: string }[];
  link: string | null;
  can: Can;
  emailReady: boolean;
  me: string;
}) {
  const q = props.quote;
  const st = props.settings;
  const readOnly = !props.can.edit;
  const [fields, setFields] = useState<QuoteFields>({
    title: q.title,
    property_id: q.property_id,
    price_level: q.price_level,
    target_margin: q.target_margin,
    floor_margin: q.floor_margin,
    burden_pct: q.burden_pct,
    tax_rate: q.tax_rate,
    tax_labor: q.tax_labor,
    tax_exempt: q.tax_exempt,
    deposit_pct: q.deposit_pct,
    intro: q.intro,
    terms: q.terms,
    rep_id: q.rep_id,
  });
  const [options, setOptions] = useState<QOption[]>(props.options.length ? props.options : [{ id: crypto.randomUUID(), name: "Option 1", note: null, sort: 0 }]);
  const [lines, setLines] = useState<QLine[]>(props.lines);
  const [optId, setOptId] = useState(options[0].id);
  const [open, setOpen] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; at?: string; error?: string }>({ state: "idle" });
  const [needsOk, setNeedsOk] = useState(q.needs_approval && !q.approved_at);
  const [picker, setPicker] = useState<{ addon: boolean } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [packages, setPackages] = useState(props.packages);
  const [status, setStatus] = useState(q.status);
  const [link, setLink] = useState(props.link);
  const [lastArea, setLastArea] = useState<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, start] = useTransition();

  const products = useMemo(() => new Map(props.products.map((p) => [p.id, p])), [props.products]);
  const params: QuoteParams = useMemo(
    () => ({ price_level: fields.price_level, target_margin: fields.target_margin, floor_margin: fields.floor_margin, burden_pct: fields.burden_pct, tax_rate: fields.tax_rate, tax_labor: fields.tax_labor, tax_exempt: fields.tax_exempt, deposit_pct: fields.deposit_pct, min_job: st.min_job }),
    [fields, st.min_job],
  );
  const priced = useMemo(() => priceLines(lines, products, st, params), [lines, products, st, params]);
  const totals = useMemo(() => quoteTotals(options, priced, params), [options, priced, params]);
  const math = (l: QLine) => lineMath(l, l.product_id ? products.get(l.product_id) ?? null : null, st, params);
  const areaName = (code: string | null) => (code ? st.work_areas.find((a) => a.code === code)?.name ?? code : "No work area");

  // ---------------------------------------------------------------- saving (a moment after each change)
  const doSave = async () => {
    dirty.current = false;
    setSave({ state: "saving" });
    const r = await saveQuote(q.id, { fields, options, lines });
    if (!r.ok) {
      setSave({ state: "error", error: r.error });
      return;
    }
    setNeedsOk(!!r.needsApproval);
    setSave({ state: "saved", at: r.at });
  };
  useEffect(() => {
    if (readOnly || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void doSave(), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, options, lines]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || save.state === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  const touch = () => {
    dirty.current = true;
  };
  const setF = (patch: Partial<QuoteFields>) => {
    touch();
    setFields((f) => ({ ...f, ...patch }));
  };
  const setLine = (id: string, patch: Partial<QLine>) => {
    touch();
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const addLines = (add: QLine[]) => {
    touch();
    setLines((ls) => [...ls, ...add.map((l, i) => ({ ...l, sort: ls.length + i }))]);
  };
  const removeLine = (id: string) => {
    touch();
    setLines((ls) => ls.filter((l) => l.id !== id));
    if (open === id) setOpen(null);
  };

  // ---------------------------------------------------------------- options
  const addOption = () => {
    if (options.length >= 6) return;
    const id = crypto.randomUUID();
    const names = ["Good", "Better", "Best"];
    const name = options.length < 3 && options.every((o, i) => o.name === names[i] || /^Option \d$/.test(o.name)) ? `Option ${options.length + 1}` : `Option ${options.length + 1}`;
    touch();
    setOptions((o) => [...o, { id, name, note: null, sort: o.length }]);
    // Starts as a copy of the option on screen: change what's different.
    const copy = lines.filter((l) => l.option_id === optId).map((l) => ({ ...l, id: crypto.randomUUID(), option_id: id }));
    setLines((ls) => [...ls, ...copy]);
    setOptId(id);
  };
  const removeOption = (id: string) => {
    if (options.length <= 1) return;
    if (!window.confirm("Remove this option and its lines?")) return;
    touch();
    const rest = options.filter((o) => o.id !== id);
    setOptions(rest);
    setLines((ls) => ls.filter((l) => l.option_id !== id));
    setOptId(rest[0].id);
  };
  const goodBetterBest = () => {
    touch();
    setOptions((o) => o.map((x, i) => ({ ...x, name: ["Good", "Better", "Best"][i] ?? x.name })));
  };

  // ---------------------------------------------------------------- adding work
  const addFor = (kind: string, p: QProduct | null, addon: boolean) => {
    const area = lastArea ?? st.work_areas[0]?.code ?? null;
    const l = newLine({
      id: crypto.randomUUID(),
      option_id: addon ? null : optId,
      kind: p?.kind ?? kind,
      product_id: p?.id ?? null,
      name: p?.description || (p && ["supply", "other", "coating", "bibs_mesh"].includes(p.kind) ? p.name : FRIENDLY[p?.kind ?? kind] ?? p?.name ?? "Item"),
      measure: measureFor(p?.kind ?? kind),
      area_code: ["supply", "other", "credit", "labor"].includes(p?.kind ?? kind) ? null : area,
      depth_in: p && isFoamKind(p.kind) ? (p.kind === "foam_cc" ? 2 : p.kind === "foam_roof" ? 1 : 5.5) : null,
      r_value: p?.kind === "blown" ? 38 : null,
    });
    addLines([l]);
    setOpen(l.id);
    setPicker(null);
  };
  const addPackage = (pkg: Pkg) => {
    const add = pkg.lines.map((x) =>
      newLine({
        ...(x as Partial<QLine>),
        id: crypto.randomUUID(),
        option_id: optId,
        product_id: x.product_id && products.has(x.product_id) ? x.product_id : null,
        sqft: null,
        lf: null,
        height_ft: null,
        price: x.price_locked ? Number(x.price ?? 0) : 0,
      } as QLine & { id: string }),
    );
    addLines(add);
    setPkgOpen(false);
    if (add[0]) setOpen(add[0].id);
  };
  const pullTakeoff = (id: string) =>
    start(async () => {
      const r = await takeoffLines(id);
      if (!r.ok || !r.lines) return alert(r.error ?? "Couldn't read the takeoff.");
      addLines(r.lines.map((l) => ({ ...l, option_id: optId })));
      setToOpen(false);
      if (r.skipped?.length) alert(`${r.skipped.length} item(s) have no size yet and were left out: ${r.skipped.join(", ")}`);
    });

  // ---------------------------------------------------------------- what's on screen
  const optLines = priced.filter((l) => l.option_id === optId);
  const addons = priced.filter((l) => l.option_id === null);
  const byArea = (list: QLine[]) => {
    const order = [...st.work_areas.map((a) => a.code), null];
    const groups = new Map<string | null, QLine[]>();
    for (const l of list) {
      const k = l.area_code && st.work_areas.some((a) => a.code === l.area_code) ? l.area_code : l.area_code ?? null;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(l);
    }
    return [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 98 : ia) - (ib < 0 ? 98 : ib);
    });
  };
  const opt = options.find((o) => o.id === optId) ?? options[0];
  const ot = totals.options[opt.id];
  const target = fields.price_level === "builder" && st.builder_margin !== null ? st.builder_margin : fields.target_margin;
  const marginCls = (m: number | null) => (m === null ? "" : fields.floor_margin !== null && m < fields.floor_margin - 0.001 ? "bad" : target !== null && m < target - 0.5 ? "mid" : "good");
  const warnings = [...new Set(priced.map((l) => math(l).warn).filter(Boolean) as string[])];
  const signed = status === "signed";

  const renderLine = (l: QLine) => {
    const m = math(l);
    const p = l.product_id ? products.get(l.product_id) ?? null : null;
    const isOpen = open === l.id && !readOnly;
    const kind = p?.kind ?? l.kind;
    return (
      <div key={l.id} className={`q-line${isOpen ? " open" : ""}`}>
        <button type="button" className="q-line-main" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}>
          <span className="col tight grow" style={{ minWidth: 0 }}>
            <b className="ellipsis">{l.name}</b>
            <span className="tiny faint ellipsis">{m.detail || KIND_LABEL[kind] || ""}</span>
          </span>
          {m.warn ? <AlertTriangle size={15} className="warn-text" aria-label={m.warn} /> : null}
          <span className="col tight" style={{ alignItems: "flex-end", flex: "none" }}>
            <b>{money(m.price)}</b>
            {m.margin !== null && kind !== "credit" ? <span className={`tiny q-m ${marginCls(m.margin)}`}>{pct(m.margin)}</span> : null}
          </span>
          {!readOnly ? <ChevronDown size={16} className="q-chev" /> : null}
        </button>
        {isOpen ? (
          <div className="q-line-edit">
            <div className="q-row">
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span className="label">Name on the proposal</span>
                <input className="input sm" value={l.name} maxLength={160} onChange={(e) => setLine(l.id, { name: e.target.value })} />
              </label>
              {kind !== "credit" && kind !== "supply" && kind !== "other" ? (
                <label className="field" style={{ flex: "0 1 200px" }}>
                  <span className="label">Work area</span>
                  <select
                    className="select sm"
                    value={l.area_code ?? ""}
                    onChange={(e) => {
                      setLine(l.id, { area_code: e.target.value || null });
                      setLastArea(e.target.value || null);
                    }}
                  >
                    <option value="">None</option>
                    {st.work_areas.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                  </select>
                </label>
              ) : null}
            </div>

            {p || GROUPS.some((g) => g.kinds.includes(kind)) ? (
              <label className="field">
                <span className="label">Product</span>
                <select
                  className="select sm"
                  value={l.product_id ?? ""}
                  onChange={(e) => {
                    const np = products.get(e.target.value) ?? null;
                    setLine(l.id, { product_id: np?.id ?? null, kind: np?.kind ?? l.kind });
                  }}
                >
                  {props.products
                    .filter((x) => (x.active || x.id === l.product_id) && (GROUPS.find((g) => g.kinds.includes(kind))?.kinds ?? [kind]).includes(x.kind))
                    .map((x) => <option key={x.id} value={x.id}>{x.name}{x.cost === null ? " (no cost yet)" : ` · ${money(x.cost)}/${x.unit}`}</option>)}
                </select>
              </label>
            ) : null}

            {l.measure === "sqft" || l.measure === "lf" ? (
              <div className="q-row">
                <div className="field" style={{ flex: "0 0 auto" }}>
                  <span className="label">Measure</span>
                  <div className="seg sm" role="radiogroup" aria-label="Measure">
                    <button type="button" role="radio" aria-checked={l.measure === "sqft"} className={l.measure === "sqft" ? "on" : ""} onClick={() => setLine(l.id, { measure: "sqft" })}>Sq ft</button>
                    <button type="button" role="radio" aria-checked={l.measure === "lf"} className={l.measure === "lf" ? "on" : ""} onClick={() => setLine(l.id, { measure: "lf" })}>Length × height</button>
                  </div>
                </div>
                {l.measure === "sqft" ? (
                  <NumBox label="Sq ft" value={l.sqft} onChange={(v) => setLine(l.id, { sqft: v })} placeholder="0" width={130} />
                ) : (
                  <>
                    <NumBox label="Length" value={l.lf} onChange={(v) => setLine(l.id, { lf: v })} suffix="ft" width={120} />
                    <NumBox label="Height" value={l.height_ft} onChange={(v) => setLine(l.id, { height_ft: v })} suffix="ft" width={110} />
                  </>
                )}
                {isFoamKind(kind) ? <NumBox label="Depth" value={l.depth_in} onChange={(v) => setLine(l.id, { depth_in: v })} suffix="in" width={100} /> : null}
                {isFoamKind(kind) ? <NumBox label="R-value (optional)" value={l.r_value} onChange={(v) => setLine(l.id, { r_value: v })} width={130} /> : null}
              </div>
            ) : null}

            {kind === "blown" ? (
              <BlownFields l={l} chart={chartFor(p?.coverage_key ?? null)} set={(patch) => setLine(l.id, patch)} />
            ) : null}

            {l.measure === "each" ? <NumBox label={kind === "credit" ? "Amount" : "How many"} value={kind === "credit" ? l.price || null : l.qty} onChange={(v) => setLine(l.id, kind === "credit" ? { price: Math.abs(v ?? 0), price_locked: true } : { qty: v })} suffix={kind === "credit" ? "$" : p?.unit ?? "each"} width={160} /> : null}
            {l.measure === "hours" ? <NumBox label="Hours" value={l.hours} onChange={(v) => setLine(l.id, { hours: v })} suffix="hr" width={130} /> : null}

            <div className="q-row">
              {kind !== "credit" && l.measure !== "hours" && kind !== "removal" ? (
                <NumBox label="Waste %" value={l.waste_pct} onChange={(v) => setLine(l.id, { waste_pct: v })} placeholder={`${p?.waste_pct ?? 0} (product)`} width={140} />
              ) : null}
              {kind !== "credit" ? (
                <>
                  <label className="check small" style={{ alignSelf: "flex-end", paddingBottom: 10 }}>
                    <input type="checkbox" checked={l.price_locked} onChange={(e) => setLine(l.id, { price_locked: e.target.checked, price: m.price })} /> Set my own price
                  </label>
                  {l.price_locked ? <NumBox label="Price" value={l.price} onChange={(v) => setLine(l.id, { price: v ?? 0 })} suffix="$" width={150} /> : null}
                </>
              ) : null}
            </div>

            <div className="q-math">
              {m.bf ? <span><b>{num(m.bf)}</b> bd ft</span> : null}
              {m.units !== null && m.unit ? <span><b>{num(m.units, 2)}</b> {m.unit}{m.units === 1 ? "" : "s"}</span> : null}
              <span>Materials <b>{money(m.cost_material)}</b></span>
              <span>Labor <b>{money(m.cost_labor)}</b>{m.labor_parts.length > 1 ? <i className="faint"> ({m.labor_parts.map((x) => `${x.name} ${money(x.amount)}`).join(" + ")})</i> : null}</span>
              <span>Price <b>{money(m.price)}</b></span>
              {m.per_bf ? <span>{money(m.per_bf)}/bd ft</span> : null}
              {m.per_sqft ? <span>{money(m.per_sqft)}/sq ft</span> : null}
              {m.margin !== null && kind !== "credit" ? <span className={`q-m ${marginCls(m.margin)}`}>Margin <b>{pct(m.margin)}</b></span> : null}
            </div>
            {m.warn ? <div className="alert warn small"><AlertTriangle size={15} style={{ flex: "none", marginTop: 1 }} /><span>{m.warn}</span></div> : null}

            <div className="row wrap" style={{ gap: 8 }}>
              <button type="button" className="btn sm dark" onClick={() => setOpen(null)}><Check size={15} /> Done</button>
              <button type="button" className="btn sm ghost" onClick={() => { const c = { ...l, id: crypto.randomUUID() }; addLines([c]); setOpen(c.id); }}><Copy size={14} /> Duplicate</button>
              <select
                className="select sm"
                style={{ maxWidth: 200 }}
                value=""
                aria-label="Move to"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setLine(l.id, { option_id: v === "addon" ? null : v });
                }}
              >
                <option value="">Move to…</option>
                {options.filter((o) => o.id !== l.option_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                {l.option_id !== null ? <option value="addon">Add-ons (customer picks)</option> : null}
              </select>
              <span className="grow" />
              <button type="button" className="btn sm ghost danger-text" onClick={() => removeLine(l.id)}><Trash2 size={14} /> Remove</button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const section = (list: QLine[]) =>
    byArea(list).map(([code, ls]) => (
      <div key={code ?? "none"} className="q-area">
        <div className="q-area-head">
          {code ? <span className="q-code">{code}</span> : null}
          <b>{areaName(code)}</b>
          <span className="grow" />
          <span className="tiny faint">{money(ls.reduce((a, l) => a + l.price, 0))}</span>
        </div>
        {ls.map(renderLine)}
      </div>
    ));

  return (
    <div className="q-ed">
      {/* ------------------------------------------------ header */}
      <header className="q-head">
        <Link href={props.lead ? `/ops/leads/${props.lead.id}` : "/ops/quotes"} className="iconbtn" aria-label="Back"><ChevronLeft size={22} /></Link>
        <div className="col tight grow" style={{ minWidth: 0 }}>
          <span className="tiny faint">
            Quote #{q.number}
            {props.lead ? <> · <Link href={`/ops/leads/${props.lead.id}`}>lead #{props.lead.number}</Link></> : null}
          </span>
          <b className="q-cust ellipsis">{props.customer?.name ?? "Customer"}</b>
        </div>
        <span className={`pill ${signed ? "ok" : status === "draft" ? "grey" : status === "declined" ? "grey" : "warn"}`}>{signed ? "Signed" : status === "viewed" ? "Opened" : status === "sent" ? "Sent" : status === "declined" ? "Declined" : "Draft"}</span>
        {!readOnly ? (
          <span className="q-save tiny faint" aria-live="polite">
            {save.state === "saving" ? <><LoaderCircle size={13} className="spin" /> Saving…</> : save.state === "saved" ? <><Check size={13} /> Saved</> : save.state === "error" ? <span className="red">Not saved: {save.error}</span> : null}
          </span>
        ) : null}
      </header>

      {signed ? (
        <div className="alert ok">
          <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            Signed by <b>{q.signed_name}</b> on {q.signed_at ? dateTime(q.signed_at) : ""}: {options.find((o) => o.id === q.signed_option_id)?.name ?? "option"}
            {q.signed_addons.length ? ` + ${q.signed_addons.length} add-on${q.signed_addons.length === 1 ? "" : "s"}` : ""}, <b>{money(q.signed_total)}</b>. It can&apos;t be changed now; make a copy for changes.
          </span>
        </div>
      ) : null}
      {status === "declined" ? <div className="alert warn small"><span>The customer declined this quote{q.decline_reason ? `: "${q.decline_reason}"` : ""}. Make a copy to send a new one.</span></div> : null}
      {needsOk && !signed ? (
        <div className="alert warn">
          <ShieldAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span className="grow">
            An option is under your lowest margin ({pct(fields.floor_margin)}). {props.can.approve ? "As the owner or office you can still send it, or OK it for your team." : "The owner or office needs to OK it before it can be sent."}
          </span>
          {props.can.approve && !dirty.current ? (
            <form action={approveQuote}>
              <input type="hidden" name="id" value={q.id} />
              <Submit className="btn sm" pendingText="…">OK it</Submit>
            </form>
          ) : null}
        </div>
      ) : q.approved_by_name && !signed ? (
        <div className="tiny faint">Under the lowest margin, OK&apos;d by {q.approved_by_name}{q.approved_at ? ` on ${dateShort(q.approved_at)}` : ""}.</div>
      ) : null}

      <div className="q-grid">
        {/* ------------------------------------------------ the work */}
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <section className="card col" style={{ gap: 10 }}>
            <div className="q-row">
              <label className="field" style={{ flex: "1 1 240px" }}>
                <span className="label">Job name</span>
                <input className="input sm" value={fields.title ?? ""} disabled={readOnly} maxLength={140} placeholder="Attic and walls, 1,800 sq ft home" onChange={(e) => setF({ title: e.target.value })} />
              </label>
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span className="label">Job address</span>
                <select className="select sm" value={fields.property_id ?? ""} disabled={readOnly} onChange={(e) => setF({ property_id: e.target.value || null })}>
                  <option value="">None</option>
                  {(props.customer?.properties ?? []).map((p) => <option key={p.id} value={p.id}>{addressLine(p) || p.label || "Address"}</option>)}
                </select>
              </label>
            </div>
          </section>

          <div className="q-tabs" role="tablist" aria-label="Options">
            {options.map((o) => (
              <button key={o.id} type="button" role="tab" aria-selected={o.id === optId} className={`q-tab${o.id === optId ? " on" : ""}`} onClick={() => setOptId(o.id)}>
                <span className="ellipsis">{o.name}</span>
                <i>{money(totals.options[o.id]?.total ?? 0, false)}</i>
              </button>
            ))}
            {!readOnly && options.length < 6 ? (
              <button type="button" className="q-tab add" onClick={addOption} title="A second choice for the customer (starts as a copy)"><Plus size={15} /> Option</button>
            ) : null}
          </div>

          <section className="card col" style={{ gap: 12 }}>
            {!readOnly ? (
              <div className="q-row" style={{ alignItems: "flex-end" }}>
                <label className="field" style={{ flex: "1 1 180px" }}>
                  <span className="label">Option name</span>
                  <input className="input sm" value={opt.name} maxLength={60} onChange={(e) => { touch(); setOptions((os) => os.map((o) => (o.id === opt.id ? { ...o, name: e.target.value } : o))); }} />
                </label>
                <label className="field" style={{ flex: "2 1 240px" }}>
                  <span className="label">Short note for the customer (optional)</span>
                  <input className="input sm" value={opt.note ?? ""} maxLength={500} placeholder="Best comfort and lowest energy bills" onChange={(e) => { touch(); setOptions((os) => os.map((o) => (o.id === opt.id ? { ...o, note: e.target.value || null } : o))); }} />
                </label>
                {options.length > 1 ? (
                  <span className="row" style={{ gap: 6 }}>
                    {options.length <= 3 && !options.every((o, i) => o.name === ["Good", "Better", "Best"][i]) ? <button type="button" className="btn sm ghost" onClick={goodBetterBest}>Name them Good, Better, Best</button> : null}
                    <button type="button" className="btn sm ghost" onClick={() => removeOption(opt.id)} aria-label="Remove this option"><Trash2 size={14} /></button>
                  </span>
                ) : null}
              </div>
            ) : opt.note ? <span className="small muted">{opt.note}</span> : null}

            {optLines.length ? section(optLines) : <div className="q-empty small muted">No work in {opt.name} yet. Add a line, a package or pull in a takeoff.</div>}

            {!readOnly ? (
              <div className="row wrap" style={{ gap: 8 }}>
                <button type="button" className="btn sm" onClick={() => setPicker({ addon: false })}><Plus size={15} /> Add work</button>
                <button type="button" className="btn sm dark" onClick={() => setPkgOpen(true)}><Package size={15} /> Packages</button>
                <button type="button" className="btn sm dark" onClick={() => setToOpen(true)}><Ruler size={15} /> From a takeoff</button>
              </div>
            ) : null}
          </section>

          <section className="card col" style={{ gap: 10 }}>
            <div className="row between">
              <b>Add-ons</b>
              <span className="tiny faint">Extras the customer can tick when they sign</span>
            </div>
            {addons.length ? section(addons) : <span className="small muted">None. Upgrades like air sealing, a garage ceiling or removal go here.</span>}
            {!readOnly ? <div><button type="button" className="btn sm dark" onClick={() => setPicker({ addon: true })}><Plus size={15} /> Add-on</button></div> : null}
          </section>

          <section className="card col" style={{ gap: 10 }}>
            <b>Proposal words</b>
            <label className="field">
              <span className="label">Note at the top (optional)</span>
              <textarea className="textarea" rows={3} disabled={readOnly} maxLength={4000} value={fields.intro ?? ""} placeholder="Thanks for having us out. Here's what we recommend for your attic and walls…" onChange={(e) => setF({ intro: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Terms</span>
              <textarea className="textarea" rows={4} disabled={readOnly} maxLength={8000} value={fields.terms ?? ""} onChange={(e) => setF({ terms: e.target.value })} />
            </label>
          </section>
        </div>

        {/* ------------------------------------------------ totals and sending */}
        <aside className="col q-side" style={{ gap: 14 }}>
          <section className="card col" style={{ gap: 10 }}>
            <b>{opt.name}</b>
            <div className="q-tot">
              <span>Price</span><b>{money(ot?.price)}</b>
              {ot?.min_adj ? <><span className="tiny faint">incl. minimum job</span><span className="tiny faint">{money(ot.min_adj)}</span></> : null}
              <span>Tax</span><b>{fields.tax_exempt ? "Exempt" : money(ot?.tax)}</b>
              <span className="q-big">Total</span><b className="q-big">{money(ot?.total)}</b>
              {fields.deposit_pct ? <><span>Deposit ({num(fields.deposit_pct, 1)}%)</span><b>{money(ot?.deposit)}</b></> : null}
              <span>Your cost</span><b>{money(ot?.cost)}</b>
              <span>Margin</span><b className={`q-m ${marginCls(ot?.margin ?? null)}`}>{pct(ot?.margin)}</b>
            </div>
            {options.length > 1 ? (
              <div className="q-opts">
                {options.map((o) => (
                  <button key={o.id} type="button" className={o.id === optId ? "on" : ""} onClick={() => setOptId(o.id)}>
                    <span className="ellipsis">{o.name}</span>
                    <b>{money(totals.options[o.id]?.total ?? 0, false)}</b>
                    <i className={`q-m ${marginCls(totals.options[o.id]?.margin ?? null)}`}>{pct(totals.options[o.id]?.margin)}</i>
                  </button>
                ))}
              </div>
            ) : null}
            {addons.length ? <span className="tiny faint">Add-ons: {addons.length}, up to {money(addons.reduce((a, l) => a + (totals.addons[l.id]?.total ?? 0), 0))} more</span> : null}
            {target === null ? <div className="alert warn small"><span>No target margin yet, so prices are $0 until you set one below (or in Settings &gt; Pricing).</span></div> : null}
            {warnings.length ? (
              <div className="alert warn small">
                <AlertTriangle size={15} style={{ flex: "none", marginTop: 1 }} />
                <span>{warnings.slice(0, 4).join(" ")}</span>
              </div>
            ) : null}
          </section>

          <section className="card col" style={{ gap: 10 }}>
            {link ? (
              <>
                <b>Proposal link</b>
                <div className="q-link">
                  <input className="input sm" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Proposal link" />
                  <button type="button" className="btn sm dark" onClick={() => void navigator.clipboard?.writeText(link)} aria-label="Copy link"><Copy size={14} /></button>
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <a className="btn sm dark" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open</a>
                  {props.customer?.phone ? <a className="btn sm dark" href={`sms:${props.customer.phone}?&body=${encodeURIComponent(`Here's your proposal: ${link}`)}`}><MessageSquare size={14} /> Text it</a> : null}
                </div>
                <span className="tiny faint">
                  {q.viewed_at ? `Opened ${dateTime(q.viewed_at)}${q.view_count > 1 ? ` (${q.view_count} times)` : ""}.` : q.sent_at ? `Sent ${dateShort(q.sent_at)}; not opened yet.` : ""}
                  {q.valid_until && !signed ? ` Good until ${dateShort(q.valid_until)}.` : ""}
                </span>
              </>
            ) : null}
            {!signed && props.can.edit ? (
              <button type="button" className="btn" disabled={!priced.some((l) => l.option_id) || (needsOk && !props.can.approve)} onClick={() => setSendOpen(true)}>
                <Send size={16} /> {link ? "Send again" : "Send to the customer"}
              </button>
            ) : null}
            <a className="btn sm dark" href={`/ops/quotes/${q.id}/pdf`} target="_blank" rel="noopener noreferrer"><FileDown size={15} /> PDF</a>
            {props.can.order ? (
              <Link className="btn sm dark" href={`/ops/materials?quote=${q.id}&option=${signed && q.signed_option_id ? q.signed_option_id : optId}`}>
                <ShoppingCart size={15} /> Create material order
              </Link>
            ) : null}
          </section>

          <section className="card col" style={{ gap: 10 }}>
            <b>Pricing</b>
            <div className="seg sm" role="radiogroup" aria-label="Price level">
              <button type="button" role="radio" aria-checked={fields.price_level === "retail"} className={fields.price_level === "retail" ? "on" : ""} disabled={readOnly} onClick={() => setF({ price_level: "retail" })}>Retail</button>
              <button type="button" role="radio" aria-checked={fields.price_level === "builder"} className={fields.price_level === "builder" ? "on" : ""} disabled={readOnly} onClick={() => setF({ price_level: "builder" })}>Builder</button>
            </div>
            <div className="grid2">
              <NumBox label={fields.price_level === "builder" && st.builder_margin !== null ? "Target (builder in Settings)" : "Target margin"} value={fields.target_margin} onChange={(v) => setF({ target_margin: v })} suffix="%" disabled={readOnly || (fields.price_level === "builder" && st.builder_margin !== null)} />
              <NumBox label="Lowest margin" value={fields.floor_margin} onChange={(v) => setF({ floor_margin: v })} suffix="%" disabled={readOnly || !props.can.approve} />
              <NumBox label="Labor burden" value={fields.burden_pct} onChange={(v) => setF({ burden_pct: v })} suffix="%" disabled={readOnly} />
              <NumBox label="Deposit" value={fields.deposit_pct} onChange={(v) => setF({ deposit_pct: v })} suffix="%" disabled={readOnly} />
              <NumBox label="Tax rate" value={fields.tax_rate} onChange={(v) => setF({ tax_rate: v })} suffix="%" disabled={readOnly || fields.tax_exempt} />
            </div>
            <label className="check small"><input type="checkbox" checked={fields.tax_exempt} disabled={readOnly} onChange={(e) => setF({ tax_exempt: e.target.checked })} /> Customer is tax exempt</label>
            <label className="check small"><input type="checkbox" checked={fields.tax_labor} disabled={readOnly || fields.tax_exempt} onChange={(e) => setF({ tax_labor: e.target.checked })} /> Tax labor too (not just materials)</label>
            <label className="field">
              <span className="label">Sales rep</span>
              <select className="select sm" value={fields.rep_id ?? ""} disabled={readOnly} onChange={(e) => setF({ rep_id: e.target.value || null })}>
                <option value="">Not assigned</option>
                {props.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <span className="tiny faint">Direct margin: materials and labor only, no overhead. Prices follow the target unless a line has its own price.</span>
          </section>

          <section className="card col" style={{ gap: 8 }}>
            {props.can.edit || signed || status === "declined" ? (
              <form action={copyQuote}>
                <input type="hidden" name="id" value={q.id} />
                <Submit className="btn sm dark" pendingText="Copying…"><Layers size={15} /> Make a copy</Submit>
              </form>
            ) : null}
            {props.can.remove && !signed ? (
              <form action={deleteQuote} onSubmit={(e) => { if (!window.confirm("Delete this quote? This can't be undone.")) e.preventDefault(); }}>
                <input type="hidden" name="id" value={q.id} />
                <Submit className="btn sm ghost danger-text" pendingText="…"><Trash2 size={14} /> Delete quote</Submit>
              </form>
            ) : null}
          </section>
        </aside>
      </div>

      {/* ------------------------------------------------ dialogs */}
      {picker ? <Picker products={props.products} addon={picker.addon} areas={st.work_areas} area={lastArea} setArea={setLastArea} onPick={addFor} onClose={() => setPicker(null)} /> : null}
      {pkgOpen ? (
        <PackageDialog
          packages={packages}
          canSave={optLines.length > 0}
          onUse={addPackage}
          onSave={async (name) => {
            const r = await savePackage(name, optLines);
            if (!r.ok) return r.error ?? "Didn't save.";
            setPackages((p) => [...p, { id: r.id!, name, lines: optLines }].sort((a, b) => a.name.localeCompare(b.name)));
            return null;
          }}
          onDelete={async (id) => {
            await deletePackage(id);
            setPackages((p) => p.filter((x) => x.id !== id));
          }}
          onClose={() => setPkgOpen(false)}
        />
      ) : null}
      {toOpen ? (
        <div className="ops-modal" role="dialog" aria-modal="true" aria-label="From a takeoff" onClick={() => setToOpen(false)}>
          <div className="ops-modal-card col" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="row between"><b>Add the work from a takeoff</b><button type="button" className="iconbtn" onClick={() => setToOpen(false)} aria-label="Close"><X size={18} /></button></div>
            <span className="small muted">Each measured item becomes a line in {opt.name}, in its work area, with your product picked. Check depths and R-values after.</span>
            {props.takeoffs.length ? (
              <div className="list">
                {props.takeoffs.map((t) => (
                  <button key={t.id} type="button" className="item" onClick={() => pullTakeoff(t.id)}>
                    <div className="grow" style={{ textAlign: "left", minWidth: 0 }}>
                      <div className="t ellipsis">{t.name}</div>
                      <div className="s ellipsis">{[t.customer, `updated ${dateShort(t.updated_at)}`].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Plus size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <span className="small muted">No takeoffs yet.</span>
            )}
            <Link href="/takeoff" className="btn sm dark"><Ruler size={15} /> Start a takeoff</Link>
          </div>
        </div>
      ) : null}
      {sendOpen ? (
        <SendDialog
          customer={props.customer}
          emailReady={props.emailReady}
          dirty={dirty.current || save.state === "saving"}
          flush={doSave}
          onSend={async (email, to, message) => {
            const r = await sendQuote(q.id, { email, to, message });
            if (r.ok) {
              if (r.link) setLink(r.link);
              if (status === "draft") setStatus("sent");
            }
            return r;
          }}
          onClose={() => setSendOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ======================================================================================

function BlownFields({ l, chart, set }: { l: QLine; chart: ReturnType<typeof chartFor>; set: (p: Partial<QLine>) => void }) {
  const walls = !!l.framing;
  const rows = chart && l.framing ? chart.walls.filter((w) => w.framing === l.framing) : [];
  return (
    <div className="q-row">
      <div className="field" style={{ flex: "0 0 auto" }}>
        <span className="label">Where</span>
        <div className="seg sm" role="radiogroup" aria-label="Where">
          <button type="button" role="radio" aria-checked={!walls} className={!walls ? "on" : ""} onClick={() => set({ framing: null, r_value: l.r_value && l.r_value >= 19 ? l.r_value : 38 })}>Attic (open blow)</button>
          <button type="button" role="radio" aria-checked={walls} className={walls ? "on" : ""} onClick={() => set({ framing: wallFramings(chart)[0] ?? "2x4", r_value: null })}>Walls (dense pack / BIBS)</button>
        </div>
      </div>
      {!walls ? (
        <label className="field" style={{ maxWidth: 160 }}>
          <span className="label">R-value</span>
          <select className="select sm" value={l.r_value ?? ""} onChange={(e) => set({ r_value: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Pick</option>
            {atticRs(chart).map((r) => <option key={r} value={r}>R-{r}</option>)}
          </select>
        </label>
      ) : (
        <>
          <label className="field" style={{ maxWidth: 130 }}>
            <span className="label">Framing</span>
            <select className="select sm" value={l.framing ?? ""} onChange={(e) => set({ framing: e.target.value, r_value: null })}>
              {wallFramings(chart).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          {rows.length > 1 ? (
            <label className="field" style={{ maxWidth: 220 }}>
              <span className="label">R-value / density</span>
              <select className="select sm" value={l.r_value ?? ""} onChange={(e) => set({ r_value: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Densest ({rows[rows.length - 1].pcf} lb/cu ft)</option>
                {rows.map((w) => <option key={`${w.r}-${w.pcf}`} value={w.r}>R-{w.r} at {w.pcf} lb/cu ft</option>)}
              </select>
            </label>
          ) : null}
        </>
      )}
      {!chart ? <span className="tiny warn-text" style={{ alignSelf: "flex-end", paddingBottom: 10 }}>This product has no coverage chart (Settings &gt; Products).</span> : null}
    </div>
  );
}

function Picker({ products, addon, areas, area, setArea, onPick, onClose }: { products: QProduct[]; addon: boolean; areas: WorkArea[]; area: string | null; setArea: (a: string | null) => void; onPick: (kind: string, p: QProduct | null, addon: boolean) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const on = products.filter((p) => p.active && (!t || `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(t)));
  return (
    <div className="ops-modal" role="dialog" aria-modal="true" aria-label={addon ? "Add an add-on" : "Add work"} onClick={onClose}>
      <div className="ops-modal-card col q-picker" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><b>{addon ? "Add an add-on" : "Add work"}</b><button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="field">
          <span className="label">Work area</span>
          <div className="chips wrap">
            {areas.map((a) => (
              <button key={a.code} type="button" className={`chip sm${(area ?? areas[0]?.code) === a.code ? " on" : ""}`} onClick={() => setArea(a.code)}>{a.code} · {a.name}</button>
            ))}
          </div>
        </div>
        <input className="input sm" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product" aria-label="Find a product" />
        <div className="q-pick-list">
          {GROUPS.map((g) => {
            const list = on.filter((p) => g.kinds.includes(p.kind));
            if (!list.length) return null;
            return (
              <div key={g.title} className="col" style={{ gap: 6 }}>
                <span className="eyebrow">{g.title}</span>
                {list.map((p) => (
                  <button key={p.id} type="button" className="q-pick" onClick={() => onPick(p.kind, p, addon)}>
                    <span className="grow col tight" style={{ minWidth: 0, textAlign: "left" }}>
                      <b className="ellipsis">{p.name}</b>
                      <span className="tiny faint ellipsis">{[p.sku, p.cost === null ? "no cost yet" : `${money(p.cost)}/${p.unit}`, p.yield_bf ? `${num(p.yield_bf)} bd ft/set` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Plus size={16} />
                  </button>
                ))}
              </div>
            );
          })}
          {!t ? (
            <div className="col" style={{ gap: 6 }}>
              <span className="eyebrow">Labor and other</span>
              {PLAIN.map((x) => (
                <button key={x.kind} type="button" className="q-pick" onClick={() => onPick(x.kind, null, addon)}>
                  <span className="grow col tight" style={{ textAlign: "left" }}><b>{x.label}</b><span className="tiny faint">{x.hint}</span></span>
                  <Plus size={16} />
                </button>
              ))}
            </div>
          ) : null}
          {t && !on.length ? <span className="small muted">No product matches. Add it in Settings &gt; Products.</span> : null}
        </div>
      </div>
    </div>
  );
}

function PackageDialog({ packages, canSave, onUse, onSave, onDelete, onClose }: { packages: Pkg[]; canSave: boolean; onUse: (p: Pkg) => void; onSave: (name: string) => Promise<string | null>; onDelete: (id: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Packages" onClick={onClose}>
      <div className="ops-modal-card col" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><b>Packages</b><button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <span className="small muted">Your usual setups (&quot;Attic R-49 blown&quot;, &quot;New build open cell&quot;): drop one in, then type the sizes.</span>
        {packages.length ? (
          <div className="list">
            {packages.map((p) => (
              <div key={p.id} className="item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{p.name}</div>
                  <div className="s">{p.lines.length} line{p.lines.length === 1 ? "" : "s"}</div>
                </div>
                <button type="button" className="btn sm" onClick={() => onUse(p)}><Plus size={14} /> Use</button>
                <button type="button" className="iconbtn" aria-label={`Delete ${p.name}`} onClick={() => { if (window.confirm(`Delete the package "${p.name}"?`)) void onDelete(p.id); }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        ) : (
          <span className="small muted">No packages yet.</span>
        )}
        {canSave ? (
          <form
            className="col"
            style={{ gap: 8 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await onSave(name);
              setBusy(false);
              setErr(r);
              if (!r) setName("");
            }}
          >
            <label className="field">
              <span className="label">Save this option&apos;s lines as a package</span>
              <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Attic R-49 blown" required />
            </label>
            {err ? <span className="small red">{err}</span> : null}
            <button type="submit" className="btn sm dark" disabled={busy}>{busy ? "Saving…" : "Save package"}</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function SendDialog({
  customer,
  emailReady,
  dirty,
  flush,
  onSend,
  onClose,
}: {
  customer: Customer | null;
  emailReady: boolean;
  dirty: boolean;
  flush: () => Promise<void>;
  onSend: (email: boolean, to: string | null, message: string | null) => Promise<{ ok: boolean; error?: string; link?: string; emailed?: string | null; emailNote?: string | null }>;
  onClose: () => void;
}) {
  const [to, setTo] = useState(customer?.email ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; error?: string; link?: string; emailed?: string | null; emailNote?: string | null } | null>(null);
  const go = async (email: boolean) => {
    setBusy(true);
    if (dirty) await flush();
    const r = await onSend(email, to || null, msg || null);
    setBusy(false);
    setRes(r);
  };
  return (
    <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Send the quote" onClick={onClose}>
      <div className="ops-modal-card col" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><b>Send to {customer?.name ?? "the customer"}</b><button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        {res?.ok ? (
          <>
            <div className="alert ok small">
              <CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} />
              <span>{res.emailed ? `Emailed to ${res.emailed}.` : "Ready to share."} The lead moved to Quote sent.</span>
            </div>
            {res.emailNote ? <div className="alert warn small"><span>{res.emailNote}</span></div> : null}
            {res.link ? (
              <>
                <div className="q-link">
                  <input className="input sm" readOnly value={res.link} onFocus={(e) => e.currentTarget.select()} aria-label="Proposal link" />
                  <button type="button" className="btn sm dark" onClick={() => void navigator.clipboard?.writeText(res.link!)}><Copy size={14} /> Copy</button>
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {customer?.phone ? <a className="btn sm" href={`sms:${customer.phone}?&body=${encodeURIComponent(`Here's your proposal: ${res.link}`)}`}><MessageSquare size={14} /> Text it</a> : null}
                  <a className="btn sm dark" href={res.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> See what they see</a>
                </div>
              </>
            ) : null}
            <button type="button" className="btn sm dark" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <span className="small muted">They get a private link: they can look it over on their phone, pick an option and add-ons, and sign. You&apos;ll see when they open it.</span>
            <label className="field">
              <span className="label">Email</span>
              <input className="input sm" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@email.com" />
            </label>
            <label className="field">
              <span className="label">Message (optional)</span>
              <textarea className="textarea" rows={3} maxLength={1500} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Great meeting you today. Here's the proposal we talked about." />
            </label>
            {!emailReady ? <span className="tiny warn-text">Email from the app isn&apos;t working yet. Use &quot;Just get the link&quot; and text or email it yourself.</span> : null}
            {res && !res.ok ? <div className="alert err small"><span>{res.error}</span></div> : null}
            <div className="row wrap" style={{ gap: 8 }}>
              <button type="button" className="btn sm" disabled={busy || !to || !emailReady} onClick={() => void go(true)}><Send size={14} /> {busy ? "Sending…" : "Email it"}</button>
              <button type="button" className="btn sm dark" disabled={busy} onClick={() => void go(false)}><FileSignature size={14} /> Just get the link</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
