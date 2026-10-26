"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CircleAlert, ExternalLink, LoaderCircle, Plus, Search, Trash2, X } from "lucide-react";
import { CustomerPicker } from "@/components/customer-picker";
import { TopBar } from "@/components/ui";
import { discardDraft, saveDraft } from "@/app/(app)/order/intake/actions";
import type { OrderCustomer } from "@/lib/customers";
import type { DraftItem, CustomerMatch } from "@/lib/intake/read";
import type { Branch } from "@/lib/types";

export type PickProduct = { id: string; sku: string; name: string; unit: string; sqft_per_unit: number | null };
export type DraftView = {
  id: string;
  status: string;
  source_text: string | null;
  photos: string[];
  customer_text: string | null;
  company_id: string | null;
  branch_id: string | null;
  delivery_method: string | null;
  ship_address: string | null;
  po_number: string | null;
  needed_by: string | null;
  notes: string | null;
  items: DraftItem[];
  questions: string | null;
  order_id: string | null;
  created_by_name: string | null;
  created_at: string;
};

const CONF: Record<string, { label: string; cls: string }> = {
  high: { label: "Sure", cls: "pill ok" },
  medium: { label: "Check", cls: "pill warn" },
  low: { label: "Not matched", cls: "pill" },
};

function ProductPick({ products, value, onChange }: { products: PickProduct[]; value: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = products.find((p) => p.id === value) ?? null;
  const shown = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return products.filter((p) => w.every((x) => `${p.name} ${p.sku}`.toLowerCase().includes(x))).slice(0, 12);
  }, [products, q]);
  if (!open) {
    return (
      <button type="button" className={`pick-btn${cur ? "" : " empty"}`} onClick={() => setOpen(true)}>
        {cur ? (
          <>
            <b>{cur.name}</b>
            <small>{cur.sku} · per {cur.unit}</small>
          </>
        ) : (
          <b>Pick the AMBIT product…</b>
        )}
      </button>
    );
  }
  return (
    <div className="pick-open">
      <div className="row" style={{ gap: 6 }}>
        <div className="search grow">
          <Search size={16} />
          <input className="input sm" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type part of the name or SKU" aria-label="Find a product" />
        </div>
        <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="pick-list">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onChange(p.id);
              setOpen(false);
              setQ("");
            }}
          >
            <b>{p.name}</b>
            <small>{p.sku} · per {p.unit}</small>
          </button>
        ))}
        {!shown.length ? <span className="tiny faint" style={{ padding: 8 }}>Nothing matches.</span> : null}
      </div>
    </div>
  );
}

export function DraftReview({
  draft,
  products,
  companies,
  branches,
  suggestions,
}: {
  draft: DraftView;
  products: PickProduct[];
  companies: OrderCustomer[];
  branches: Branch[];
  suggestions: CustomerMatch[];
}) {
  const router = useRouter();
  const [customerList, setCustomerList] = useState(companies);
  const [companyId, setCompanyId] = useState(draft.company_id ?? "");
  const [branchId, setBranchId] = useState(draft.branch_id ?? "");
  const [delivery, setDelivery] = useState(draft.delivery_method ?? "pickup");
  const [address, setAddress] = useState(draft.ship_address ?? "");
  const [po, setPo] = useState(draft.po_number ?? "");
  const [neededBy, setNeededBy] = useState(draft.needed_by ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(draft.items.length ? draft.items : [{ raw: "", product_id: null, qty: 1, confidence: "low" }]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = draft.status === "sent";

  const setItem = (i: number, patch: Partial<DraftItem>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const payload = () => ({
    id: draft.id,
    company_id: companyId || null,
    branch_id: delivery === "dropship" ? null : branchId || null,
    delivery_method: delivery,
    ship_address: address || null,
    po_number: po || null,
    needed_by: neededBy || null,
    notes: notes || null,
    items,
  });
  const ready = items.filter((i) => i.product_id && i.qty > 0);
  const unmatched = items.filter((i) => !i.product_id && i.raw.trim());

  const open = () => {
    setError(null);
    if (!companyId) return setError("Pick the customer first.");
    if (delivery !== "dropship" && !branchId) return setError("Pick the AMBIT location.");
    if (!ready.length) return setError("Match at least one line to an AMBIT product.");
    start(async () => {
      const r = await saveDraft(payload(), true);
      if (r.error) return setError(r.error);
      router.push(`/order?draft=${draft.id}`);
    });
  };

  return (
    <main className="shell wide">
      <TopBar title="Check the order" back="/order/intake" />

      {done ? (
        <div className="alert ok small">
          This draft became an order.{draft.order_id ? <> <Link href={`/orders/${draft.order_id}`}>Open the order</Link>.</> : null}
        </div>
      ) : null}
      {draft.questions ? (
        <div className="alert warn small">
          <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
          <span><b>Ask the customer:</b> {draft.questions}</span>
        </div>
      ) : null}

      <div className="intake-grid">
        <section className="card col" style={{ gap: 10 }}>
          <div className="eyebrow">What they sent</div>
          {draft.source_text ? <div className="intake-src">{draft.source_text}</div> : null}
          {draft.photos.length ? (
            <div className="photo-row">
              {draft.photos.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="photo-thumb lg">
                  <img src={u} alt={`Order photo ${i + 1}`} />
                </a>
              ))}
            </div>
          ) : null}
          <span className="tiny faint">Read by AMBIT A.I. for {draft.created_by_name ?? "staff"}</span>
        </section>

        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <section className="card col" style={{ gap: 12 }}>
            <div className="eyebrow">Customer</div>
            {draft.customer_text ? <span className="small muted">The order says: <b>{draft.customer_text}</b></span> : null}
            {suggestions.length ? (
              <div className="chips wrap">
                {suggestions.map((m) => (
                  <button key={m.id} type="button" className={`chip sm${companyId === m.id ? " on" : ""}`} onClick={() => setCompanyId(m.id)}>
                    {m.name} · {Math.round(m.score * 100)}%
                  </button>
                ))}
              </div>
            ) : null}
            <CustomerPicker
              customers={customerList}
              value={companyId}
              onChange={(id) => {
                setCompanyId(id);
                const c = customerList.find((x) => x.id === id);
                if (c?.default_branch_id && !branchId) setBranchId(c.default_branch_id);
              }}
              onAdded={(c) => {
                setCustomerList((l) => [...l, c]);
                setCompanyId(c.id);
              }}
              branches={branches}
              defaultBranch={branchId || undefined}
            />
          </section>

          <section className="card col" style={{ gap: 12 }}>
            <div className="eyebrow">Delivery</div>
            <div className="seg" role="radiogroup" aria-label="Delivery">
              {[
                ["pickup", "Pickup"],
                ["jobsite", "Job site"],
                ["dropship", "Drop ship"],
              ].map(([k, l]) => (
                <button key={k} type="button" className={delivery === k ? "on" : ""} onClick={() => setDelivery(k)} aria-pressed={delivery === k}>
                  {l}
                </button>
              ))}
            </div>
            {delivery !== "dropship" ? (
              <label className="field">
                <span className="label">AMBIT location</span>
                <select className="select sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">Pick one</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}, {b.state}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {delivery !== "pickup" ? (
              <label className="field">
                <span className="label">Ship to</span>
                <input className="input sm" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Uses the address on file if blank" />
              </label>
            ) : null}
            <div className="grid2">
              <label className="field">
                <span className="label">Needed by</span>
                <input className="input sm" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">Customer PO</span>
                <input className="input sm" value={po} onChange={(e) => setPo(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span className="label">Notes for AMBIT</span>
              <input className="input sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="row between">
          <div className="eyebrow">Items ({ready.length} matched{unmatched.length ? `, ${unmatched.length} not matched` : ""})</div>
        </div>
        <div className="intake-lines">
          {items.map((it, i) => (
            <div key={i} className={`intake-line${it.product_id ? "" : " miss"}`}>
              <div className="intake-raw">
                <span className={(CONF[it.product_id ? it.confidence : "low"] ?? CONF.low).cls}>{(CONF[it.product_id ? it.confidence : "low"] ?? CONF.low).label}</span>
                <span className="small">{it.raw || <i className="faint">Added by hand</i>}</span>
              </div>
              {it.note ? <div className="tiny" style={{ color: "var(--warn-text)" }}>{it.note}</div> : null}
              <div className="intake-pick">
                <ProductPick products={products} value={it.product_id} onChange={(id) => setItem(i, { product_id: id, confidence: id ? "high" : "low" })} />
                <input
                  className="input sm qty"
                  type="number"
                  min={0}
                  step="any"
                  value={Number.isFinite(it.qty) ? it.qty : 0}
                  onChange={(e) => setItem(i, { qty: Number(e.target.value) })}
                  aria-label="Quantity"
                />
                <button type="button" className="iconbtn" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label="Remove line">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn sm dark" onClick={() => setItems((l) => [...l, { raw: "", product_id: null, qty: 1, confidence: "low" }])} style={{ alignSelf: "flex-start", gap: 8 }}>
          <Plus size={16} /> Add a line
        </button>
      </section>

      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      {saved ? <div className="alert ok small" role="status">{saved}</div> : null}

      {!done ? (
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={open} disabled={pending} style={{ gap: 10 }}>
            {pending ? <LoaderCircle size={18} className="spin" /> : <ExternalLink size={18} />} Open in Order to finish
          </button>
          <button
            type="button"
            className="btn dark"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveDraft(payload());
                setSaved(r.ok ? "Draft saved. Find it under AI order intake." : null);
                setError(r.error ?? null);
              })
            }
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await discardDraft(draft.id);
                router.push("/order/intake");
              })
            }
          >
            Discard
          </button>
        </div>
      ) : null}
      <p className="tiny faint" style={{ margin: 0 }}>
        Unmatched lines don&apos;t go on the order. On the Order screen you review everything again before it&apos;s sent.
      </p>
    </main>
  );
}
