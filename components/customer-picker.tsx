"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Search, UserPlus, X } from "lucide-react";
import { addCustomer } from "@/app/(app)/order/actions";
import { matchCustomers, type OrderCustomer } from "@/lib/customers";
import type { Branch } from "@/lib/types";

type Props = {
  customers: OrderCustomer[];
  value: string;
  onChange: (id: string) => void;
  onAdded: (c: OrderCustomer) => void;
  branches: Branch[];
};

/** AMBIT staff: type part of a customer's name, account # or city to find them. */
export function CustomerPicker({ customers, value, onChange, onAdded, branches }: Props) {
  const selected = customers.find((c) => c.id === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const { shown, more } = useMemo(() => matchCustomers(customers, query), [customers, query]);
  useEffect(() => setActive(0), [query]);

  const choose = (c: OrderCustomer) => {
    onChange(c.id);
    setQuery("");
    setOpen(false);
    setFlash(null);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && shown[active]) {
        e.preventDefault();
        choose(shown[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (adding) {
    return (
      <NewCustomerForm
        startName={query}
        branches={branches}
        onCancel={() => setAdding(false)}
        onSaved={(c, message) => {
          onAdded(c);
          onChange(c.id);
          setAdding(false);
          setQuery("");
          setFlash(message);
        }}
      />
    );
  }

  if (selected) {
    return (
      <div className="col" style={{ gap: 8 }}>
        <div className="card cust-card">
          <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{selected.name}</b>
              <div className="muted small">
                {[selected.account_no, [selected.city, selected.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No account # yet"}
              </div>
              {selected.contact_name || selected.phone ? (
                <div className="muted small">{[selected.contact_name, selected.phone].filter(Boolean).join(" · ")}</div>
              ) : null}
              {selected.needs_qb_setup ? <span className="pill warn" style={{ marginTop: 6 }}>New, not in QuickBooks yet</span> : null}
            </div>
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                onChange("");
                setFlash(null);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Change
            </button>
          </div>
        </div>
        {flash ? (
          <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{flash}</span></div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="cust-search">
        <Search size={18} className="cust-search-ic" aria-hidden="true" />
        <input
          ref={inputRef}
          className="input"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Type a customer name, account # or city"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          style={{ paddingLeft: 40 }}
        />
      </div>

      {open ? (
        <div className="list cust-list" id={listId} role="listbox" aria-label="Customers">
          {shown.map((c, i) => (
            <button
              key={c.id}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`item cust-opt${i === active ? " on" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t ellipsis">{c.name}</div>
                <div className="s ellipsis">
                  {[c.account_no, [c.city, c.state].filter(Boolean).join(", "), c.needs_qb_setup ? "new" : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
            </button>
          ))}
          {shown.length === 0 ? (
            <div className="item muted small">No customer matches “{query.trim()}”. Check the spelling, or add them below.</div>
          ) : more > 0 ? (
            <div className="item tiny faint">{more} more. Keep typing to narrow the list.</div>
          ) : null}
        </div>
      ) : null}

      <button type="button" className="btn dark sm" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
        <UserPlus size={16} /> Add new customer
      </button>
    </div>
  );
}

function NewCustomerForm({
  startName,
  branches,
  onCancel,
  onSaved,
}: {
  startName: string;
  branches: Branch[];
  onCancel: () => void;
  onSaved: (c: OrderCustomer, message: string) => void;
}) {
  const [name, setName] = useState(startName.trim());
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bill, setBill] = useState("");
  const [same, setSame] = useState(true);
  const [ship, setShip] = useState("");
  const [branchId, setBranchId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setError(null);
    start(async () => {
      const res = await addCustomer({ name, contact, phone, email, billAddress: bill, shipAddress: same ? "" : ship, branchId });
      if (res.ok) onSaved(res.customer, res.message);
      else setError(res.error);
    });
  };

  return (
    <div className="card col" style={{ gap: 12 }}>
      <div className="row between">
        <b>New customer</b>
        <button type="button" className="iconbtn" aria-label="Cancel" onClick={onCancel} style={{ width: 36, height: 36 }}>
          <X size={18} />
        </button>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        They can be used for this order right away. Accounting is emailed to set them up in QuickBooks.
      </p>
      <label className="field">
        <span className="label">Company name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="As it should appear on the invoice" />
      </label>
      <div className="grid2">
        <label className="field">
          <span className="label">Contact name</span>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Phone</span>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Home branch</span>
          <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Choose…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}, {b.state}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="label">Billing address</span>
        <textarea className="textarea" rows={3} value={bill} onChange={(e) => setBill(e.target.value)} placeholder="Street, city, state, ZIP" />
      </label>
      <label className="check">
        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> Shipping address is the same as billing
      </label>
      {!same ? (
        <label className="field">
          <span className="label">Shipping address</span>
          <textarea className="textarea" rows={3} value={ship} onChange={(e) => setShip(e.target.value)} placeholder="Street, city, state, ZIP" />
        </label>
      ) : null}
      {error ? (
        <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn sm" disabled={pending || name.trim().length < 2} onClick={save}>
          {pending ? "Saving…" : "Save customer"}
        </button>
        <button type="button" className="btn dark sm" onClick={onCancel} disabled={pending}>Cancel</button>
      </div>
    </div>
  );
}
