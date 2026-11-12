"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CircleAlert, CircleCheck, FileText, ImagePlus, LoaderCircle, Plus, Search, Sparkles, SplitSquareHorizontal, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/photo-upload";
import { money, dateShort } from "@/lib/format";
import { CATEGORIES, INVENTORY, PEOPLE_CATS, receiptPhotoHref, type EndCustomer, type XReceipt } from "@/lib/expense-kinds";
import { deleteReceipt, readReceipt, saveReceipt, type InventoryDone, type ReceiptRead } from "@/app/(app)/expenses/actions";
import { BuyInventory, type BuyDone, type BuyState } from "@/components/expenses/buy-inventory";
import { UnlinkButton } from "@/components/expenses/month-bits";

// Add or fix a receipt: snap it (the AI fills in the rest), say which customer it was for, save. Opened from
// a card charge ("Add receipt" / "Lost receipt"), it's attached to that charge.

/** [id, name, city, state, distributor partner (0062)] */
export type MiniCustomer = [string, string, string | null, string | null, boolean?];
/** One line of a split receipt; the first line is "the rest" of the total. */
type Line = { category: string; amount: string };

type Photo = { path: string; preview: string | null; pdf: boolean };

const CUSTOMER_HINT = new Set(["Meals", "Customer entertainment", "Lodging", "Fuel", "Airfare & travel"]);

export function ReceiptForm({
  uid,
  today,
  customers,
  myCard,
  receipt,
  charge,
  lost: lostStart,
  aiReady,
  readOnly,
  backHref,
  matched,
  warehouses = [],
  buyStart = null,
  buyDone = null,
}: {
  uid: string;
  today: string;
  customers: MiniCustomer[];
  myCard: string | null;
  receipt?: XReceipt | null;
  charge?: { id: string; txn_date: string; label: string; amount: number; card: string | null } | null;
  lost?: boolean;
  aiReady: boolean;
  readOnly?: string | null;
  /** Opened from an approver's review screen: go back there. */
  backHref?: string | null;
  /** Editing: the card charge it's matched to. */
  matched?: { id: string; txn_date: string; label: string; amount: number; card: string | null } | null;
  /** 0062: the warehouses inventory can be bought for, and what's already on this receipt. */
  warehouses?: { id: string; name: string }[];
  buyStart?: BuyState | null;
  buyDone?: BuyDone;
}) {
  const router = useRouter();
  const r = receipt ?? null;
  const [photos, setPhotos] = useState<Photo[]>(() => (r?.photos ?? []).map((p, i) => ({ path: p, preview: receiptPhotoHref(r!.id, i, 400), pdf: /\.pdf$/i.test(p) })));
  const [lost, setLost] = useState(Boolean(lostStart || (r && !r.photos.length)));
  const [reason, setReason] = useState(r?.no_photo_reason ?? "");
  const [day, setDay] = useState(r?.bought_on ?? charge?.txn_date ?? today);
  const [vendor, setVendor] = useState(r?.vendor ?? charge?.label ?? "");
  const [amount, setAmount] = useState(r ? String(r.amount) : charge ? charge.amount.toFixed(2) : "");
  const [tip, setTip] = useState(r?.tip ? String(r.tip) : "");
  const [category, setCategory] = useState(r?.category ?? "");
  // A split receipt (fuel and lunch on one receipt): line 1 takes the rest of the total.
  const [split, setSplit] = useState<Line[] | null>(() => {
    const ls = Array.isArray(r?.lines) && r!.lines!.length > 1 ? r!.lines! : null;
    return ls ? ls.map((l, i) => ({ category: l.category, amount: i === 0 ? "" : Number(l.amount).toFixed(2) })) : null;
  });
  const [ends, setEnds] = useState<EndCustomer[]>(() => (Array.isArray(r?.end_customers) && r!.end_customers!.length ? r!.end_customers! : [{ name: "", business: "", phone: "" }]));
  const [buy, setBuy] = useState<BuyState>(buyStart ?? { branch: warehouses.length === 1 ? warehouses[0].id : "", mode: "", expected: "", lines: [] });
  const [paid, setPaid] = useState<"card" | "personal">(r?.paid_with ?? "card");
  const [card, setCard] = useState(r?.card_last4 ?? charge?.card ?? myCard ?? "");
  const [cust, setCust] = useState<{ id: string | null; name: string }>({ id: r?.company_id ?? null, name: r?.customer_name ?? "" });
  const [noCustomer, setNoCustomer] = useState(Boolean(r && !r.customer_name));
  const [purpose, setPurpose] = useState(r?.purpose ?? "");
  const [people, setPeople] = useState(r?.attendees ?? "");
  const [notes, setNotes] = useState(r?.notes ?? "");
  const [ai, setAi] = useState<(ReceiptRead & { cents: number }) | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "read" | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ month: string; matched: { day: string; amount: number; label: string } | null; inventory: InventoryDone | null; warn: string | null } | null>(null);
  const [sure, setSure] = useState(false);
  const touched = useRef(new Set<string>());
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mark = (k: string) => touched.current.add(k);

  useEffect(() => () => photos.forEach((p) => p.preview?.startsWith("blob:") && URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** What the AI read goes in wherever the person hasn't typed something themselves. */
  const apply = (x: ReceiptRead) => {
    const t = touched.current;
    if (x.vendor && !t.has("vendor") && (!vendor || !charge)) setVendor(x.vendor);
    if (x.date && !t.has("day") && !charge) setDay(x.date);
    if (x.total && !t.has("amount") && !charge) setAmount(x.total.toFixed(2));
    if (x.tip && !t.has("tip")) setTip(x.tip.toFixed(2));
    if (x.category && !t.has("category")) setCategory(x.category);
    if (x.lines && x.lines.length > 1 && !t.has("category")) {
      const ls = [...x.lines].sort((a, b) => b.amount - a.amount);
      setSplit(ls.map((l, i) => ({ category: l.category, amount: i === 0 ? "" : l.amount.toFixed(2) })));
    }
    if (x.card_last4 && !t.has("card")) setCard(x.card_last4);
    if (x.summary && !t.has("purpose") && !purpose) setPurpose(x.summary);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setBusy("upload");
    const supabase = createClient();
    const added: Photo[] = [];
    for (const f of Array.from(list).slice(0, 3)) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isImg = f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
      if (!isPdf && !isImg) {
        setError(`${f.name}: use a photo or a PDF.`);
        continue;
      }
      let body: Blob = f;
      let type = isPdf ? "application/pdf" : f.type || "image/jpeg";
      if (isImg) {
        body = await shrink(f, 2000, 0.85);
        if (body !== f) type = "image/jpeg";
      }
      if (body.size > 15 * 1024 * 1024) {
        setError(`${f.name} is over 15 MB.`);
        continue;
      }
      const ext = isPdf ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : type.includes("hei") ? "heic" : "jpg";
      const path = `${uid}/${day.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("receipts").upload(path, body, { contentType: type, upsert: false });
      if (up.error) {
        setError(`${f.name}: couldn't upload (${up.error.message}).`);
        continue;
      }
      added.push({ path, preview: isPdf ? null : URL.createObjectURL(body), pdf: isPdf });
    }
    if (!added.length) return setBusy(null);
    setPhotos((p) => [...p, ...added]);
    setLost(false);
    if (!aiReady) return setBusy(null);
    setBusy("read");
    const res = await readReceipt(added.map((a) => a.path));
    setBusy(null);
    if (res.ok) {
      setAi({ ...res.read, cents: res.cents });
      apply(res.read);
    } else setError(res.error);
  };

  const cat = category || "Other";
  const amt = Number(amount);
  // Split: every line but the first is typed; the first is whatever's left of the total.
  const others = (split ?? []).slice(1).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const rest = Math.round(((Number.isFinite(amt) ? amt : 0) - others) * 100) / 100;
  const cats = new Set(split ? split.map((l) => l.category).filter(Boolean) : [cat]);
  const wantsPeople = [...cats].some((c) => PEOPLE_CATS.has(c));
  const wantsCustomer = [...cats].some((c) => CUSTOMER_HINT.has(c));
  const buying = cats.has(INVENTORY);
  const distributor = Boolean(cust.id && customers.find((c) => c[0] === cust.id)?.[4]);
  const off = charge && amount && Number.isFinite(amt) ? Math.round((charge.amount - amt) * 100) / 100 : 0;

  const save = async () => {
    setError(null);
    if (!split && !category) return setError("Pick a category.");
    if (split) {
      if (split.some((l) => !l.category)) return setError("Pick a category for every line.");
      if (split.slice(1).some((l) => !(Number(l.amount) > 0))) return setError("Type the amount for every line.");
      if (!(rest > 0)) return setError(`The lines add up to more than the total (${money(amt || 0)}). Check the amounts.`);
    }
    if (distributor && !ends.some((c) => c.name.trim() || c.business.trim())) return setError(`${cust.name} is a distributor partner: add the customer(s) of theirs you saw.`);
    if (buying) {
      if (!buy.branch) return setError("Inventory: pick the warehouse it's for.");
      if (!buy.lines.length) return setError("Inventory: add the items you bought.");
      if (buy.lines.some((l) => !(Number(l.qty) > 0))) return setError("Inventory: type how many of each item.");
      if (!buy.mode) return setError("Inventory: tap Picked up, or It's being shipped.");
      if (buy.mode === "shipped" && !buy.expected) return setError("Inventory: pick the day it should get there.");
    }
    if (!lost && !photos.length) return setError("Add a photo of the receipt (or tap Lost receipt).");
    if (lost && !reason.trim()) return setError("Say why there's no receipt.");
    if (wantsCustomer && !cust.name.trim() && !noCustomer) return setError('Which customer was it for? Pick one, or tap "Not for a customer".');
    setBusy("save");
    const res = await saveReceipt({
      id: r?.id ?? null,
      bought_on: day,
      vendor,
      amount,
      tip: wantsPeople ? tip : null,
      category: split ? split[0].category : cat,
      lines: split ? split.map((l, i) => ({ category: l.category, amount: i === 0 ? rest : Number(l.amount) })) : null,
      end_customers: distributor ? ends : null,
      inventory:
        buying && buyDone?.status !== "received"
          ? { branch: buy.branch, mode: buy.mode as "picked_up" | "shipped", expected: buy.mode === "shipped" ? buy.expected : null, lines: buy.lines.map((l) => ({ product_id: l.id, qty: l.qty, lot_no: l.lot_no || null })) }
          : null,
      paid_with: paid,
      card_last4: card,
      company_id: noCustomer ? null : cust.id,
      customer_name: noCustomer ? null : cust.name,
      purpose,
      attendees: wantsPeople ? people : null,
      notes,
      photos: lost ? [] : photos.map((p) => p.path),
      no_photo_reason: lost ? reason : null,
      ai: ai ? { ...ai, at: new Date().toISOString() } : undefined,
      charge_id: charge?.id ?? null,
    });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setSaved({ month: res.month, matched: res.matched, inventory: res.inventory ?? null, warn: res.warn ?? null });
    router.refresh();
  };

  const remove = async () => {
    if (!r) return;
    if (!sure) return setSure(true);
    setBusy("delete");
    const res = await deleteReceipt(r.id);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    router.push(backHref ?? `/expenses?m=${r.bought_on.slice(0, 7)}`);
    router.refresh();
  };

  if (saved) {
    return (
      <section className="card col xr-done" style={{ gap: 14, alignItems: "center", textAlign: "center" }}>
        <CircleCheck size={44} style={{ color: "var(--ok)" }} />
        <div className="col" style={{ gap: 4 }}>
          <b style={{ fontSize: 20 }}>Receipt saved</b>
          {saved.matched ? (
            <span className="small muted">
              Matched to the card charge on {dateShort(saved.matched.day)}: {saved.matched.label} {money(saved.matched.amount)}.
            </span>
          ) : paid === "card" ? (
            <span className="small muted">It&apos;ll be matched to the card charge when the Chase statement comes in.</span>
          ) : (
            <span className="small muted">Marked paid with your own money, so it&apos;s paid back to you.</span>
          )}
          {saved.inventory ? (
            <span className="small" style={{ marginTop: 6 }}>
              <b>Inventory: </b>
              {saved.inventory.status === "received"
                ? `added to ${saved.inventory.branch}'s stock.`
                : saved.inventory.status === "expected"
                  ? `on ${saved.inventory.branch}'s expected deliveries. The warehouse receives it when it arrives.`
                  : `sent to an admin to approve (Receiving Report #${saved.inventory.id}). It goes into ${saved.inventory.branch}'s stock once it's approved.`}
            </span>
          ) : null}
        </div>
        {saved.warn ? (
          <div className="alert warn small" role="alert" style={{ textAlign: "left" }}>
            <CircleAlert size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>{saved.warn}</span>
          </div>
        ) : null}
        <div className="row wrap" style={{ gap: 10, justifyContent: "center" }}>
          {r || charge ? null : (
            <a className="btn sm" href="/expenses/add">
              <Camera size={15} /> Add another
            </a>
          )}
          <Link className="btn sm dark" href={backHref ?? `/expenses?m=${saved.month}`}>
            {backHref ? "Back to the review" : "Back to expenses"}
          </Link>
        </div>
      </section>
    );
  }

  if (readOnly) return <div className="alert info small">{readOnly}</div>;

  return (
    <div className="col xr" style={{ gap: 16 }}>
      {matched ? (
        <div className="xr-charge">
          <span className="tiny faint">MATCHED TO THIS CARD CHARGE</span>
          <div className="row between" style={{ gap: 10 }}>
            <b className="ellipsis">{matched.label}</b>
            <b className="nowrap">{money(matched.amount)}</b>
          </div>
          <div className="row between" style={{ gap: 10 }}>
            <span className="tiny muted">
              {dateShort(matched.txn_date)}
              {matched.card ? ` · card ••${matched.card}` : ""}
            </span>
            <UnlinkButton chargeId={matched.id} />
          </div>
        </div>
      ) : null}
      {charge ? (
        <div className="xr-charge">
          <span className="tiny faint">FOR THIS CARD CHARGE</span>
          <div className="row between" style={{ gap: 10 }}>
            <b className="ellipsis">{charge.label}</b>
            <b className="nowrap">{money(charge.amount)}</b>
          </div>
          <span className="tiny muted">
            {dateShort(charge.txn_date)}
            {charge.card ? ` · card ••${charge.card}` : ""}
          </span>
        </div>
      ) : null}

      {lost ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="row between">
            <b>Lost receipt</b>
            <button type="button" className="btn sm dark" onClick={() => setLost(false)}>
              <Camera size={15} /> I have it
            </button>
          </div>
          <label className="field">
            <span className="label">Why there&apos;s no receipt</span>
            <textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lost it on the road / the pump didn't print one / online order, no receipt…" />
          </label>
          <span className="tiny muted">An approver sees this. Try to get a copy from the store or the email receipt when you can.</span>
        </section>
      ) : (
        <section className="xr-photos">
          {photos.length ? (
            <div className="xr-thumbs">
              {photos.map((p) => (
                <div key={p.path} className="xr-thumb">
                  {p.preview ? <img src={p.preview} alt="Receipt" /> : <span className="xr-pdf"><FileText size={22} /> PDF</span>}
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x.path !== p.path))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="xr-thumb add" onClick={() => camRef.current?.click()} disabled={Boolean(busy)}>
                <ImagePlus size={20} />
                <span className="tiny">Another page</span>
              </button>
            </div>
          ) : (
            <div className="xr-snap">
              <button type="button" className="xr-cam" onClick={() => camRef.current?.click()} disabled={Boolean(busy)}>
                <Camera size={26} strokeWidth={2.2} />
                <b>Take a photo of the receipt</b>
                <span className="tiny">{aiReady ? "AMBIT Intelligence reads it and fills in the rest" : "Then fill in the details"}</span>
              </button>
              <div className="row" style={{ gap: 8, justifyContent: "center" }}>
                <button type="button" className="btn sm dark" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
                  <ImagePlus size={15} /> Choose a photo or PDF
                </button>
                <button type="button" className="btn sm dark" onClick={() => setLost(true)}>
                  Lost receipt
                </button>
              </div>
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
          {busy === "upload" || busy === "read" ? (
            <div className="xr-reading">
              <LoaderCircle size={16} className="spin" /> {busy === "upload" ? "Saving the photo…" : "Reading the receipt…"}
            </div>
          ) : ai ? (
            <div className="xr-ai">
              <Sparkles size={14} />
              <span>
                Filled in from the photo. Check the date and total.
                {ai.note ? ` ${ai.note}` : ""}
              </span>
            </div>
          ) : null}
          {ai?.tip_blank && !tip ? (
            <div className="alert warn small" style={{ margin: 0 }}>
              <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />
              <span>The tip line on this receipt is blank. If you added a tip, type the total you actually paid (with the tip), or the tip below.</span>
            </div>
          ) : null}
        </section>
      )}

      <section className="card col" style={{ gap: 14 }}>
        <div className="grid2">
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" value={day} max={today} onChange={(e) => (mark("day"), setDay(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">Total paid</span>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => (mark("amount"), setAmount(e.target.value.replace(/[^\d.]/g, "")))}
              placeholder="0.00"
            />
          </label>
        </div>
        {charge && off && Math.abs(off) >= 0.01 ? (
          <span className="tiny warn-text" style={{ marginTop: -6 }}>
            The card was charged {money(charge.amount)}, {off > 0 ? `${money(off)} more` : `${money(-off)} less`} than this total.{off > 0 && wantsPeople ? " A tip added after the receipt is fine." : ""}
          </span>
        ) : null}
        <label className="field">
          <span className="label">Where</span>
          <input className="input" value={vendor} onChange={(e) => (mark("vendor"), setVendor(e.target.value))} placeholder="Store, restaurant, hotel…" />
        </label>

        {split ? (
          <div className="field">
            <span className="label">Lines on this receipt</span>
            <div className="xr-split">
              {split.map((l, i) => (
                <div key={i} className="xr-line">
                  <select
                    className="select sm grow"
                    value={l.category}
                    aria-label={`Category for line ${i + 1}`}
                    onChange={(e) => (mark("category"), setSplit(split.map((x, k) => (k === i ? { ...x, category: e.target.value } : x))))}
                  >
                    <option value="" disabled>Category…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {i === 0 ? (
                    <span className={`xr-rest${rest > 0 ? "" : " bad"}`} title="The rest of the total">{amount ? money(rest) : "the rest"}</span>
                  ) : (
                    <input
                      className="input sm"
                      inputMode="decimal"
                      style={{ width: 96 }}
                      value={l.amount}
                      placeholder="0.00"
                      aria-label={`Amount for line ${i + 1}`}
                      onChange={(e) => setSplit(split.map((x, k) => (k === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                    />
                  )}
                  {i > 0 ? (
                    <button type="button" className="iconbtn sm" aria-label={`Remove line ${i + 1}`} onClick={() => setSplit(split.length > 2 ? split.filter((_, k) => k !== i) : null)}>
                      <X size={15} />
                    </button>
                  ) : (
                    <span style={{ width: 32 }} />
                  )}
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="chip sm" onClick={() => setSplit([...split, { category: "", amount: "" }])}>
                <Plus size={14} /> Add a line
              </button>
              <button type="button" className="chip sm" onClick={() => (setCategory(split[0].category || category), setSplit(null))}>
                Back to one category
              </button>
            </div>
            <span className="tiny muted">The first line is whatever&apos;s left of the total. Each line counts in its own category.</span>
          </div>
        ) : (
          <div className="field">
            <span className="label">Category</span>
            <div className="xr-cats">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className={`chip sm${category === c ? " on" : ""}`} onClick={() => (mark("category"), setCategory(c))}>
                  {c}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="xr-split-btn"
              onClick={() => (mark("category"), setSplit([{ category: category || "", amount: "" }, { category: "", amount: "" }]))}
            >
              <SplitSquareHorizontal size={15} /> More than one kind on this receipt? (like fuel and lunch) Split it
            </button>
          </div>
        )}

        <CustomerField
          customers={customers}
          value={cust}
          none={noCustomer}
          hint={wantsCustomer}
          onChange={(v) => {
            setCust(v);
            setNoCustomer(false);
          }}
          onNone={() => {
            setNoCustomer(true);
            setCust({ id: null, name: "" });
          }}
        />

        {distributor ? (
          <div className="field xr-ends">
            <span className="label">{cust.name} is a distributor partner: which of their customers did you see?</span>
            {ends.map((c, i) => (
              <div key={i} className="xr-end">
                <input className="input sm" value={c.name} placeholder="Name" aria-label={`Customer ${i + 1} name`} onChange={(e) => setEnds(ends.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input sm" value={c.business} placeholder="Business name" aria-label={`Customer ${i + 1} business`} onChange={(e) => setEnds(ends.map((x, k) => (k === i ? { ...x, business: e.target.value } : x)))} />
                <input className="input sm" value={c.phone} placeholder="Phone" inputMode="tel" aria-label={`Customer ${i + 1} phone`} onChange={(e) => setEnds(ends.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} />
                {ends.length > 1 ? (
                  <button type="button" className="iconbtn sm" aria-label={`Remove customer ${i + 1}`} onClick={() => setEnds(ends.filter((_, k) => k !== i))}>
                    <X size={15} />
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" className="chip sm" style={{ alignSelf: "flex-start" }} onClick={() => setEnds([...ends, { name: "", business: "", phone: "" }])}>
              <Plus size={14} /> Add another of their customers
            </button>
          </div>
        ) : null}

        {wantsPeople ? (
          <div className="grid2 xr-people">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Who was there</span>
              <input className="input" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="Names (and their company)" />
            </label>
            <label className="field">
              <span className="label">Tip (if not on the receipt)</span>
              <input className="input" inputMode="decimal" value={tip} onChange={(e) => (mark("tip"), setTip(e.target.value.replace(/[^\d.]/g, "")))} placeholder="0.00" />
            </label>
          </div>
        ) : null}

        <label className="field">
          <span className="label">What it was for</span>
          <input className="input" value={purpose} onChange={(e) => (mark("purpose"), setPurpose(e.target.value))} placeholder="Rig service call, startup, lunch meeting…" />
        </label>

        <div className="field">
          <span className="label">Paid with</span>
          <div className="seg">
            <button type="button" className={paid === "card" ? "on" : ""} onClick={() => setPaid("card")}>
              AMBIT card
            </button>
            <button type="button" className={paid === "personal" ? "on" : ""} onClick={() => setPaid("personal")}>
              My own money
            </button>
          </div>
          {paid === "card" ? (
            <label className="row tiny muted" style={{ gap: 8 }}>
              Card ending in
              <input className="input sm" style={{ width: 90 }} inputMode="numeric" maxLength={4} value={card} onChange={(e) => (mark("card"), setCard(e.target.value.replace(/\D/g, "").slice(0, 4)))} placeholder="1234" />
            </label>
          ) : (
            <span className="tiny muted">It&apos;s added to what AMBIT pays back to you.</span>
          )}
        </div>

        <label className="field">
          <span className="label">Notes (optional)</span>
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </section>

      {buying ? <BuyInventory warehouses={warehouses} value={buy} onChange={setBuy} done={buyDone} today={today} /> : null}

      {error ? (
        <div className="alert err small" role="alert">
          <CircleAlert size={17} style={{ flex: "none", marginTop: 1 }} />
          <span>{error}</span>
        </div>
      ) : null}

      <button type="button" className="btn block" onClick={save} disabled={Boolean(busy)}>
        {busy === "save" ? <LoaderCircle size={17} className="spin" /> : null} {r ? "Save changes" : "Save receipt"}
      </button>
      {r ? (
        <button type="button" className={`btn sm ${sure ? "" : "dark"}`} onClick={remove} disabled={Boolean(busy)} style={{ alignSelf: "center" }}>
          <Trash2 size={15} /> {sure ? "Yes, delete this receipt" : "Delete receipt"}
        </button>
      ) : null}
    </div>
  );
}

/** Type a few letters of the customer; pick one from the list, or keep what you typed. */
function CustomerField({
  customers,
  value,
  none,
  hint,
  onChange,
  onNone,
}: {
  customers: MiniCustomer[];
  value: { id: string | null; name: string };
  none: boolean;
  hint: boolean;
  onChange: (v: { id: string | null; name: string }) => void;
  onNone: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return customers
      .filter((c) => {
        const hay = `${c[1]} ${c[2] ?? ""} ${c[3] ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => Number(!a[1].toLowerCase().startsWith(words[0])) - Number(!b[1].toLowerCase().startsWith(words[0])) || a[1].localeCompare(b[1]))
      .slice(0, 8);
  }, [customers, q]);

  if (value.name && !open) {
    return (
      <div className="field">
        <span className="label">Customer</span>
        <div className="xr-cust-on">
          <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
            <b className="ellipsis">{value.name}</b>
            <span className="tiny muted">{value.id ? "From the customer list" : "Typed in (not in the customer list)"}</span>
          </span>
          <button type="button" className="iconbtn sm" aria-label="Change customer" onClick={() => (setQ(value.name), setOpen(true), onChange({ id: null, name: "" }))}>
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="field xr-custf">
      <span className="label">Customer{hint ? "" : " (if it was for one)"}</span>
      <div className="xr-search">
        <Search size={16} />
        <input
          className="input"
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          placeholder={none ? "Not for a customer" : "Type the customer's name"}
          autoComplete="off"
        />
      </div>
      {open && q.trim() ? (
        <div className="xr-results" role="listbox">
          {shown.map((c) => (
            <button key={c[0]} type="button" role="option" aria-selected={false} onClick={() => (onChange({ id: c[0], name: c[1] }), setQ(""), setOpen(false))}>
              <b className="ellipsis">{c[1]}</b>
              <span className="tiny muted">{[c[2], c[3]].filter(Boolean).join(", ")}</span>
            </button>
          ))}
          <button type="button" className="typed" onClick={() => (onChange({ id: null, name: q.trim() }), setQ(""), setOpen(false))}>
            Use &quot;{q.trim()}&quot;{shown.length ? " (not one of these)" : " (not in the customer list)"}
          </button>
        </div>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={`chip sm${none ? " on2" : ""}`} onClick={onNone}>
          Not for a customer
        </button>
        {hint && !none ? <span className="tiny muted">Meals, fuel, hotels and travel for a customer visit: pick the customer.</span> : null}
      </div>
    </div>
  );
}
