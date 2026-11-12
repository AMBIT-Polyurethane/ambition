"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { HowToChip } from "@/components/howto-chip";
import { ClosedWarning } from "@/components/holiday";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, CircleAlert, ClipboardPaste, Filter, FlaskConical, MapPin, Minus, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { Icon, categoryIcon } from "@/components/icons";
import { readCart, writeCart, readOrderBranch, writeOrderBranch, readLots, writeLots, NO_LOTS, type Cart, type LotPicks } from "@/lib/cart";
import { money } from "@/lib/format";
import { customerDetails, customerRep, placeOrder } from "@/app/(app)/order/actions";
import { HOUSE, RepOptions, staffName, type Staff } from "@/components/rep-options";
import { CustomerPicker } from "@/components/customer-picker";
import { addressOnFile, unpackCustomer, type OrderCustomer, type PackedCustomer } from "@/lib/customers";
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
  /** Staff: spray foam ISO (A side) or resin (B side) by the drum or tote, for a custom foam order. */
  foam?: "iso" | "resin";
  /** An ISO brand: only offered on the custom foam order (the store sells one "ISO A-Side"). */
  custom?: boolean;
};

/** Staff: one lot / batch of an ISO brand or resin at a location (FOAM LOTS tab), with the drums still free to order. */
export type FoamLot = {
  id: number;
  product_id: string;
  sku: string;
  lot_no: string;
  mfg: string | null;
  exp: string | null;
  use_by: string | null;
  remaining: number;
  available: number;
  expired: boolean;
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
  /** Staff: every customer, packed small (see lib/customers). */
  companies: PackedCustomer[] | null;
  isEmployee: boolean;
  /** Days AMBIT is closed (0063): the Needed by date warns on them. */
  closures?: { date: string; name: string }[];
  /** Staff with "Add new customers" (admins, the credit team); others send a request. */
  canAddCustomers?: boolean;
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
  /** Staff: each location's ISO and resin lots (custom foam order picks exact drums). */
  lots?: Record<string, FoamLot[]>;
  /** Staff: everyone who can get credit for an order (the required Sales rep box). */
  staff?: Staff[];
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

function Stepper({ qty, onChange, label, max }: { qty: number; onChange: (n: number) => void; label: string; max?: number }) {
  const cap = (n: number) => (max === undefined ? n : Math.min(n, max));
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
        max={max}
        value={qty}
        onChange={(e) => onChange(cap(Math.max(0, Math.floor(Number(e.target.value) || 0))))}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label={`One more ${label}`} disabled={max !== undefined && qty >= max} onClick={() => onChange(cap(qty + 1))}>
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
  const [foamMode, setFoamMode] = useState(false);
  // Staff, custom foam order: the exact lots picked (product -> lot -> drums). The rest of a line is "any lot".
  const [lotPicks, setLotPicks] = useState<LotPicks>(NO_LOTS);
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
  const [customerList, setCustomerList] = useState<OrderCustomer[]>(() => (companies ?? []).map(unpackCustomer));
  const [autoAddress, setAutoAddress] = useState("");
  const [approvalEmail, setApprovalEmail] = useState("");
  // Staff: the customer already OK'd it (by phone, in person): skip the approval email.
  const [skipApproval, setSkipApproval] = useState(false);
  const [autoEmail, setAutoEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Staff: who gets credit for the order (required). Starts as the customer's sales rep or House Account.
  const [salesRep, setSalesRep] = useState("");
  const [repOnFile, setRepOnFile] = useState<{ id: string; value: string } | null>(null);
  const [repToCustomer, setRepToCustomer] = useState(true);

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
      writeLots(NO_LOTS);
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
      writeLots(NO_LOTS);
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
      if (isEmployee) setLotPicks(readLots());
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

  // The customer's sales rep (or House Account) fills in the Sales rep box; a different customer starts it over.
  useEffect(() => {
    if (!isEmployee) return;
    setRepOnFile(null);
    setSalesRep("");
    if (!companyId) return;
    let stop = false;
    customerRep(companyId).then((r) => {
      if (stop || !r) return;
      const value = r.rep ?? (r.house ? HOUSE : "");
      setRepOnFile({ id: companyId, value });
      setSalesRep((cur) => cur || value);
      setRepToCustomer(!value);
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  const staff = props.staff ?? [];
  const fileRep = repOnFile?.id === companyId ? repOnFile.value : "";
  const repName = (v: string) => (v === HOUSE ? "House Account" : staffName(staff.find((p) => p.id === v) ?? { full_name: null, email: "someone no longer on staff" }));

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

  // ---- Custom foam order lots (staff): only at the location they were picked at, never on a drop ship ----
  const lotsHere = useMemo(() => {
    const m = new Map<string, FoamLot[]>();
    if (!isEmployee || delivery === "dropship" || !branchId) return m;
    for (const l of props.lots?.[branchId] ?? []) m.set(l.product_id, [...(m.get(l.product_id) ?? []), l]);
    // Soonest to expire first (the way the warehouse picks); expired lots at the bottom.
    for (const [k, v] of m) m.set(k, [...v].sort((a, b) => Number(a.expired) - Number(b.expired)));
    return m;
  }, [props.lots, branchId, delivery, isEmployee]);
  // The picks that still hold: the lot is still there, not expired, and has the drums free.
  const picksHere = useMemo(() => {
    const out: LotPicks["picks"] = {};
    if (lotPicks.branch !== branchId) return out;
    for (const [pid, m] of Object.entries(lotPicks.picks)) {
      const free = new Map((lotsHere.get(pid) ?? []).filter((l) => !l.expired).map((l) => [String(l.id), l.available]));
      const keep: Record<string, number> = {};
      for (const [lid, n] of Object.entries(m)) {
        const q = Math.min(n, free.get(lid) ?? 0);
        if (q > 0) keep[lid] = q;
      }
      const sum = Object.values(keep).reduce((a, b) => a + b, 0);
      if (sum > 0 && sum <= (cart[pid] ?? 0)) out[pid] = keep;
    }
    return out;
  }, [lotPicks, lotsHere, branchId, cart]);
  const pickedOf = (pid: string) => Object.values(picksHere[pid] ?? {}).reduce((a, b) => a + b, 0);
  const savePicks = (picks: LotPicks["picks"]) => {
    const next = { branch: branchId, picks };
    setLotPicks(next);
    writeLots(next);
  };
  // Lots are counted per location: picks made at another location don't carry over.
  useEffect(() => {
    if (!loaded || !isEmployee || !branchId || !lotPicks.branch || lotPicks.branch === branchId) return;
    if (Object.keys(lotPicks.picks).length) {
      const from = branches.find((b) => b.id === lotPicks.branch);
      setNotice(`The lots you picked were at ${from?.name ?? "another location"}, so they were cleared. The drums are still on the order: pick lots again here, or the warehouse picks them.`);
    }
    setLotPicks(NO_LOTS);
    writeLots(NO_LOTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, loaded]);

  const setQty = (id: string, n: number) => {
    const next = { ...cart, [id]: Math.max(0, n) };
    if (next[id] === 0) delete next[id];
    setCart(next);
    writeCart(next);
    // Fewer drums than the lots picked: they come off the latest-expiring lots first.
    const mine = picksHere[id];
    let over = pickedOf(id) - Math.max(0, n);
    if (mine && over > 0) {
      const left = { ...mine };
      for (const lid of (lotsHere.get(id) ?? []).map((l) => String(l.id)).filter((x) => left[x]).reverse()) {
        if (over <= 0) break;
        const t = Math.min(over, left[lid]);
        left[lid] -= t;
        over -= t;
      }
      savePicks({ ...picksHere, [id]: left });
    }
  };
  // A lot's drums (capped at what that lot has free); the line's total follows.
  const setLot = (pid: string, lot: FoamLot, n: number) => {
    const mine = { ...(picksHere[pid] ?? {}), [String(lot.id)]: Math.max(0, Math.min(n, lot.available)) };
    const any = Math.max(0, (cart[pid] ?? 0) - pickedOf(pid));
    const total = any + Object.values(mine).reduce((a, b) => a + b, 0);
    const next = { ...cart, [pid]: total };
    if (!total) delete next[pid];
    setCart(next);
    writeCart(next);
    savePicks({ ...picksHere, [pid]: mine });
  };
  // "Any lot" drums: the warehouse picks them (soonest-expiring first).
  const setAny = (pid: string, n: number) => setQty(pid, pickedOf(pid) + Math.max(0, n));
  const lotSummary = (pid: string) => {
    const mine = picksHere[pid] ?? {};
    const parts = (lotsHere.get(pid) ?? []).filter((l) => mine[String(l.id)]).map((l) => `${l.lot_no || "(no lot #)"} × ${qtyText(mine[String(l.id)])}`);
    const any = Math.max(0, (cart[pid] ?? 0) - pickedOf(pid));
    if (any) parts.push(`any lot × ${qtyText(any)}`);
    return parts.join(" · ");
  };

  // Each location offers only what's on its own inventory spreadsheet. A location with no spreadsheet shows
  // everything. Items already in the cart that the location doesn't carry stay saved (they come back if the
  // location is switched to one that carries them) but are left off this order.
  const listHere = branchId ? (props.stock ?? {})[branchId] : undefined;
  const limited = !!listHere && Object.keys(listHere).length > 0;
  const carried = (id: string) => !limited || Object.prototype.hasOwnProperty.call(listHere, id);
  const offList = Object.entries(cart)
    .filter(([id, n]) => n > 0 && byId.has(id) && !carried(id))
    .map(([id]) => byId.get(id)!);
  const offNote = offList.length && branch ? (
    <div className="alert warn small" role="status">
      <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
      <span>
        {offList.length === 1 ? "This item isn't" : `These ${offList.length} items aren't`} on the {branch.name} list, so {offList.length === 1 ? "it's" : "they're"} left off this order:{" "}
        <b>{offList.map((p) => p.name).join(" · ")}</b>. To order {offList.length === 1 ? "it" : "them"}, pick a location that carries {offList.length === 1 ? "it" : "them"}.
      </span>
    </div>
  ) : null;

  const lines = Object.entries(cart)
    .filter(([id, n]) => n > 0 && byId.has(id) && carried(id))
    .map(([id, n]) => ({ p: byId.get(id)!, qty: n }));
  const lineCount = lines.length;
  const subtotal = lines.reduce((s, l) => s + (!l.p.cp && l.p.list_price !== null ? l.p.list_price * l.qty : 0), 0);
  const hasCp = lines.some((l) => l.p.cp);
  const hasTbd = lines.some((l) => !l.p.cp && l.p.list_price === null);

  const needle = q.trim().toLowerCase();
  const canFilterAvail = isEmployee && !!stockHere && Object.keys(stockHere).length > 0;
  const isAvail = (id: string) => (stockHere?.[id]?.net ?? 0) > 0;
  const availFilter = canFilterAvail && onlyAvail;
  const here = (limited ? products.filter((p) => carried(p.id)) : products).filter((p) => !p.custom);
  // Custom foam order: every ISO brand and resin this location stocks.
  const foamHere = products.filter((p) => p.foam && carried(p.id));
  const isoHere = foamHere.filter((p) => p.foam === "iso").sort((a, b) => a.name.localeCompare(b.name));
  const resinHere = foamHere.filter((p) => p.foam === "resin").sort((a, b) => a.name.localeCompare(b.name));
  const drumsOf = (list: CatalogProduct[]) => list.reduce((s, p) => s + (cart[p.id] ?? 0) * (/^totes?$/i.test(p.unit) ? 5 : 1), 0);
  const catsHere = limited ? categories.filter((c) => here.some((p) => p.category_id === c.id)) : categories;
  const catNow = cat === "all" || catsHere.some((c) => c.id === cat) ? cat : "all";
  const shown = here.filter(
    (p) =>
      (catNow === "all" || p.category_id === catNow) &&
      (!availFilter || isAvail(p.id)) &&
      (!needle || `${p.name} ${p.sku} ${p.description ?? ""}`.toLowerCase().includes(needle)),
  );
  const availCount = canFilterAvail ? here.filter((p) => isAvail(p.id)).length : 0;

  const submit = () => {
    setError(null);
    if (isEmployee && !salesRep) {
      setError("Pick the sales rep for this order (or House Account if no sales rep gets credit).");
      document.getElementById("sales-rep")?.focus();
      return;
    }
    startTransition(async () => {
      const res = await placeOrder({
        items: Object.fromEntries(Object.entries(cart).filter(([id]) => carried(id))),
        delivery,
        branchId,
        address,
        po,
        neededBy,
        notes,
        companyId: isEmployee ? companyId : "",
        customerName: "",
        approvalEmail: isEmployee && approvals && !skipApproval ? approvalEmail : "",
        skipApproval: isEmployee && approvals && skipApproval,
        draftId: draftId ?? undefined,
        salesRep: isEmployee ? salesRep : undefined,
        repToCustomer: isEmployee && Boolean(companyId) && salesRep !== fileRep && repToCustomer,
        lots:
          isEmployee && delivery !== "dropship"
            ? Object.entries(picksHere)
                .filter(([pid]) => carried(pid) && (cart[pid] ?? 0) > 0)
                .flatMap(([pid, m]) => Object.entries(m).map(([lid, qty]) => ({ product_id: pid, lot_id: Number(lid), qty })))
            : [],
      });
      if (res.ok) {
        writeCart({});
        writeLots(NO_LOTS);
        router.push(`/orders/${res.id}?sent=${res.mode === "approval" ? "approval" : "1"}${res.warning ? "&warn=1" : ""}${res.repError ? `&err=${encodeURIComponent(res.repError)}` : ""}`);
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
          {isEmployee ? <HowToChip slug="enter-an-order" /> : null}
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
            canAdd={props.canAddCustomers}
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
          {isEmployee ? <HowToChip slug="enter-an-order" /> : null}
        </header>

        {isEmployee ? (
          <section className="section">
            <div className="eyebrow">Ordering for</div>
            <CustomerPicker
              customers={customerList}
              value={companyId}
              onChange={setCompanyId}
              onAdded={addToList}
              canAdd={props.canAddCustomers}
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

        {isEmployee ? (
          <section className="section rep-pick">
            <label className="field">
              <span className="label">Sales rep <span className="req">Required</span></span>
              <select
                id="sales-rep"
                className={`select${salesRep ? "" : " need"}`}
                value={salesRep}
                onChange={(e) => {
                  setSalesRep(e.target.value);
                  setError(null);
                }}
                aria-required="true"
              >
                <option value="" disabled>Pick who gets credit for this order…</option>
                <RepOptions staff={staff} house />
              </select>
            </label>
            <p className="tiny faint" style={{ margin: 0 }}>
              {!companyId
                ? "Pick the customer first; their sales rep fills in here."
                : !repOnFile || repOnFile.id !== companyId
                  ? "Looking up the customer's sales rep…"
                  : fileRep && salesRep === fileRep
                    ? `From ${customer?.name ?? "the customer"}'s account. This order counts toward ${fileRep === HOUSE ? "no one's sales goals (House Account)" : `${repName(fileRep)}'s sales goals`}.`
                    : fileRep
                      ? `${customer?.name ?? "This customer"}'s account says ${repName(fileRep)}. This order goes to ${salesRep ? repName(salesRep) : "whoever you pick"} instead.`
                      : `${customer?.name ?? "This customer"} has no sales rep yet. Pick one, or House Account if no sales rep gets credit.`}
            </p>
            {companyId && salesRep && salesRep !== fileRep && repOnFile?.id === companyId ? (
              <label className="check small">
                <input type="checkbox" checked={repToCustomer} onChange={(e) => setRepToCustomer(e.target.checked)} />
                <span>
                  Also make {salesRep === HOUSE ? "this customer a House Account" : `${repName(salesRep)} ${customer?.name ?? "this customer"}'s sales rep`} for future orders
                </span>
              </label>
            ) : null}
          </section>
        ) : null}

        {notice ? <div className="alert info small">{notice}</div> : null}
        {offNote}

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
                    {p.foam && lotsHere.has(p.id) ? (
                      <div className="lot-sum">
                        {picksHere[p.id] ? <>Lots: <b>{lotSummary(p.id)}</b></> : <>Any lot: the warehouse picks the soonest-expiring.</>}{" "}
                        <button type="button" className="linkbtn tiny" onClick={() => { setFoamMode(true); setStep("catalog"); window.scrollTo(0, 0); }}>
                          {picksHere[p.id] ? "Change lots" : "Pick lots"}
                        </button>
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
              ["jobsite", "Deliver to contractor"],
              ["dropship", "Drop ship"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={delivery === id} className={delivery === id ? "on" : ""} onClick={() => setDelivery(id)}>
                {label}
              </button>
            ))}
          </div>
          {isEmployee ? (
            delivery === "dropship" ? (
              <p className="tiny faint" style={{ margin: 0 }}>
                Drop ship goes straight from the supplier, not from an AMBIT location.
                {lotPicks.branch === branchId && Object.keys(lotPicks.picks).length ? " The lots you picked aren't used." : ""}
              </p>
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
              <span className="label">{delivery === "jobsite" ? "Delivery address" : "Ship-to address"}</span>
              <textarea className="textarea" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, state, ZIP. Add a contact name and phone if helpful." />
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
              <ClosedWarning date={neededBy} closures={props.closures ?? []} />
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
            <label className="check" style={{ marginBottom: 6 }}>
              <input type="checkbox" checked={skipApproval} onChange={(e) => setSkipApproval(e.target.checked)} />
              <span><b>Approve without customer email approval</b> <span className="tiny faint">· they already OK&apos;d it; it goes straight to orders@ambitpu.com with your name on it</span></span>
            </label>
            {!skipApproval ? (
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
            ) : null}
            {!skipApproval ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              {customer && !fileEmail ? "No email on file for this customer. Type the person who should approve it. " : ""}
              They get the order with an Approve button. It goes to orders@ambitpu.com once they approve.
            </p>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div>
        ) : null}

        <div className="col" style={{ gap: 8 }}>
          <button type="button" className="btn block" disabled={pending || lineCount === 0} onClick={submit}>
            {pending ? "Sending…" : !isEmployee ? "Approve order" : approvals && !skipApproval ? "Send to customer for approval" : "Send order to AMBIT"}
          </button>
          <p className="tiny faint center" style={{ margin: 0 }}>
            {!isEmployee
              ? `Approving confirms the items, quantities and delivery details. It goes to orders@ambitpu.com and a copy goes to ${me.email}.`
              : approvals && !skipApproval
                ? `${forName ? `${forName} gets` : "The customer gets"} an email to approve. You get a copy at ${me.email}.`
                : `Goes to orders@ambitpu.com${forName ? ` for ${forName}` : ""}. A copy goes to ${me.email}.`}
          </p>
        </div>
        {lightbox}
      </main>
    );
  }

  const backToCatalog = () => { setFoamMode(false); window.scrollTo(0, 0); };
  const placeBars = isEmployee ? (
    <>
      <button type="button" className="loc-bar" onClick={() => { setFoamMode(false); setStep("location"); window.scrollTo(0, 0); }} aria-label={`Location: ${branchLabel(branch)}. Change location`}>
        <MapPin size={15} />
        <span className="grow">From <b>{branch ? branchLabel(branch) : "no location"}</b></span>
        <span className="linkbtn small">Change</span>
      </button>
      <button type="button" className="loc-bar" onClick={() => { setFoamMode(false); setStep("customer"); window.scrollTo(0, 0); }} aria-label={`Customer: ${customer?.name ?? "none"}. Change customer`}>
        <UserRound size={15} />
        <span className="grow ellipsis">For <b>{customer ? customer.name : "no customer yet"}</b>{customer?.account_no ? <span className="faint"> · {customer.account_no}</span> : null}</span>
        <span className="linkbtn small">{customer ? "Change" : "Pick"}</span>
      </button>
    </>
  ) : null;
  const cartBar =
    loaded && lineCount > 0 ? (
      <div className="cartbar">
        <div className="inner">
          <button type="button" className="btn" onClick={() => { setFoamMode(false); setStep("review"); window.scrollTo(0, 0); }}>
            <span className="count">{lineCount} {lineCount === 1 ? "item" : "items"}</span>
            <span>Review order</span>
            <span style={{ minWidth: 60, textAlign: "right", letterSpacing: 0 }}>{subtotal > 0 ? money(subtotal) : ""}</span>
          </button>
        </div>
      </div>
    ) : null;
  const foamRow = (p: CatalogProduct) => {
    const qty = cart[p.id] ?? 0;
    return (
      <div key={p.id} className="product">
        <div className="grow">
          <div className="name">{p.name}</div>
          <div className="desc">{p.sku}</div>
          <StockTag s={stockHere?.[p.id]} staff={isEmployee} />
        </div>
        {qty > 0 ? (
          <Stepper qty={qty} label={p.name} onChange={(n) => setQty(p.id, n)} />
        ) : (
          <button type="button" className="add" onClick={() => setQty(p.id, 1)} aria-label={`Add ${p.name}`}>ADD</button>
        )}
      </div>
    );
  };

  // "Made 4/2/26 · Expires 4/2/27" (short, so it fits a phone)
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;
  const lotDates = (l: FoamLot) =>
    [l.mfg ? `Made ${md(l.mfg)}` : null, l.exp ? `Expires ${md(l.exp)}` : l.use_by ? `Use by ${md(l.use_by)}` : null].filter(Boolean).join(" · ");
  // Staff: every lot / batch of this brand or resin, to order exact drums, plus "Any lot".
  const foamLotsRow = (p: CatalogProduct, list: FoamLot[]) => {
    const qty = cart[p.id] ?? 0;
    const mine = picksHere[p.id] ?? {};
    const any = Math.max(0, qty - pickedOf(p.id));
    return (
      <div key={p.id} className="foam-prod">
        <div className="product">
          <div className="grow">
            <div className="name">{p.name}</div>
            <div className="desc">{p.sku} · {list.length} {list.length === 1 ? "lot" : "lots"}</div>
            <StockTag s={stockHere?.[p.id]} staff />
          </div>
          {qty > 0 ? <span className="pill ok">{qtyText(qty)} on order</span> : null}
        </div>
        <div className="lot-opts" role="group" aria-label={`Lots of ${p.name}`}>
          {list.map((l) => {
            const n = mine[String(l.id)] ?? 0;
            const lotName = `Lot ${l.lot_no || "(no lot #)"}`;
            const off = l.expired || l.available <= 0;
            return (
              <div key={l.id} className={`lot-opt${off ? " off" : ""}${n ? " on" : ""}`}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="lot-no">
                    <span>{lotName}</span>
                    {l.expired ? (
                      <span className="pill red">Expired</span>
                    ) : l.available > 0 ? (
                      <span className="lot-avail">{qtyText(l.available)} available</span>
                    ) : (
                      <span className="lot-avail none">0 available · held for other orders</span>
                    )}
                  </div>
                  <div className="lot-meta">{lotDates(l) || "No dates on the FOAM LOTS tab"}</div>
                </div>
                {off ? null : n > 0 ? (
                  <Stepper qty={n} max={l.available} label={`${p.name}, ${lotName}`} onChange={(v) => setLot(p.id, l, v)} />
                ) : (
                  <button type="button" className="add" onClick={() => setLot(p.id, l, 1)} aria-label={`Add one from ${lotName} of ${p.name}`}>ADD</button>
                )}
              </div>
            );
          })}
          <div className={`lot-opt any${any ? " on" : ""}`}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="lot-no"><span>Any lot</span></div>
              <div className="lot-meta">The warehouse picks, soonest-expiring first</div>
            </div>
            {any > 0 ? (
              <Stepper qty={any} label={`${p.name}, any lot`} onChange={(v) => setAny(p.id, v)} />
            ) : (
              <button type="button" className="add" onClick={() => setAny(p.id, 1)} aria-label={`Add one ${p.name}, any lot`}>ADD</button>
            )}
          </div>
        </div>
      </div>
    );
  };
  const foamItem = (p: CatalogProduct) => {
    const list = lotsHere.get(p.id);
    return list?.length ? foamLotsRow(p, list) : foamRow(p);
  };

  // ------------------------------------------------------ custom foam order (staff)
  if (foamMode) {
    const iso = drumsOf(isoHere), resin = drumsOf(resinHere);
    const totes = [...isoHere, ...resinHere].some((p) => (cart[p.id] ?? 0) > 0 && /^totes?$/i.test(p.unit));
    return (
      <main className="shell" style={{ paddingBottom: "calc(var(--tabbar) + env(safe-area-inset-bottom) + 100px)" }}>
        <div className="sticky-top">
          <div className="topbar">
            <button type="button" className="iconbtn" aria-label="Back to all products" onClick={backToCatalog}>
              <ChevronLeft size={20} />
            </button>
            <h1 className="title" style={{ margin: 0 }}>Custom foam order</h1>
          </div>
          {placeBars}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {isEmployee ? (
            <>
              Pick the exact drums the customer asked for, from {branch ? branch.name : "this location"}&apos;s inventory: tap ADD on a lot / batch to
              hold drums from that lot, or on <b>Any lot</b> and the warehouse picks the soonest-expiring. Each brand and resin is its own line on the order.
            </>
          ) : (
            <>
              Order ISO and resin by the drum, in any mix you need{branch ? ` from ${branch.name}` : ""}. Tap ADD on each one, then review your order.
            </>
          )}
        </p>
        {foamHere.length === 0 ? (
          <div className="card muted small center">{branch ? `${branch.name} has no spray foam on its inventory list.` : "Pick a location first."}</div>
        ) : (
          <>
            <section className="section">
              <div className="eyebrow">ISO · A side</div>
              {isoHere.length ? <div className="list">{isoHere.map(foamItem)}</div> : <div className="card muted small">No ISO on {branch?.name ?? "this location"}&apos;s list.</div>}
            </section>
            <section className="section">
              <div className="eyebrow">Resin · B side</div>
              {resinHere.length ? <div className="list">{resinHere.map(foamItem)}</div> : <div className="card muted small">No resins on {branch?.name ?? "this location"}&apos;s list.</div>}
            </section>
            <div className={`alert ${iso && resin && iso !== resin ? "warn" : "info"} small`} role="status">
              <FlaskConical size={16} style={{ flex: "none", marginTop: 2 }} />
              <span>
                <b>ISO {qtyText(iso)} · Resin {qtyText(resin)}</b> {totes ? "(in drums; a tote counts as 5)" : "drums"}.{" "}
                {iso && resin && iso !== resin
                  ? `That isn't even sets (${qtyText(iso)} ISO to ${qtyText(resin)} resin). Fine if that's what ${isEmployee ? "the customer asked for" : "you need"}.`
                  : iso || resin
                    ? "Change the quantities with + and −, then review the order."
                    : `Tap ADD on each ISO and resin ${isEmployee ? "the customer wants" : "you need"}.`}
              </span>
            </div>
          </>
        )}
        <button type="button" className="btn ghost block" onClick={backToCatalog}>Back to all products</button>
        {cartBar}
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
        {foamHere.length ? (
          <button type="button" className="btn dark block custom-foam" onClick={() => { setFoamMode(true); window.scrollTo(0, 0); }}>
            <FlaskConical size={17} /> Make Custom Foam Order
          </button>
        ) : null}
        {placeBars}
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
          <button type="button" role="tab" aria-selected={catNow === "all"} className={`chip${catNow === "all" ? " on" : ""}`} onClick={() => setCat("all")}>All</button>
          {catsHere.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={catNow === c.id} className={`chip${catNow === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {notice ? <div className="alert info">{notice}</div> : null}
      {offNote}

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

      {cartBar}
      {lightbox}
    </main>
  );
}
