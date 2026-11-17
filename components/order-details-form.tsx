"use client";

import { useMemo, useState, useTransition } from "react";
import { CircleAlert, Save } from "lucide-react";
import { editOrderDetails } from "@/app/(app)/orders/actions";
import { CustomerPicker } from "@/components/customer-picker";
import { unpackCustomer, type PackedCustomer } from "@/lib/customers";
import type { Branch } from "@/lib/types";

type Method = "pickup" | "jobsite" | "dropship";
type Details = {
  id: string;
  company_id: string | null;
  company_name: string;
  delivery_method: string;
  branch_id: string | null;
  ship_address: string | null;
  po_number: string | null;
  needed_by: string | null;
  notes: string | null;
  ambit_po: string | null;
  invoice_no: string | null;
  pay_cod: boolean;
  pay_no_checks: boolean;
  pay_prepaid: boolean;
  status: string;
};

const METHODS: { key: Method; label: string; hint: string }[] = [
  { key: "pickup", label: "Pickup", hint: "The customer picks it up at an AMBIT location" },
  { key: "jobsite", label: "Delivery", hint: "AMBIT delivers it from a location" },
  { key: "dropship", label: "Ship from supplier", hint: "Ships straight from the supplier (no AMBIT stock)" },
];

/** Change an order's details (0076). Staff: ship-to. Admins: everything but the items. */
export function OrderDetailsForm({
  admin,
  order,
  branches,
  companies,
  canMove,
  moveWhy,
}: {
  admin: boolean;
  order: Details;
  branches: { id: string; name: string }[];
  companies: PackedCustomer[];
  canMove: boolean;
  moveWhy: string | null;
}) {
  const [customers, setCustomers] = useState(() => companies.map(unpackCustomer));
  const [company, setCompany] = useState(order.company_id ?? "");
  const [method, setMethod] = useState<Method>((order.delivery_method as Method) ?? "pickup");
  const [branch, setBranch] = useState(order.branch_id ?? "");
  const [ship, setShip] = useState(order.ship_address ?? "");
  const [po, setPo] = useState(order.po_number ?? "");
  const [needed, setNeeded] = useState(order.needed_by ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [so, setSo] = useState(order.ambit_po ?? "");
  const [inv, setInv] = useState(order.invoice_no ?? "");
  const [cod, setCod] = useState(order.pay_cod);
  const [noChecks, setNoChecks] = useState(order.pay_no_checks);
  const [prepaid, setPrepaid] = useState(order.pay_prepaid);
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const wasDropship = order.delivery_method === "dropship";
  const t = (v: string) => v.trim();
  const set = useMemo(() => {
    const out: Record<string, string | boolean | null> = {};
    if (method !== "pickup" && t(ship) !== t(order.ship_address ?? "")) out.ship_address = t(ship);
    if (!admin) return out;
    if (company && company !== (order.company_id ?? "")) out.company_id = company;
    if (method !== order.delivery_method) out.delivery_method = method;
    if (method !== "dropship" && branch !== (order.branch_id ?? "")) out.branch_id = branch;
    if (t(po) !== t(order.po_number ?? "")) out.po_number = t(po);
    if (needed !== (order.needed_by ?? "")) out.needed_by = needed || null;
    if (t(notes) !== t(order.notes ?? "")) out.notes = t(notes);
    if (order.ambit_po && t(so) !== order.ambit_po) out.ambit_po = t(so);
    if (order.invoice_no && t(inv) !== order.invoice_no) out.invoice_no = t(inv);
    if (cod !== order.pay_cod) out.pay_cod = cod;
    if (noChecks !== order.pay_no_checks) out.pay_no_checks = noChecks;
    if (prepaid !== order.pay_prepaid) out.pay_prepaid = prepaid;
    // Changing to or from Ship from supplier always sends the location along (it's dropped or needed).
    if ("delivery_method" in out && method !== "dropship") out.branch_id = branch;
    return out;
  }, [admin, company, method, branch, ship, po, needed, notes, so, inv, cod, noChecks, prepaid, order]);
  const changed = Object.keys(set).length > 0;
  const moving = admin && (branch !== (order.branch_id ?? "") && method !== "dropship" || (method === "dropship") !== wasDropship);
  const blocked = moving && !canMove;

  const save = () => {
    setErr(null);
    if (method !== "pickup" && !t(ship)) return setErr("Enter the ship-to address.");
    if (admin && method !== "dropship" && !branch) return setErr("Pick the AMBIT location.");
    start(async () => {
      const r = await editOrderDetails({ id: order.id, set, note: why });
      if (r && !r.ok) setErr(r.error);
    });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      {admin ? (
        <section className="card col" style={{ gap: 10 }}>
          <b>Customer</b>
          <CustomerPicker
            customers={customers}
            value={company}
            onChange={setCompany}
            onAdded={(c) => setCustomers((l) => [...l, c])}
            branches={branches.map((b) => ({ id: b.id, name: b.name }) as Branch)}
            canAdd={false}
          />
          {company && company !== (order.company_id ?? "") ? (
            <p className="tiny warn-t" style={{ margin: 0 }}>
              Was {order.company_name}. The prices on the items stay as they are, so check them against this customer&apos;s pricing. The sales rep
              becomes this customer&apos;s rep.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="card col" style={{ gap: 10 }}>
        <b>{admin ? "Pickup or delivery" : "Ship to"}</b>
        {admin ? (
          <>
            <div className="seg" role="radiogroup" aria-label="Pickup or delivery">
              {METHODS.map((m) => (
                <button key={m.key} type="button" role="radio" aria-checked={method === m.key} className={method === m.key ? "on" : ""} onClick={() => setMethod(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="tiny faint" style={{ marginTop: -4 }}>{METHODS.find((m) => m.key === method)?.hint}</span>
            {method !== "dropship" ? (
              <label className="field">
                <span className="label">{method === "pickup" ? "Picked up at" : "Ships from"}</span>
                <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="" disabled>Pick the location…</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {moving ? (
              blocked ? (
                <div className="alert err small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{moveWhy}</span></div>
              ) : (
                <p className="tiny warn-t" style={{ margin: 0 }}>
                  {method === "dropship"
                    ? "The stock this order holds is released (it ships from the supplier)."
                    : "The stock this order holds moves to this location: released where it was, held here (taking lots the same way a new order does)."}
                </p>
              )
            ) : null}
          </>
        ) : null}
        {method !== "pickup" ? (
          <label className="field">
            <span className="label">Ship-to address</span>
            <textarea className="textarea" rows={3} value={ship} onChange={(e) => setShip(e.target.value)} placeholder="Street, city, state, ZIP. Gate code or job site contact if they need it." maxLength={500} />
          </label>
        ) : !admin ? (
          <p className="small muted" style={{ margin: 0 }}>This order is a pickup, so it has no ship-to address. An admin can change it to a delivery.</p>
        ) : null}
      </section>

      {admin ? (
        <section className="card col" style={{ gap: 10 }}>
          <b>Order details</b>
          <div className="grid2">
            <label className="field">
              <span className="label">Customer PO</span>
              <input className="input" value={po} onChange={(e) => setPo(e.target.value)} maxLength={80} />
            </label>
            <label className="field">
              <span className="label">Needed by</span>
              <input className="input" type="date" value={needed} onChange={(e) => setNeeded(e.target.value)} />
            </label>
          </div>
          {order.ambit_po || order.invoice_no ? (
            <div className="grid2">
              {order.ambit_po ? (
                <label className="field">
                  <span className="label">Sales Order #</span>
                  <input className="input" value={so} onChange={(e) => setSo(e.target.value)} maxLength={40} />
                </label>
              ) : null}
              {order.invoice_no ? (
                <label className="field">
                  <span className="label">Invoice #</span>
                  <input className="input" value={inv} onChange={(e) => setInv(e.target.value)} maxLength={40} />
                </label>
              ) : null}
            </div>
          ) : null}
          <label className="field">
            <span className="label">Notes</span>
            <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </label>
          <span className="label">Payment</span>
          <label className="check small"><input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} /> <span>COD (pay on pickup or delivery)</span></label>
          <label className="check small"><input type="checkbox" checked={noChecks} onChange={(e) => setNoChecks(e.target.checked)} /> <span>No checks</span></label>
          <label className="check small"><input type="checkbox" checked={prepaid} onChange={(e) => setPrepaid(e.target.checked)} /> <span>Customer has already paid</span></label>
        </section>
      ) : null}

      <section className="card col" style={{ gap: 10 }}>
        <label className="field">
          <span className="label">Why (optional)</span>
          <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder={admin ? "Wrong customer picked, new job site, …" : "New job site, customer called, …"} />
        </label>
        {err ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{err}</span></div> : null}
        <button type="button" className="btn block" disabled={!changed || pending || blocked} onClick={save}>
          <Save size={16} /> {pending ? "Saving…" : changed ? "Save" : "Nothing changed yet"}
        </button>
      </section>
    </div>
  );
}
