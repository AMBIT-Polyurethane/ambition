"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, CircleAlert, Download, ImagePlus, LoaderCircle, Pencil, Percent, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toJpeg } from "@/lib/images";
import { applyMarkup, fillAmbitCosts, saveItem, saveItemField, setItemActive, type ItemField } from "@/app/store/desk-actions";
import { catName } from "@/lib/adc-i18n";

export type DeskItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  image_url: string | null;
  cost: number | null;
  price: number | null;
  per_customer: boolean;
  qty_on_hand: number | null;
  active: boolean;
  ambit: boolean;
};

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const show = (v: number | null) => (v === null ? "" : Number.isInteger(v * 100) ? v.toFixed(2) : String(v));
const markup = (cost: number | null, price: number | null) => (cost && price !== null ? Math.round(((price - cost) / cost) * 100) : null);
const margin = (cost: number | null, price: number | null) => (cost !== null && price ? Math.round(((price - cost) / price) * 100) : null);

type Filter = "all" | "missing" | "foam" | "removed";

/** Nick's price sheet: every item on his store with his purchase price, sell price and qty on hand. */
export function DeskPrices({ slug, items: start, readOnly, ambit = {} }: { slug: string; items: DeskItem[]; readOnly: boolean; ambit?: Record<string, number> }) {
  const [items, setItems] = useState(start);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState<DeskItem | "new" | null>(null);
  const [markupOpen, setMarkupOpen] = useState(false);
  const [filling, startFill] = useTransition();
  // Bumped after a bulk change (fill from AMBIT, markup) so every price box shows the new numbers.
  const [ver, setVer] = useState(0);
  const ambitN = Object.keys(ambit).length;
  const [note, setNote] = useState<string | null>(null);

  const live = items.filter((i) => i.active);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))], [items]);
  const missing = live.filter((i) => !i.per_customer && (i.price === null || i.cost === null));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((i) => {
    if (filter === "removed" ? i.active : !i.active) return false;
    if (filter === "missing" && !(!i.per_customer && (i.price === null || i.cost === null))) return false;
    if (filter === "foam" && !i.per_customer) return false;
    if (cat && i.category !== cat) return false;
    return words.every((w) => `${i.sku} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(w));
  });
  const priced = live.filter((i) => !i.per_customer && i.price !== null && i.cost !== null);
  const avg = priced.length ? Math.round(priced.reduce((n, i) => n + (markup(i.cost, i.price) ?? 0), 0) / priced.length) : null;
  const patch = (id: string, p: Partial<DeskItem>) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="adc-stack-s">
      <div className="ptn-desk-h">
        <span>
          <h1 className="adc-h1">Price sheet</h1>
          <span className="adc-muted">Your purchase price and your sell price for every item on your store. Changes save as soon as you leave a box.</span>
        </span>
        {!readOnly ? (
          <>
            {ambitN ? (
              <button
                type="button"
                className="adc-ghost dark"
                disabled={filling}
                title="Your purchase price = what AMBIT charges you (foam per lb). Only boxes that are empty."
                onClick={() =>
                  startFill(async () => {
                    const r = await fillAmbitCosts(slug, true);
                    if (!r.ok) return setNote(r.error);
                    setItems((cur) => cur.map((x) => (x.active && x.cost === null && ambit[x.id] !== undefined ? { ...x, cost: ambit[x.id] } : x)));
                    setVer((v) => v + 1);
                    setNote(r.message ?? "Done.");
                  })
                }
              >
                {filling ? <LoaderCircle size={17} className="spin" /> : <Download size={17} aria-hidden="true" />} Fill purchase prices from AMBIT
              </button>
            ) : null}
            <button type="button" className="adc-ghost dark" onClick={() => setMarkupOpen(true)}><Percent size={17} aria-hidden="true" /> Set sell prices by markup</button>
            <button type="button" className="adc-cta" onClick={() => setEdit("new")}><Plus size={18} aria-hidden="true" /> Add an item</button>
          </>
        ) : null}
      </div>

      <div className="ptn-stats">
        <span><b>{live.length}</b><span>Items on your store</span></span>
        <span><b>{live.length - missing.length}</b><span>Ready (both prices in)</span></span>
        <span><b>{missing.length}</b><span>Still need a price</span></span>
        <span><b>{avg === null ? "-" : `${avg}%`}</b><span>Average markup</span></span>
      </div>

      {note ? <div className="ptn-ok" role="status"><Check size={18} aria-hidden="true" /><span>{note}</span><button type="button" className="ptn-x" onClick={() => setNote(null)} aria-label="Close"><X size={16} /></button></div> : null}

      <div className="ptn-tools">
        <label className="adc-search light"><Search size={18} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item by name or part number" aria-label="Find an item" /></label>
        <select className="ptn-sel" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">Every category</option>
          {cats.map((c) => <option key={c} value={c}>{catName(c, "en")}</option>)}
        </select>
      </div>
      <div className="adc-chips" role="tablist" aria-label="Show">
        {([
          ["all", `All (${live.length})`],
          ["missing", `Needs a price (${missing.length})`],
          ["foam", `AMBIT spray foam (${live.filter((i) => i.per_customer).length})`],
          ["removed", `Removed (${items.length - live.length})`],
        ] as [Filter, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : undefined} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="ptn-sheet" role="table" aria-label="Price sheet">
        <div className="ptn-sheet-h" role="row">
          <span role="columnheader">Item</span>
          <span role="columnheader" className="num">Purchase price</span>
          <span role="columnheader" className="num">Sell price</span>
          <span role="columnheader" className="num">Markup / margin</span>
          <span role="columnheader" className="num">Qty on hand</span>
          <span role="columnheader"><span className="sr-only">Change</span></span>
        </div>
        {shown.map((i) => (
          <div key={i.id} role="row" className={`ptn-srow${i.active ? "" : " off"}${!i.per_customer && (i.price === null || i.cost === null) && i.active ? " need" : ""}`}>
            <span className="ptn-srow-i" role="cell">
              <button type="button" className="ptn-line-ph sm" onClick={() => setEdit(i)} aria-label={`${readOnly ? "See" : "Change"} ${i.name}`}>
                {i.image_url ? <img src={i.image_url} alt="" className="adc-img" loading="lazy" /> : <span className="adc-img empty"><Camera size={18} /></span>}
              </button>
              <span className="ptn-line-b">
                <span className="adc-sku">{i.sku}{i.category ? ` · ${i.category.toUpperCase()}` : ""}</span>
                <b>{i.name}</b>
                {ambit[i.id] !== undefined ? (
                  <span className={`ptn-ambit${i.cost !== null && Math.abs(i.cost - ambit[i.id]) > 0.004 ? " diff" : ""}`}>
                    Your AMBIT price {usd(ambit[i.id])}{i.per_customer ? "/lb" : ""}{i.cost !== null && Math.abs(i.cost - ambit[i.id]) > 0.004 ? " (not what's in your purchase price)" : ""}
                  </span>
                ) : null}
              </span>
            </span>
            <Cell key={`c${ver}`} slug={slug} item={i} field="cost" readOnly={readOnly || !i.active} label={i.per_customer ? "Your purchase price per lb" : "Your purchase price"} onSaved={(v) => patch(i.id, { cost: v })} suffix={i.per_customer ? "/lb" : undefined} />
            {i.per_customer ? (
              <span role="cell" className="ptn-pc num"><b>Per customer</b><span>Set each customer&apos;s $/lb under Customers</span></span>
            ) : (
              <Cell key={`p${ver}`} slug={slug} item={i} field="price" readOnly={readOnly || !i.active} label="Your sell price" onSaved={(v) => patch(i.id, { price: v })} />
            )}
            <span role="cell" className="num ptn-mk">
              {i.per_customer ? "" : markup(i.cost, i.price) === null ? "-" : `${markup(i.cost, i.price)}%`}
              {!i.per_customer && margin(i.cost, i.price) !== null ? <span className="ptn-mg">{margin(i.cost, i.price)}% margin</span> : null}
            </span>
            <Cell key={`q${ver}`} slug={slug} item={i} field="qty_on_hand" readOnly={readOnly || !i.active} label="Qty on hand" onSaved={(v) => patch(i.id, { qty_on_hand: v })} plain />
            <span role="cell" className="ptn-srow-a">
              {readOnly ? (
                <button type="button" className="ptn-icon" onClick={() => setEdit(i)} aria-label={`See ${i.name}`}><Pencil size={16} /></button>
              ) : i.active ? (
                <>
                  <button type="button" className="ptn-icon" onClick={() => setEdit(i)} aria-label={`Change ${i.name}`} title="Change name, photo, details"><Pencil size={16} /></button>
                  <RemoveBtn slug={slug} item={i} onDone={() => patch(i.id, { active: false })} />
                </>
              ) : (
                <RestoreBtn slug={slug} item={i} onDone={() => patch(i.id, { active: true })} />
              )}
            </span>
          </div>
        ))}
        {!shown.length ? <div className="adc-empty" style={{ padding: 30 }}><Search size={24} aria-hidden="true" /><b>Nothing here.</b></div> : null}
      </div>

      {edit ? (
        <ItemEditor
          slug={slug}
          item={edit === "new" ? null : edit}
          cats={cats}
          readOnly={readOnly}
          onClose={() => setEdit(null)}
          onSaved={(row) => {
            setItems((cur) => (cur.some((x) => x.id === row.id) ? cur.map((x) => (x.id === row.id ? row : x)) : [row, ...cur]));
            setEdit(null);
            setNote(edit === "new" ? `${row.name} is on your sheet and your store.` : `Saved ${row.name}.`);
          }}
        />
      ) : null}
      {markupOpen ? (
        <MarkupBox
          slug={slug}
          cats={cats}
          onClose={() => setMarkupOpen(false)}
          onDone={(pct, onlyEmpty, message, group) => {
            setItems((cur) => cur.map((x) => (x.active && !x.per_customer && x.cost !== null && (!onlyEmpty || x.price === null) && (!group || x.category === group) ? { ...x, price: Math.round(x.cost * (1 + pct / 100) * 100) / 100 } : x)));
            setVer((v) => v + 1);
            setMarkupOpen(false);
            setNote(message);
          }}
        />
      ) : null}
    </div>
  );
}

/** A price or qty box: saves when they leave it (or press Enter). */
function Cell({ slug, item, field, label, readOnly, onSaved, suffix, plain }: { slug: string; item: DeskItem; field: ItemField; label: string; readOnly: boolean; onSaved: (v: number | null) => void; suffix?: string; plain?: boolean }) {
  const start = field === "cost" ? item.cost : field === "price" ? item.price : item.qty_on_hand;
  const [val, setVal] = useState(plain ? (start === null ? "" : String(start)) : show(start));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const last = useRef(val);
  const save = async () => {
    if (val.trim() === last.current.trim()) return;
    setState("saving");
    const res = await saveItemField(slug, item.id, field, val);
    if (!res.ok) {
      setState("error");
      setErr(res.error);
      return;
    }
    last.current = val;
    const n = val.trim() === "" ? null : Number(val.replace(/[$,\s]/g, ""));
    onSaved(n);
    if (!plain && n !== null) {
      const s = show(n);
      setVal(s);
      last.current = s;
    }
    setState("saved");
    setErr(null);
    setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
  };
  return (
    <span role="cell" className={`ptn-cell num ${state}`}>
      <span className="ptn-cell-in">
        {plain ? null : <span className="ptn-cur" aria-hidden="true">$</span>}
        <input
          inputMode="decimal"
          value={val}
          disabled={readOnly}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label={`${label}: ${item.name}`}
          placeholder={readOnly ? "" : "-"}
        />
        {suffix ? <span className="ptn-suf" aria-hidden="true">{suffix}</span> : null}
        <span className="ptn-cell-st" aria-hidden="true">
          {state === "saving" ? <LoaderCircle size={14} className="spin" /> : state === "saved" ? <Check size={14} strokeWidth={3} /> : state === "error" ? <CircleAlert size={14} /> : null}
        </span>
      </span>
      {err ? <span className="ptn-cell-err" role="alert">{err}</span> : null}
    </span>
  );
}

function RemoveBtn({ slug, item, onDone }: { slug: string; item: DeskItem; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [pending, start] = useTransition();
  if (!sure) return <button type="button" className="ptn-icon" onClick={() => setSure(true)} aria-label={`Remove ${item.name}`} title="Remove from your store"><Trash2 size={16} /></button>;
  return (
    <span className="ptn-sure">
      <button type="button" className="ptn-icon red" disabled={pending} onClick={() => start(async () => { const r = await setItemActive(slug, item.id, false); if (r.ok) onDone(); else setSure(false); })}>
        {pending ? <LoaderCircle size={14} className="spin" /> : "Remove"}
      </button>
      <button type="button" className="ptn-icon" onClick={() => setSure(false)} aria-label="Keep it"><X size={14} /></button>
    </span>
  );
}

function RestoreBtn({ slug, item, onDone }: { slug: string; item: DeskItem; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="ptn-icon wide" disabled={pending} onClick={() => start(async () => { const r = await setItemActive(slug, item.id, true); if (r.ok) onDone(); })}>
      {pending ? <LoaderCircle size={14} className="spin" /> : <><RotateCcw size={14} /> Bring back</>}
    </button>
  );
}

/** Add an item, or change one: name, part number, details, photo, prices. */
function ItemEditor({ slug, item, cats, readOnly, onClose, onSaved }: { slug: string; item: DeskItem | null; cats: string[]; readOnly: boolean; onClose: () => void; onSaved: (row: DeskItem) => void }) {
  const [img, setImg] = useState<string | null>(item?.image_url ?? null);
  const [foam, setFoam] = useState(item?.per_customer ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setBusy("Getting your photo ready...");
    try {
      const jpeg = await toJpeg(f, 1000, 0.86);
      const supabase = createClient();
      const path = `partners/${slug}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("product-images").upload(path, jpeg, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw new Error(error.message);
      setImg(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setErr(`That photo didn't upload: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const submit = (f: FormData) => {
    setErr(null);
    const s = (k: string) => String(f.get(k) ?? "");
    start(async () => {
      const input = {
        id: item?.id ?? null,
        sku: s("sku"),
        name: s("name"),
        description: s("description"),
        category: s("category"),
        unit: s("unit"),
        cost: s("cost"),
        price: foam ? "" : s("price"),
        qty_on_hand: s("qty_on_hand"),
        per_customer: foam,
        image_url: img,
      };
      const res = await saveItem(slug, input);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));
      onSaved({
        id: res.id!,
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description.trim() || null,
        category: input.category.trim() || null,
        unit: input.unit.trim() || "each",
        image_url: img,
        cost: n(input.cost),
        price: foam ? null : n(input.price),
        per_customer: foam,
        qty_on_hand: n(input.qty_on_hand),
        active: item?.active ?? true,
        ambit: item?.ambit ?? false,
      });
    });
  };

  return (
    <div className="ptn-modal" role="dialog" aria-modal="true" aria-label={item ? `Change ${item.name}` : "Add an item"} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form action={submit} className="ptn-modal-b">
        <div className="ptn-modal-h">
          <h2 className="adc-h2">{item ? (readOnly ? item.name : "Change item") : "Add an item"}</h2>
          <button type="button" className="ptn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <fieldset disabled={readOnly || pending} className="ptn-fs">
          <div className="ptn-photo">
            <span className="ptn-photo-ph">{img ? <img src={img} alt="" /> : <Camera size={34} aria-hidden="true" />}</span>
            {!readOnly ? (
              <span className="ptn-photo-b">
                <label className="adc-ghost dark ptn-file"><ImagePlus size={17} aria-hidden="true" /> {img ? "Change photo" : "Add a photo"}<input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} /></label>
                {img ? <button type="button" className="ptn-linkbtn" onClick={() => setImg(null)}>No photo</button> : null}
                <span className="adc-muted small">{busy ?? "A square photo on a white background looks best."}</span>
              </span>
            ) : null}
          </div>
          <div className="adc-f2">
            <label className="adc-f"><span>Part number (SKU)</span><input name="sku" required defaultValue={item?.sku ?? ""} maxLength={40} /></label>
            <label className="adc-f"><span>Category</span><input name="category" list="ptn-cats" defaultValue={item?.category ?? ""} maxLength={80} /></label>
            <label className="adc-f wide"><span>Name</span><input name="name" required defaultValue={item?.name ?? ""} maxLength={200} /></label>
            <label className="adc-f wide"><span>Details customers see (optional)</span><textarea name="description" rows={3} defaultValue={item?.description ?? ""} maxLength={4000} /></label>
            <label className="adc-f"><span>Sold as</span><input name="unit" list="ptn-units" defaultValue={item?.unit ?? "each"} maxLength={30} /></label>
            <label className="adc-f"><span>Qty on hand (optional)</span><input name="qty_on_hand" inputMode="decimal" defaultValue={item?.qty_on_hand ?? ""} /></label>
          </div>
          <label className="ptn-toggle"><input type="checkbox" checked={foam} onChange={(e) => setFoam(e.target.checked)} /> Priced per customer by the pound (spray foam)</label>
          <div className="adc-f2">
            <label className="adc-f"><span>{foam ? "Your purchase price per lb" : "Your purchase price"}</span><input name="cost" inputMode="decimal" defaultValue={item?.cost ?? ""} placeholder="$" /></label>
            {!foam ? <label className="adc-f"><span>Your sell price</span><input name="price" inputMode="decimal" defaultValue={item?.price ?? ""} placeholder="$" /></label> : <span className="adc-muted small" style={{ alignSelf: "end" }}>Each customer&apos;s $/lb is set under Customers.</span>}
          </div>
          <datalist id="ptn-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          <datalist id="ptn-units">{["each", "kit", "pack", "box", "case", "roll", "bag", "pail", "drum", "set", "tote", "gallon", "can"].map((u) => <option key={u} value={u} />)}</datalist>
        </fieldset>
        {err ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {err}</div> : null}
        {!readOnly ? (
          <div className="ptn-modal-f">
            <button type="button" className="adc-ghost dark" onClick={onClose}>Cancel</button>
            <button type="submit" className="adc-cta" disabled={pending || Boolean(busy)}>{pending ? <><LoaderCircle size={18} className="spin" /> Saving...</> : item ? "Save changes" : "Add to my store"}</button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function MarkupBox({ slug, cats, onClose, onDone }: { slug: string; cats: string[]; onClose: () => void; onDone: (pct: number, onlyEmpty: boolean, message: string, group: string) => void }) {
  const [pct, setPct] = useState("35");
  const [group, setGroup] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = Number(pct);
  return (
    <div className="ptn-modal" role="dialog" aria-modal="true" aria-label="Set sell prices by markup" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ptn-modal-b narrow">
        <div className="ptn-modal-h">
          <h2 className="adc-h2">Set sell prices by markup</h2>
          <button type="button" className="ptn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="adc-muted" style={{ margin: 0 }}>Sell price = your purchase price + this markup. Only items that have a purchase price. Spray foam is left alone.</p>
        <label className="adc-f">
          <span>Which items</span>
          <select className="ptn-sel" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Which items">
            <option value="">Every product group</option>
            {cats.map((c) => <option key={c} value={c}>{catName(c, "en")} only</option>)}
          </select>
        </label>
        <label className="adc-f"><span>Markup %</span><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
        {Number.isFinite(n) && n >= 0 ? <span className="adc-muted small">Example: a part you buy for {usd(10)} sells for {usd(Math.round(10 * (1 + n / 100) * 100) / 100)}, a {Math.round((n / (100 + n)) * 100)}% margin.</span> : null}
        <label className="ptn-toggle"><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> Only items with no sell price yet (keep the ones I typed)</label>
        {err ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {err}</div> : null}
        <div className="ptn-modal-f">
          <button type="button" className="adc-ghost dark" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="adc-cta"
            disabled={pending || !Number.isFinite(n) || n < 0}
            onClick={() =>
              start(async () => {
                const r = await applyMarkup(slug, n, onlyEmpty, group || null);
                if (!r.ok) setErr(r.error);
                else onDone(n, onlyEmpty, r.message ?? "Done.", group);
              })
            }
          >
            {pending ? <><LoaderCircle size={18} className="spin" /> Setting prices...</> : "Set the prices"}
          </button>
        </div>
      </div>
    </div>
  );
}
