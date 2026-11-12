"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Search } from "lucide-react";
import { money } from "@/lib/format";
import { saveFloors } from "@/app/(app)/price-requests/native-actions";

type P = { id: string; sku: string; name: string; unit: string; cat: string | null; list: number | null };

/** Admins: the lowest price the rules can approve for each product (only price approvers ever see these). */
export function FloorPrices({ categories, products, floors }: { categories: { id: string; name: string }[]; products: P[]; floors: Record<string, number> }) {
  const [cat, setCat] = useState(categories[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = products.filter((p) => (words.length ? words.every((w) => `${p.sku} ${p.name}`.toLowerCase().includes(w)) : p.cat === cat)).slice(0, 200);
  const val = (p: P) => (p.id in edit ? edit[p.id] : floors[p.id] !== undefined ? String(floors[p.id]) : "");
  const changed = Object.keys(edit).filter((id) => (edit[id] === "" ? floors[id] !== undefined : Number(edit[id]) !== floors[id]));
  const save = () =>
    go(async () => {
      const res = await saveFloors(changed.map((id) => ({ product_id: id, floor: edit[id] })));
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setMsg({ ok: true, text: `Saved ${changed.length} floor ${changed.length === 1 ? "price" : "prices"}.` });
      setEdit({});
    });
  return (
    <section className="section">
      <div className="eyebrow">Floor prices</div>
      <div className="card col" style={{ gap: 10 }}>
        <span className="tiny muted">The lowest price the rules may approve. Blank = no floor. Reps never see these.</span>
        <div className="search"><Search size={18} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any product" aria-label="Search products" /></div>
        {!words.length ? (
          <div className="chips">
            {categories.map((c) => <button key={c.id} type="button" className={`chip sm${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
        ) : null}
        <div className="list">
          {shown.map((p) => (
            <div key={p.id} className="item" style={{ gap: 10 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t ellipsis" style={{ fontSize: 14 }}>{p.name}</div>
                <div className="s ellipsis">{p.sku} · {p.list !== null ? `list ${money(p.list)}` : "no list price"} / {p.unit}</div>
              </div>
              <input className="input sm" style={{ width: 100, textAlign: "right" }} inputMode="decimal" value={val(p)} placeholder="No floor" onChange={(e) => setEdit((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.]/g, "") }))} aria-label={`Floor price for ${p.name}`} />
            </div>
          ))}
        </div>
        {msg ? <div className={`alert small ${msg.ok ? "ok" : "err"}`}>{msg.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}<span>{msg.text}</span></div> : null}
        <button type="button" className="btn" disabled={pending || !changed.length} onClick={save}>{pending ? "Saving…" : `Save floor prices${changed.length ? ` (${changed.length})` : ""}`}</button>
      </div>
    </section>
  );
}
