"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, LoaderCircle, Search, UserCheck } from "lucide-react";
import { assignCustomers } from "@/app/(app)/sales/actions";
import { HEALTH, kmoney, sinceText, type CrmCustomer, type Health } from "@/lib/crm-shared";
import { HealthPill, Spark, Trend } from "@/components/sales/bits";

type Sort = "health" | "sales" | "last" | "name" | "mtd";
const SORTS: { key: Sort; label: string }[] = [
  { key: "health", label: "Needs attention" },
  { key: "sales", label: "Biggest" },
  { key: "mtd", label: "This month" },
  { key: "last", label: "Longest since an order" },
  { key: "name", label: "A to Z" },
];
const FILTERS: (Health | "all")[] = ["all", "at_risk", "watch", "new", "healthy", "inactive", "no_history"];

/** A rep's customers (or everyone's, for admins): health, rhythm, money, and the 12-month shape. */
export function CustomerTable({ rows, showRep = false, reps = [], canAssign = false, start = "all" }: { rows: CrmCustomer[]; showRep?: boolean; reps?: { id: string; name: string }[]; canAssign?: boolean; start?: Health | "all" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [f, setF] = useState<Health | "all">(start);
  const [sort, setSort] = useState<Sort>("health");
  const [repF, setRepF] = useState("");
  const [pick, setPick] = useState<string[]>([]);
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const [limit, setLimit] = useState(80);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [rows]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (f === "all" || r.status === f) &&
        (!repF || (repF === "house" ? r.house || !r.rep_id : r.rep_id === repF)) &&
        (!s || r.name.toLowerCase().includes(s) || (r.city ?? "").toLowerCase().includes(s) || (r.rep_name ?? "").toLowerCase().includes(s)),
    );
    const by: Record<Sort, (a: CrmCustomer, b: CrmCustomer) => number> = {
      health: (a, b) => HEALTH[a.status].rank - HEALTH[b.status].rank || b.sales_12m - a.sales_12m,
      sales: (a, b) => b.sales_12m - a.sales_12m,
      mtd: (a, b) => b.sales_mtd - a.sales_mtd || b.sales_12m - a.sales_12m,
      last: (a, b) => (b.days_since ?? -1) - (a.days_since ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return out.sort(by[sort]);
  }, [rows, q, f, sort, repF]);

  const assign = () =>
    go(async () => {
      setMsg(null);
      const house = to === "house";
      const r = await assignCustomers(pick, house ? null : to, house);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: `${r.n} customer${r.n === 1 ? "" : "s"} now ${house ? "House accounts" : `with ${reps.find((x) => x.id === to)?.name ?? "the rep"}`}.` });
      setPick([]);
      router.refresh();
    });

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="crm-tools">
        <label className="xr-search grow" style={{ minWidth: 200 }}>
          <Search size={15} aria-hidden />
          <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer or city" aria-label="Find a customer" />
        </label>
        {showRep ? (
          <select className="select sm" value={repF} onChange={(e) => setRepF(e.target.value)} aria-label="Rep" style={{ width: 190 }}>
            <option value="">Every rep</option>
            <option value="house">House accounts</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : null}
        <label className="row" style={{ gap: 6 }}>
          <ArrowDownUp size={15} aria-hidden className="faint" />
          <select className="select sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" style={{ width: 210 }}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <div className="chips wrap" role="tablist" aria-label="Health">
        {FILTERS.map((k) => {
          const n = k === "all" ? rows.length : counts.get(k) ?? 0;
          if (k !== "all" && !n) return null;
          return (
            <button key={k} type="button" role="tab" aria-selected={f === k} className={`chip sm${f === k ? " on" : ""}`} onClick={() => setF(k)}>
              {k === "all" ? "All" : HEALTH[k].label} · {n}
            </button>
          );
        })}
      </div>
      {canAssign && pick.length ? (
        <div className="crm-assign" role="region" aria-label="Assign customers">
          <b className="small">{pick.length} picked</b>
          <select className="select sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Give them to" style={{ width: 200 }}>
            <option value="">Give them to…</option>
            <option value="house">House account</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="button" className="b2 sm" disabled={!to || pending} onClick={assign}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <UserCheck size={15} />} Assign
          </button>
          <button type="button" className="b2 quiet sm" onClick={() => setPick([])}>Clear</button>
        </div>
      ) : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`} role="status">{msg.text}</div> : null}
      <div className="tbl-wrap card2" style={{ padding: 0 }}>
        <table className="tbl crm-tbl">
          <thead>
            <tr>
              {canAssign ? (
                <th style={{ width: 34 }}>
                  <input type="checkbox" aria-label="Pick all shown" checked={list.length > 0 && list.slice(0, limit).every((r) => pick.includes(r.id))} onChange={(e) => setPick(e.target.checked ? [...new Set([...pick, ...list.slice(0, limit).map((r) => r.id)])] : [])} />
                </th>
              ) : null}
              <th>Customer</th>
              <th>Health</th>
              {showRep ? <th>Rep</th> : null}
              <th>Last order</th>
              <th className="num">Usually every</th>
              <th className="num">12 months</th>
              <th className="num">90 days</th>
              <th className="num">This month</th>
              <th>12-month shape</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r) => (
              <tr key={r.id} className={r.status === "at_risk" ? "crm-hot" : undefined}>
                {canAssign ? (
                  <td><input type="checkbox" aria-label={`Pick ${r.name}`} checked={pick.includes(r.id)} onChange={(e) => setPick(e.target.checked ? [...pick, r.id] : pick.filter((x) => x !== r.id))} /></td>
                ) : null}
                <td style={{ minWidth: 200 }}>
                  <Link href={`/sales/customers/${r.id}`} className="crm-name">{r.name}</Link>
                  {r.city ? <span className="tiny faint" style={{ display: "block" }}>{r.city}{r.state ? `, ${r.state}` : ""}</span> : null}
                </td>
                <td><HealthPill status={r.status} /></td>
                {showRep ? <td className="small">{r.house ? "House" : r.rep_name ?? <span className="faint">None</span>}</td> : null}
                <td className="small" style={{ whiteSpace: "nowrap" }}>{sinceText(r.days_since)}</td>
                <td className="num small">{r.usual_gap ? `${r.usual_gap} days` : <span className="faint">–</span>}</td>
                <td className="num"><b>{kmoney(r.sales_12m)}</b></td>
                <td className="num small"><Trend now={r.sales_90d} before={r.sales_prev_90d} /></td>
                <td className="num small">{r.sales_mtd ? kmoney(r.sales_mtd) : <span className="faint">–</span>}</td>
                <td><Spark values={r.monthly} label={`${r.name} by month`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No customers match.</p> : null}
      </div>
      {list.length > limit ? (
        <button type="button" className="b2 quiet sm" style={{ alignSelf: "center" }} onClick={() => setLimit((n) => n + 200)}>Show more ({list.length - limit} more)</button>
      ) : null}
    </div>
  );
}
