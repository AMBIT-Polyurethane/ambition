"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CircleAlert, Minus, Plus, Search, Trash2, X } from "lucide-react";
import { Icon, categoryIcon } from "@/components/icons";
import { readCart, writeCart, type Cart } from "@/lib/cart";
import { money } from "@/lib/format";
import { placeOrder } from "@/app/(app)/order/actions";
import type { Branch, Category, Company } from "@/lib/types";

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  unit: string;
  image_url: string | null;
  list_price: number | null;
  cp: boolean; // "Based on customer pricing"
};

type Props = {
  products: CatalogProduct[];
  categories: Category[];
  branches: Branch[];
  companies: Pick<Company, "id" | "name" | "account_no" | "default_branch_id">[] | null;
  isEmployee: boolean;
  me: { name: string; email: string; company: { name: string; account_no: string | null } | null; defaultBranch: string | null };
  reorder: Cart | null;
  reorderNo: number | null;
  reorderCompany: string | null;
};

function PriceLine({ p }: { p: CatalogProduct }) {
  if (p.cp) return <span className="cp-tag">Based on customer pricing</span>;
  if (p.list_price === null) return <div className="price faint">Price confirmed on invoice</div>;
  return <div className="price">{money(p.list_price)} <span className="faint">/ {p.unit}</span></div>;
}

function Stepper({ qty, onChange, label }: { qty: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stepper">
      <button type="button" aria-label={`One less ${label}`} onClick={() => onChange(qty - 1)}>
        {qty <= 1 ? <Trash2 size={16} /> : <Minus size={16} />}
      </button>
      <input
        aria-label={`Quantity of ${label}`}
        inputMode="numeric"
        type="number"
        min={0}
        value={qty}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label={`One more ${label}`} onClick={() => onChange(qty + 1)}>
        <Plus size={16} />
      </button>
    </div>
  );
}

export function OrderBuilder(props: Props) {
  const { products, categories, branches, companies, isEmployee, me } = props;
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [cart, setCart] = useState<Cart>({});
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<"catalog" | "review">("catalog");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState<CatalogProduct | null>(null);

  const [delivery, setDelivery] = useState<"pickup" | "jobsite" | "dropship">("pickup");
  const [branchId, setBranchId] = useState(me.defaultBranch ?? branches[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [po, setPo] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [companyId, setCompanyId] = useState(props.reorderCompany ?? "");
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Load the saved cart (or the order being repeated) once.
  useEffect(() => {
    if (props.reorder) {
      const fresh: Cart = {};
      let missing = 0;
      for (const [id, n] of Object.entries(props.reorder)) {
        if (byId.has(id)) fresh[id] = n;
        else missing++;
      }
      setCart(fresh);
      writeCart(fresh);
      setNotice(
        `Loaded order ORD-${props.reorderNo}. Check the quantities, then review.` +
          (missing ? ` ${missing} item${missing > 1 ? "s are" : " is"} no longer in the catalog.` : ""),
      );
      router.replace("/order");
    } else {
      const saved = readCart();
      const valid: Cart = {};
      for (const [id, n] of Object.entries(saved)) if (byId.has(id) && n > 0) valid[id] = n;
      setCart(valid);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Employees: default the pickup branch to the chosen customer's branch.
  useEffect(() => {
    if (!companies || !companyId) return;
    const c = companies.find((x) => x.id === companyId);
    if (c?.default_branch_id) setBranchId(c.default_branch_id);
  }, [companyId, companies]);

  const setQty = (id: string, n: number) => {
    const next = { ...cart, [id]: Math.max(0, n) };
    if (next[id] === 0) delete next[id];
    setCart(next);
    writeCart(next);
  };

  const lines = Object.entries(cart)
    .filter(([id, n]) => n > 0 && byId.has(id))
    .map(([id, n]) => ({ p: byId.get(id)!, qty: n }));
  const lineCount = lines.length;
  const subtotal = lines.reduce((s, l) => s + (!l.p.cp && l.p.list_price !== null ? l.p.list_price * l.qty : 0), 0);
  const hasCp = lines.some((l) => l.p.cp);
  const hasTbd = lines.some((l) => !l.p.cp && l.p.list_price === null);

  const needle = q.trim().toLowerCase();
  const shown = products.filter(
    (p) =>
      (cat === "all" || p.category_id === cat) &&
      (!needle || `${p.name} ${p.sku} ${p.description ?? ""}`.toLowerCase().includes(needle)),
  );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await placeOrder({
        items: cart,
        delivery,
        branchId,
        address,
        po,
        neededBy,
        notes,
        companyId: isEmployee ? companyId : "",
        customerName,
      });
      if (res.ok) {
        writeCart({});
        router.push(`/orders/${res.id}?sent=1`);
      } else {
        setError(res.error);
      }
    });
  };

  const thumb = (p: CatalogProduct, size?: "sm") =>
    p.image_url ? (
      <button type="button" className="thumb-btn" onClick={() => setZoom(p)} aria-label={`Bigger photo of ${p.name}`}>
        <img className={`thumb${size ? " " + size : ""}`} src={p.image_url} alt="" loading="lazy" />
      </button>
    ) : size ? null : (
      <div className="ic"><Icon name={categoryIcon(p.category_id)} size={22} /></div>
    );

  const lightbox = zoom ? (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={zoom.name} onClick={() => setZoom(null)}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <div>
            <div className="cap">{zoom.name}</div>
            <div className="sub">{zoom.sku}{zoom.description ? ` · ${zoom.description}` : ""}</div>
          </div>
          <button type="button" className="iconbtn" style={{ background: "#f2f2f4", color: "#18181b", border: 0 }} onClick={() => setZoom(null)} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <img src={zoom.image_url ?? ""} alt={zoom.name} />
      </div>
    </div>
  ) : null;

  // ------------------------------------------------------------------ review
  if (step === "review") {
    const forName =
      !isEmployee
        ? me.company?.name ?? ""
        : companyId === "__other"
          ? customerName || "New customer"
          : companies?.find((c) => c.id === companyId)?.name ?? "";
    return (
      <main className="shell">
        <header className="topbar">
          <button type="button" className="iconbtn" aria-label="Back to catalog" onClick={() => setStep("catalog")}>
            <ChevronLeft size={22} />
          </button>
          <h1 className="title" style={{ margin: 0 }}>Review order</h1>
        </header>

        {isEmployee && companies ? (
          <section className="section">
            <label className="field">
              <span className="label">Ordering for</span>
              <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Choose a customer</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.account_no ? ` · ${c.account_no}` : ""}</option>
                ))}
                <option value="__other">Customer not listed…</option>
              </select>
            </label>
            {companyId === "__other" ? (
              <input className="input" placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            ) : null}
          </section>
        ) : (
          <div className="card small">
            <div className="faint tiny" style={{ marginBottom: 4 }}>ORDERING AS</div>
            <b>{me.company?.name ?? "Your company"}</b>
            {me.company?.account_no ? <span className="muted"> · {me.company.account_no}</span> : null}
            <div className="muted">{me.name}</div>
          </div>
        )}

        <section className="section">
          <div className="row between">
            <div className="eyebrow">{lineCount} {lineCount === 1 ? "item" : "items"}</div>
            <button type="button" className="linkbtn" onClick={() => setStep("catalog")}>+ Add items</button>
          </div>
          {lineCount === 0 ? (
            <div className="card muted small">Your order is empty. Go back and add items.</div>
          ) : (
            <div className="list">
              {lines.map(({ p, qty }) => (
                <div key={p.id} className="product">
                  {thumb(p, "sm")}
                  <div className="grow">
                    <div className="name">{p.name}</div>
                    <div className="desc">{p.sku}{p.description ? ` · ${p.description}` : ""}</div>
                    {p.cp ? (
                      <span className="cp-tag">Customer pricing</span>
                    ) : p.list_price !== null ? (
                      <div className="price">{money(p.list_price * qty)} <span className="faint">({money(p.list_price)} / {p.unit})</span></div>
                    ) : (
                      <div className="price faint">Price confirmed on invoice</div>
                    )}
                  </div>
                  <Stepper qty={qty} label={p.name} onChange={(n) => setQty(p.id, n)} />
                </div>
              ))}
              <div className="row between" style={{ padding: "14px 16px" }}>
                <span className="muted small">Estimated list-price subtotal</span>
                <b>{money(subtotal)}</b>
              </div>
            </div>
          )}
          <p className="tiny faint" style={{ margin: 0 }}>
            {hasCp ? "Spray foam and fiberglass are priced to your account. " : ""}
            {hasTbd ? "Some items are priced when AMBIT confirms the order. " : ""}
            Final pricing, tax and freight are confirmed by AMBIT on your invoice.
          </p>
        </section>

        <section className="section">
          <div className="eyebrow">Delivery</div>
          <div className="seg" role="radiogroup" aria-label="Delivery method">
            {([
              ["pickup", "Branch pickup"],
              ["jobsite", "Job site"],
              ["dropship", "Drop ship"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={delivery === id} className={delivery === id ? "on" : ""} onClick={() => setDelivery(id)}>
                {label}
              </button>
            ))}
          </div>
          {delivery === "pickup" ? (
            <div className="chips" role="radiogroup" aria-label="Pickup branch" style={{ flexWrap: "wrap" }}>
              {branches.map((b) => (
                <button key={b.id} type="button" role="radio" aria-checked={branchId === b.id} className={`chip${branchId === b.id ? " on" : ""}`} onClick={() => setBranchId(b.id)}>
                  {b.name}, {b.state}
                </button>
              ))}
            </div>
          ) : (
            <label className="field">
              <span className="label">{delivery === "jobsite" ? "Job site address" : "Ship-to address"}</span>
              <textarea className="textarea" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state, ZIP. Add a site contact if helpful." />
            </label>
          )}
        </section>

        <section className="section">
          <div className="grid2">
            <label className="field">
              <span className="label">PO number</span>
              <input className="input" value={po} onChange={(e) => setPo(e.target.value)} placeholder="Optional" />
            </label>
            <label className="field">
              <span className="label">Needed by</span>
              <input className="input" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="label">Notes for AMBIT</span>
            <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery window, job name, anything we should know" />
          </label>
        </section>

        {error ? (
          <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div>
        ) : null}

        <div className="col" style={{ gap: 8 }}>
          <button type="button" className="btn block" disabled={pending || lineCount === 0} onClick={submit}>
            {pending ? "Sending…" : "Send order to AMBIT"}
          </button>
          <p className="tiny faint center" style={{ margin: 0 }}>
            Goes to orders@ambitpu.com{forName ? ` for ${forName}` : ""}. A copy goes to {me.email}.
          </p>
        </div>
        {lightbox}
      </main>
    );
  }

  // ----------------------------------------------------------------- catalog
  return (
    <main className="shell" style={{ paddingBottom: "calc(var(--tabbar) + env(safe-area-inset-bottom) + 100px)" }}>
      <div className="sticky-top">
        <div className="topbar">
          <h1 className="title" style={{ margin: 0 }}>{isEmployee ? "Order for a customer" : "Place an order"}</h1>
        </div>
        <div className="search">
          <Search size={18} />
          <input className="input" type="search" placeholder="Search products or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        <div className="chips" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={cat === "all"} className={`chip${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>All</button>
          {categories.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={`chip${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {notice ? <div className="alert info">{notice}</div> : null}

      {shown.length === 0 ? (
        <div className="card muted small center">{products.length === 0 ? "The catalog is empty. An admin can import products in Admin → Products." : "No products match your search."}</div>
      ) : (
        <div className="list">
          {shown.map((p) => {
            const qty = cart[p.id] ?? 0;
            return (
              <div key={p.id} className="product">
                {thumb(p)}
                <div className="grow">
                  <div className="name">{p.name}</div>
                  <div className="desc">{p.description ? p.description : p.sku}</div>
                  <PriceLine p={p} />
                </div>
                {qty > 0 ? (
                  <Stepper qty={qty} label={p.name} onChange={(n) => setQty(p.id, n)} />
                ) : (
                  <button type="button" className="add" onClick={() => setQty(p.id, 1)} aria-label={`Add ${p.name}`}>ADD</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loaded && lineCount > 0 ? (
        <div className="cartbar">
          <div className="inner">
            <button type="button" className="btn" onClick={() => { setStep("review"); window.scrollTo(0, 0); }}>
              <span className="count">{lineCount} {lineCount === 1 ? "item" : "items"}</span>
              <span>Review order</span>
              <span style={{ minWidth: 60, textAlign: "right", letterSpacing: 0 }}>{subtotal > 0 ? money(subtotal) : ""}</span>
            </button>
          </div>
        </div>
      ) : null}
      {lightbox}
    </main>
  );
}
