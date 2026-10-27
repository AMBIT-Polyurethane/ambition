"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, CircleAlert, ClipboardPaste, Filter, MapPin, Minus, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { Icon, categoryIcon } from "@/components/icons";
import { readCart, writeCart, readOrderBranch, writeOrderBranch, type Cart } from "@/lib/cart";
import { money } from "@/lib/format";
import { customerDetails, placeOrder } from "@/app/(app)/order/actions";
import { CustomerPicker } from "@/components/customer-picker";
import { addressOnFile, type OrderCustomer } from "@/lib/customers";
import { bagsFor, parseSqft, sqftText } from "@/lib/sqft";
import type { Branch, Category } from "@/lib/types";

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  unit: string;
  image_url: string | null;
  list_price: number | null; // the price charged (the sale price while a sale runs)
  was?: number | null; // on sale: the regular price, crossed out
  sale?: boolean;
  cp: boolean; // "Based on customer pricing"
  sqft: number | null; // batts: square feet per bag (order by bags or by square feet)
};

/** Live stock at a location (only locations with an inventory spreadsheet). Contractors get the label only. */
export type StockInfo = { on_hand: number | null; pending: number | null; net: number | null; label: "in" | "low" | "out" | null };
export type StockMap = Record<string, Record<string, StockInfo>>;

const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

function StockTag({ s, staff }: { s: StockInfo | undefined; staff: boolean }) {
  if (!s) return null;
  if (staff) {
    if (s.on_hand === null || s.net === null) return <div className="stock-tag none">Not counted yet</div>;
    return (
      <div className={`stock-tag ${s.label ?? "none"}`} title={`${qtyText(s.on_hand)} in stock, ${qtyText(s.pending ?? 0)} reserved`}>
        {s.net > 0 ? `${qtyText(s.net)} available` : "None available"}
        {s.pending ? <span className="faint"> · {qtyText(s.pending)} reserved</span> : null}
      </div>
    );
  }
  if (!s.label) return null;
  return <div className={`stock-tag ${s.label}`}>{s.label === "in" ? "In stock" : s.label === "low" ? "Low stock" : "Ships from supplier"}</div>;
}

type Props = {
  products: CatalogProduct[];
  categories: Category[];
  branches: Branch[];
  companies: OrderCustomer[] | null;
  isEmployee: boolean;
  /** Staff orders go to the customer to approve before AMBIT orders gets them. */
  approvals: boolean;
  me: {
    name: string;
    email: string;
    company: { name: string; account_no: string | null; ship_address?: string | null; bill_address?: string | null } | null;
    defaultBranch: string | null;
  };
  reorder: Cart | null;
  reorderNo: number | null;
  reorderCompany: string | null;
  /** A draft from AI order intake (or smart reorder), opened to check and send. */
  draft?: OrderDraft | null;
  /** Opens the catalog already searched (the Home banner sends people to one product). */
  initialSearch?: string;
  stock?: StockMap;
};

function PriceLine({ p }: { p: CatalogProduct }) {
  if (p.cp) return <span className="cp-tag">Based on customer pricing</span>;
  if (p.list_price === null) return <div className="price faint">Price confirmed on invoice</div>;
  return (
    <div className="price">
      {p.sale ? <span className="sale-tag">Sale</span> : null}
      {money(p.list_price)} <span className="faint">/ {p.unit}</span>
      {p.was ? <s className="was">{money(p.was)}</s> : null}
    </div>
  );
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

/**
 * Batts: type the square feet the job needs and the bag count fills in (always rounded up to whole bags).
 * Changing the bags with the + / - buttons clears the square feet so the two never disagree.
 */
function SqftBox({ p, qty, onQty }: { p: CatalogProduct; qty: number; onQty: (n: number) => void }) {
  const per = p.sqft ?? 0;
  const [val, setVal] = useState("");
  const entered = parseSqft(val);
  const bags = bagsFor(entered, per);
  useEffect(() => {
    if (val && bags !== qty) setVal("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);
  return (
    <div className="sqft">
      <label className="sqft-in">
        <input
          inputMode="decimal"
          placeholder="Sq ft"
          value={val}
          aria-label={`Square feet of ${p.name}`}
          onChange={(e) => {
            setVal(e.target.value);
            const n = parseSqft(e.target.value);
            if (n > 0) onQty(bagsFor(n, per));
          }}
        />
        <span>sq ft</span>
      </label>
      <span className="sqft-out">
        {entered > 0 ? (
          <>
            = <b>{bags} {bags === 1 ? "bag" : "bags"}</b> <span className="faint">({sqftText(bags * per)} sq ft)</span>
          </>
        ) : (
          <span className="faint">or order by square feet · {sqftText(per)} per bag</span>
        )}
      </span>
    </div>
  );
}

export type OrderDraft = {
  id: string | null;
  source: "intake" | "smart";
  companyId: string | null;
  branchId: string | null;
  delivery: "pickup" | "jobsite" | "dropship" | null;
  address: string | null;
  po: string | null;
  neededBy: string | null;
  notes: string | null;
  items: Cart;
};

export function OrderBuilder(props: Props) {
  const { products, categories, branches, companies, isEmployee, approvals, me } = props;
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [cart, setCart] = useState<Cart>({});
  const [loaded, setLoaded] = useState(false);
  // Staff start by picking the AMBIT location; contractors order from their own region's location.
  // Staff: location, then the customer (their details and, later, their prices come with them), then items.
  const [step, setStep] = useState<"location" | "customer" | "catalog" | "review">(isEmployee ? "location" : "catalog");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState(props.initialSearch ?? "");
  // Staff: show only what's available (in stock, not reserved) at the location, when it has live stock.
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState<CatalogProduct | null>(null);

  const [delivery, setDelivery] = useState<"pickup" | "jobsite" | "dropship">("pickup");
  const [branchId, setBranchId] = useState(isEmployee ? "" : me.defaultBranch ?? branches[0]?.id ?? "");
  const [lastBranch, setLastBranch] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [po, setPo] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [companyId, setCompanyId] = useState(props.draft?.companyId ?? props.reorderCompany ?? "");
  const [draftId] = useState(props.draft?.source === "intake" ? props.draft.id : null);
  const [customerList, setCustomerList] = useState<OrderCustomer[]>(companies ?? []);
  const [autoAddress, setAutoAddress] = useState("");
  const [approvalEmail, setApprovalEmail] = useState("");
  const [autoEmail, setAutoEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Load the saved cart (or the order being repeated) once.
  useEffect(() => {
    if (props.draft) {
      const d = props.draft;
      const fresh: Cart = {};
      let missing = 0;
      for (const [id, n] of Object.entries(d.items)) {
        if (byId.has(id) && n > 0) fresh[id] = n;
        else missing++;
      }
      setCart(fresh);
      writeCart(fresh);
      if (d.delivery) setDelivery(d.delivery);
      if (d.branchId && branches.some((b) => b.id === d.branchId)) setBranchId(d.branchId);
      if (d.address) setAddress(d.address);
      if (d.po) setPo(d.po);
      if (d.neededBy) setNeededBy(d.neededBy);
      if (d.notes) setNotes(d.notes);
      setNotice(
        (d.source === "intake"
          ? "Loaded from AI order intake. Check the customer, items and delivery, then send."
          : "Your usual items are in the cart. Check the quantities and the date, then send.") +
          (missing ? ` ${missing} item${missing > 1 ? "s are" : " is"} no longer in the catalog.` : ""),
      );
      if (isEmployee && (d.branchId || d.delivery === "dropship")) setStep("review");
      // Smart reorder for a contractor: one tap from Home straight to the review screen.
      if (!isEmployee && d.source === "smart" && Object.keys(fresh).length) setStep("review");
      router.replace("/order");
    } else if (props.reorder) {
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
    if (isEmployee) {
      const last = readOrderBranch();
      if (last && branches.some((b) => b.id === last)) setLastBranch(last);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customer = isEmployee ? customerList.find((c) => c.id === companyId) ?? null : null;

  // The customer list arrives trimmed (name, account #, city) so the screen opens fast; the chosen customer's
  // address, email and phone are fetched when they're picked.
  const [detailed, setDetailed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!isEmployee || !companyId || detailed.has(companyId)) return;
    let stop = false;
    customerDetails(companyId).then((full) => {
      if (stop || !full) return;
      setCustomerList((list) => list.map((c) => (c.id === full.id ? { ...c, ...full } : c)));
      setDetailed((d) => new Set(d).add(full.id));
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const branch = branches.find((b) => b.id === branchId) ?? null;
  const stockHere = (props.stock ?? {})[delivery === "dropship" ? "" : branchId];
  const branchLabel = (b: Branch | null | undefined) => (b ? `${b.name}, ${b.state}` : "");
  const pickLocation = (id: string) => {
    setBranchId(id);
    setLastBranch(id);
    writeOrderBranch(id);
    setStep(isEmployee && !companyId ? "customer" : "catalog");
    window.scrollTo(0, 0);
  };
  const pickCustomer = (id: string) => {
    setCompanyId(id);
    if (id) {
      setStep("catalog");
      window.scrollTo(0, 0);
    }
  };
  const addToList = (c: OrderCustomer) => {
    setCustomerList((list) => (list.some((x) => x.id === c.id) ? list : [...list, c].sort((a, b) => a.name.localeCompare(b.name))));
    setDetailed((d) => new Set(d).add(c.id));
  };

  // The approval email starts as the customer's email on file (editable, same rule as the address).
  const fileEmail = (customer?.email ?? "").trim();
  useEffect(() => {
    setApprovalEmail((cur) => (cur.trim() === "" || cur === autoEmail ? fileEmail : cur));
    setAutoEmail(fileEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileEmail]);

  // Ship-to starts as the address on file (the chosen customer's, or a contractor's own company's).
  // It stays editable; once someone types their own address, switching customers no longer overwrites it.
  const fileAddress = isEmployee ? addressOnFile(customer) : addressOnFile(me.company);
  useEffect(() => {
    setAddress((cur) => (cur.trim() === "" || cur === autoAddress ? fileAddress : cur));
    setAutoAddress(fileAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileAddress]);

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
  const canFilterAvail = isEmployee && !!stockHere && Object.keys(stockHere).length > 0;
  const isAvail = (id: string) => (stockHere?.[id]?.net ?? 0) > 0;
  const availFilter = canFilterAvail && onlyAvail;
  const shown = products.filter(
    (p) =>
      (cat === "all" || p.category_id === cat) &&
      (!availFilter || isAvail(p.id)) &&
      (!needle || `${p.name} ${p.sku} ${p.description ?? ""}`.toLowerCase().includes(needle)),
  );
  const availCount = canFilterAvail ? products.filter((p) => isAvail(p.id)).length : 0;

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
        customerName: "",
        approvalEmail: isEmployee && approvals ? approvalEmail : "",
        draftId: draftId ?? undefined,
      });
      if (res.ok) {
        writeCart({});
        router.push(`/orders/${res.id}?sent=${res.mode === "approval" ? "approval" : "1"}${res.warning ? "&warn=1" : ""}`);
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

  // ---------------------------------------------------------------- location
  if (step === "location") {
    return (
      <main className="shell">
        <header className="topbar">
          <h1 className="title" style={{ margin: 0 }}>Order for a customer</h1>
        </header>
        {isEmployee ? <Link href="/order/intake" className="home-alert">
          <span className="ic"><ClipboardPaste size={19} /></span>
          <span className="grow col tight">
            <span className="t">Got the order in a text, email or note?</span>
            <span className="s">Paste it or snap a photo and AMBIT Intelligence builds the order for you to check.</span>
          </span>
          <ChevronRight size={18} />
        </Link> : null}
        <section className="section">
          <div className="h2">Which location?</div>
          <p className="muted small" style={{ margin: 0 }}>Pick the AMBIT location this order will be picked up from or shipped from.</p>
          {branches.length === 0 ? (
            <div className="card muted small">No locations are set up yet. An admin can add them in the database.</div>
          ) : (
            <div className="list" aria-label="AMBIT locations">
              {branches.map((b) => {
                const current = b.id === branchId;
                const last = !branchId && b.id === lastBranch;
                return (
                  <button key={b.id} type="button" className={`item loc-pick${current ? " on" : ""}`} onClick={() => pickLocation(b.id)}>
                    <div className="ic"><MapPin size={20} /></div>
                    <div className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="t">{b.name}, {b.state}</span>
                      {b.address ? <span className="s loc-addr">{b.address}</span> : null}
                    </div>
                    {props.stock?.[b.id] ? <span className="pill grey">Live stock</span> : null}
                    {current ? <span className="pill ok">Picked</span> : last ? <span className="pill grey">Last used</span> : null}
                    <ChevronRight size={18} className="chev" />
                  </button>
                );
              })}
            </div>
          )}
          {loaded && lineCount > 0 && !branchId ? (
            <p className="tiny faint" style={{ margin: 0 }}>Your unfinished order ({lineCount} {lineCount === 1 ? "item" : "items"}) is still saved. Pick a location to keep going.</p>
          ) : null}
        </section>
        {lightbox}
      </main>
    );
  }

  // ---------------------------------------------------------------- customer
  if (step === "customer") {
    return (
      <main className="shell">
        <header className="topbar">
          <button type="button" className="iconbtn" aria-label="Back to locations" onClick={() => setStep("location")}>
            <ChevronLeft size={22} />
          </button>
          <h1 className="title" style={{ margin: 0 }}>Who&apos;s it for?</h1>
        </header>
        <button type="button" className="loc-bar" onClick={() => { setStep("location"); window.scrollTo(0, 0); }} aria-label={`Location: ${branchLabel(branch)}. Change location`}>
          <MapPin size={15} />
          <span className="grow">From <b>{branch ? branchLabel(branch) : "no location"}</b></span>
          <span className="linkbtn small">Change</span>
        </button>
        <section className="section">
          <div className="h2">Pick the customer</div>
          <p className="muted small" style={{ margin: 0 }}>Then add the items. Their ship-to address and contact fill in for you.</p>
          <CustomerPicker
            customers={customerList}
            value=""
            onChange={pickCustomer}
            onAdded={addToList}
            branches={branches}
            defaultBranch={branchId}
            autoFocus
          />
        </section>
        {loaded && lineCount > 0 ? (
          <p className="tiny faint" style={{ margin: 0 }}>Your unfinished order ({lineCount} {lineCount === 1 ? "item" : "items"}) is still saved.</p>
        ) : null}
      </main>
    );
  }

  // ------------------------------------------------------------------ review
  if (step === "review") {
    const forName = !isEmployee ? me.company?.name ?? "" : customer?.name ?? "";
    return (
      <main className="shell">
        <header className="topbar">
          <button type="button" className="iconbtn" aria-label="Back to catalog" onClick={() => setStep("catalog")}>
            <ChevronLeft size={22} />
          </button>
          <h1 className="title" style={{ margin: 0 }}>Review order</h1>
        </header>

        {isEmployee ? (
          <section className="section">
            <div className="eyebrow">Ordering for</div>
            <CustomerPicker
              customers={customerList}
              value={companyId}
              onChange={setCompanyId}
              onAdded={addToList}
              branches={branches}
              defaultBranch={branchId}
            />
          </section>
        ) : (
          <div className="card small">
            <div className="faint tiny" style={{ marginBottom: 4 }}>ORDERING AS</div>
            <b>{me.company?.name ?? "Your company"}</b>
            {me.company?.account_no ? <span className="muted"> · {me.company.account_no}</span> : null}
            <div className="muted">{me.name}</div>
          </div>
        )}

        {notice ? <div className="alert info small">{notice}</div> : null}

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
                      <div className="price">
                        {p.sale ? <span className="sale-tag">Sale</span> : null}
                        {money(p.list_price * qty)} <span className="faint">({money(p.list_price)} / {p.unit})</span>
                      </div>
                    ) : (
                      <div className="price faint">Price confirmed on invoice</div>
                    )}
                    {p.sqft ? <div className="tiny muted" style={{ marginTop: 2 }}>Covers {sqftText(qty * p.sqft)} sq ft</div> : null}
                    {p.sqft ? <SqftBox p={p} qty={qty} onQty={(n) => setQty(p.id, n)} /> : null}
                    <StockTag s={stockHere?.[p.id]} staff={isEmployee} />
                    {isEmployee && stockHere?.[p.id]?.net != null && qty > Math.max(0, stockHere[p.id].net ?? 0) ? (
                      <div className="tiny" style={{ color: "var(--warn-text)", marginTop: 2 }}>
                        {(stockHere[p.id].net ?? 0) > 0
                          ? `Only ${qtyText(stockHere[p.id].net ?? 0)} available here. The rest ships from the supplier.`
                          : "None available here. It ships from the supplier."}
                      </div>
                    ) : null}
                  </div>
                  <Stepper qty={qty} label={p.name} onChange={(n) => setQty(p.id, n)} />
                </div>
              ))}
              <div className="row between" style={{ padding: "14px 16px" }}>
                <span className="muted small">Estimated subtotal</span>
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
          {isEmployee ? (
            delivery === "dropship" ? (
              <p className="tiny faint" style={{ margin: 0 }}>Drop ship goes straight from the supplier, not from an AMBIT location.</p>
            ) : (
              <div className="loc-line">
                <MapPin size={18} />
                <div className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="tiny faint">{delivery === "pickup" ? "Picked up at" : "Ships from"}</span>
                  <b>{branch ? branchLabel(branch) : "No location picked"}</b>
                  {customer?.default_branch_id && customer.default_branch_id !== branchId && branches.some((b) => b.id === customer.default_branch_id) ? (
                    <span className="tiny faint">
                      {customer.name} usually orders from {branchLabel(branches.find((b) => b.id === customer.default_branch_id))}.{" "}
                      <button type="button" className="linkbtn tiny" onClick={() => customer.default_branch_id && setBranchId(customer.default_branch_id)}>Use that location</button>
                    </span>
                  ) : null}
                </div>
                <button type="button" className="linkbtn small" onClick={() => { setStep("location"); window.scrollTo(0, 0); }}>Change</button>
              </div>
            )
          ) : delivery !== "dropship" ? (
            <div className="col tight">
              {delivery === "jobsite" ? <span className="label">Ships from</span> : null}
              <div className="chips" role="radiogroup" aria-label={delivery === "pickup" ? "Pickup branch" : "Ships from branch"} style={{ flexWrap: "wrap" }}>
                {branches.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={branchId === b.id} className={`chip${branchId === b.id ? " on" : ""}`} onClick={() => setBranchId(b.id)}>
                    {b.name}, {b.state}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {delivery === "pickup" ? null : (
            <label className="field">
              <span className="label">{delivery === "jobsite" ? "Job site address" : "Ship-to address"}</span>
              <textarea className="textarea" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state, ZIP. Add a site contact if helpful." />
              {fileAddress ? (
                <span className="addr-hint tiny faint">
                  {address === fileAddress ? (
                    <>Filled in from the shipping address on file. Change it if this order goes somewhere else.</>
                  ) : (
                    <>
                      Different from the address on file.
                      <button type="button" className="linkbtn tiny" onClick={() => setAddress(fileAddress)}>Use address on file</button>
                    </>
                  )}
                </span>
              ) : null}
            </label>
          )}
        </section>

        <section className="section">
          <div className="grid2">
            <label className="field">
              <span className="label">Customer PO #</span>
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

        {isEmployee && approvals ? (
          <section className="section">
            <div className="eyebrow">Customer approval</div>
            <label className="field">
              <span className="label">Send the approval email to</span>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={approvalEmail}
                onChange={(e) => setApprovalEmail(e.target.value)}
                placeholder="customer@company.com"
              />
            </label>
            <p className="tiny faint" style={{ margin: 0 }}>
              {customer && !fileEmail ? "No email on file for this customer. Type the person who should approve it. " : ""}
              They get the order with an Approve button. It goes to orders@ambitpu.com once they approve.
            </p>
          </section>
        ) : null}

        {error ? (
          <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div>
        ) : null}

        <div className="col" style={{ gap: 8 }}>
          <button type="button" className="btn block" disabled={pending || lineCount === 0} onClick={submit}>
            {pending ? "Sending…" : !isEmployee ? "Approve order" : approvals ? "Send to customer for approval" : "Send order to AMBIT"}
          </button>
          <p className="tiny faint center" style={{ margin: 0 }}>
            {!isEmployee
              ? `Approving confirms the items, quantities and delivery details. It goes to orders@ambitpu.com and a copy goes to ${me.email}.`
              : approvals
                ? `${forName ? `${forName} gets` : "The customer gets"} an email to approve. You get a copy at ${me.email}.`
                : `Goes to orders@ambitpu.com${forName ? ` for ${forName}` : ""}. A copy goes to ${me.email}.`}
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
        {isEmployee ? (
          <button type="button" className="loc-bar" onClick={() => { setStep("location"); window.scrollTo(0, 0); }} aria-label={`Location: ${branchLabel(branch)}. Change location`}>
            <MapPin size={15} />
            <span className="grow">From <b>{branch ? branchLabel(branch) : "no location"}</b></span>
            <span className="linkbtn small">Change</span>
          </button>
        ) : null}
        {isEmployee ? (
          <button type="button" className="loc-bar" onClick={() => { setStep("customer"); window.scrollTo(0, 0); }} aria-label={`Customer: ${customer?.name ?? "none"}. Change customer`}>
            <UserRound size={15} />
            <span className="grow ellipsis">For <b>{customer ? customer.name : "no customer yet"}</b>{customer?.account_no ? <span className="faint"> · {customer.account_no}</span> : null}</span>
            <span className="linkbtn small">{customer ? "Change" : "Pick"}</span>
          </button>
        ) : null}
        <div className="search">
          <Search size={18} />
          <input className="input" type="search" placeholder="Search products or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        {canFilterAvail ? (
          <button
            type="button"
            className={`avail-toggle${onlyAvail ? " on" : ""}`}
            aria-pressed={onlyAvail}
            onClick={() => setOnlyAvail((v) => !v)}
            title={`Only products with stock available at ${branch?.name ?? "this location"}`}
          >
            {onlyAvail ? <Check size={16} strokeWidth={2.6} /> : <Filter size={16} />}
            <span className="grow">{onlyAvail ? "Showing available products only" : "Filter available products"}</span>
            <span className="avail-count">{availCount}</span>
          </button>
        ) : null}
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
        <div className="card muted small center">
          {products.length === 0
            ? "The catalog is empty. An admin can import products in Admin → Products."
            : availFilter
              ? <>Nothing available at {branch?.name ?? "this location"} matches. <button type="button" className="linkbtn" onClick={() => setOnlyAvail(false)}>Show all products</button></>
              : "No products match your search."}
        </div>
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
                  <StockTag s={stockHere?.[p.id]} staff={isEmployee} />
                  {p.sqft ? <SqftBox p={p} qty={qty} onQty={(n) => setQty(p.id, n)} /> : null}
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
