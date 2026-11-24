"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, LoaderCircle, Phone, Search, UserCheck } from "lucide-react";
import { assignCalls, saveCall } from "@/app/(app)/sales/actions";
import { kmoney } from "@/lib/crm-shared";
import { gone, isDone, isDue, outcomes, shortDay, statusText, type Call, type CallList as ListKey, type Outcome } from "@/lib/calls-shared";

type Tab = ListKey | "due";
type Show = "open" | "new" | "done" | "all";
type Sort = "priority" | "sales" | "gone" | "next" | "place" | "name";
const PRI: Record<string, number> = { A: 0, B: 1, C: 2 };
const SORTS: Record<ListKey, { key: Sort; label: string }[]> = {
  winback: [
    { key: "priority", label: "Priority, then biggest" },
    { key: "sales", label: "Biggest first" },
    { key: "gone", label: "Longest gone" },
    { key: "next", label: "Next call due" },
    { key: "name", label: "A to Z" },
  ],
  cold: [
    { key: "place", label: "State and city" },
    { key: "next", label: "Next call due" },
    { key: "name", label: "A to Z" },
  ],
};
const digits = (p: string) => p.replace(/[^\d]/g, "").slice(-10);
const firstPhone = (p: string | null) => {
  const m = p ? /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.exec(p)?.[0] ?? "" : "";
  return /^\d{10}$/.test(m) ? `(${m.slice(0, 3)}) ${m.slice(3, 6)}-${m.slice(6)}` : m;
};

/** One rep's call lists (or everyone's, for admins): Win-back, Cold leads, and call-backs that are due. */
export function CallList({ rows: start, today, showRep = false, reps = [], canAssign = false, tab: tab0 = "winback" }: { rows: Call[]; today: string; showRep?: boolean; reps?: { id: string; name: string }[]; canAssign?: boolean; tab?: Tab }) {
  const router = useRouter();
  const [rows, setRows] = useState(start);
  const [tab, setTab] = useState<Tab>(tab0);
  const [show, setShow] = useState<Show>("open");
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("");
  const [st, setSt] = useState("");
  const [kind, setKind] = useState("");
  const [repF, setRepF] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [limit, setLimit] = useState(60);
  const [pick, setPick] = useState<number[]>([]);
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: React.ReactNode } | null>(null);
  const [pending, go] = useTransition();

  const list: ListKey = tab === "due" ? "winback" : tab;
  const counts = useMemo(() => ({
    winback: rows.filter((r) => r.list === "winback" && !isDone(r)).length,
    cold: rows.filter((r) => r.list === "cold" && !isDone(r)).length,
    due: rows.filter((r) => isDue(r, today)).length,
  }), [rows, today]);
  const base = useMemo(() => rows.filter((r) => (tab === "due" ? isDue(r, today) : r.list === tab) && (!repF || r.rep_id === repF)), [rows, tab, today, repF]);
  const states = useMemo(() => [...new Set(base.map((r) => r.state).filter(Boolean) as string[])].sort(), [base]);
  const kinds = useMemo(() => [...new Set(base.map((r) => r.kind_guess).filter(Boolean) as string[])].sort(), [base]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const d = s ? digits(s) : "";
    const out = base.filter(
      (r) =>
        (show === "all" || (show === "open" ? !isDone(r) : show === "new" ? r.status === "new" : isDone(r))) &&
        (!src || (r.source ?? "").includes(src)) &&
        (!st || r.state === st) &&
        (!kind || r.kind_guess === kind) &&
        (!s || r.name.toLowerCase().includes(s) || (r.city ?? "").toLowerCase().includes(s) || (r.contact_name ?? "").toLowerCase().includes(s) || (d.length >= 4 && digits(r.phone ?? "").includes(d))),
    );
    const nextKey = (r: Call) => (r.next_on && !isDone(r) ? r.next_on : "9999");
    const by: Record<Sort, (a: Call, b: Call) => number> = {
      priority: (a, b) => (PRI[a.priority ?? ""] ?? 3) - (PRI[b.priority ?? ""] ?? 3) || (b.sales_12mo ?? 0) - (a.sales_12mo ?? 0),
      sales: (a, b) => (b.sales_12mo ?? 0) - (a.sales_12mo ?? 0),
      gone: (a, b) => (a.last_invoice ?? "9999").localeCompare(b.last_invoice ?? "9999"),
      next: (a, b) => nextKey(a).localeCompare(nextKey(b)) || a.name.localeCompare(b.name),
      place: (a, b) => (a.state ?? "").localeCompare(b.state ?? "") || (a.kind_guess === "Insulation / foam" ? 0 : 1) - (b.kind_guess === "Insulation / foam" ? 0 : 1) || (a.city ?? "").localeCompare(b.city ?? "") || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    const sorter = tab === "due" ? by.next : by[SORTS[list].some((x) => x.key === sort) ? sort : SORTS[list][0].key];
    return out.sort(sorter);
  }, [base, q, show, src, st, kind, sort, tab, list]);

  const switchTab = (t: Tab) => {
    setTab(t); setLimit(60); setPick([]); setSrc(""); setSt(""); setKind(""); setMsg(null);
    setSort(t === "cold" ? "place" : t === "due" ? "next" : "priority");
  };
  const logged = (id: number, outcome: Outcome, note: string, next: string | null, lead: string | null) => {
    const name = rows.find((r) => r.id === id)?.name ?? "";
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: outcome, next_on: ["not_interested", "wrong_number", "won"].includes(outcome) ? null : next, touches: r.touches + 1, last_touch_at: new Date().toISOString(), last_note: note || r.last_note } : r)));
    if (outcome === "won" && lead) setMsg({ ok: true, text: <>{name} is in your <Link href="/sales/pipeline">New-customer pipeline</Link> now.</> });
    else if (outcome === "won") setMsg({ ok: true, text: <>Saved. {name} wants to order: start it from their page.</> });
    else setMsg(null);
    router.refresh();
  };
  const assign = () =>
    go(async () => {
      const r = await assignCalls(pick, to);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      const nm = reps.find((x) => x.id === to)?.name ?? "the rep";
      setRows((rs) => rs.map((x) => (pick.includes(x.id) ? { ...x, rep_id: to, rep_name: nm } : x)));
      setMsg({ ok: true, text: `${r.n} call${r.n === 1 ? "" : "s"} moved to ${nm}.` });
      setPick([]);
      router.refresh();
    });

  const page = shown.slice(0, limit);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="call-tabs" role="tablist" aria-label="Lists">
        <button type="button" role="tab" aria-selected={tab === "winback"} className={`call-tab${tab === "winback" ? " on" : ""}`} onClick={() => switchTab("winback")}>
          <b>Win-back · {counts.winback}</b><span>Past customers who stopped ordering</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "cold"} className={`call-tab${tab === "cold" ? " on" : ""}`} onClick={() => switchTab("cold")}>
          <b>Cold leads · {counts.cold}</b><span>BBB and ConstructConnect contractors</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "due"} className={`call-tab${tab === "due" ? " on" : ""}${counts.due ? " due" : ""}`} onClick={() => switchTab("due")}>
          <b>Call-backs due · {counts.due}</b><span>Today or overdue, from both lists</span>
        </button>
      </div>

      <div className="crm-tools">
        <label className="xr-search grow" style={{ minWidth: 200 }}>
          <Search size={15} aria-hidden />
          <input className="input sm" value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} placeholder="Find a company, city, contact or phone" aria-label="Find" />
        </label>
        {showRep ? (
          <select className="select sm" value={repF} onChange={(e) => setRepF(e.target.value)} aria-label="Rep" style={{ width: 180 }}>
            <option value="">Every rep</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : null}
        {tab === "cold" ? (
          <>
            <select className="select sm" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Found on" style={{ width: 170 }}>
              <option value="">All sources</option>
              <option value="BBB">BBB</option>
              <option value="ConstructConnect">ConstructConnect</option>
            </select>
            <select className="select sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of business" style={{ width: 170 }}>
              <option value="">Every kind</option>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </>
        ) : null}
        <select className="select sm" value={st} onChange={(e) => setSt(e.target.value)} aria-label="State" style={{ width: 110 }}>
          <option value="">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {tab !== "due" ? (
          <label className="row" style={{ gap: 6 }}>
            <ArrowDownUp size={15} aria-hidden className="faint" />
            <select className="select sm" value={SORTS[list].some((x) => x.key === sort) ? sort : SORTS[list][0].key} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" style={{ width: 190 }}>
              {SORTS[list].map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {tab !== "due" ? (
        <div className="chips wrap" role="tablist" aria-label="Which calls">
          {([["open", "Still to work"], ["new", "Not called yet"], ["done", "Finished"], ["all", "All"]] as [Show, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} className={`chip sm${show === k ? " on" : ""}`} onClick={() => { setShow(k); setLimit(60); }}>
              {l} · {base.filter((r) => (k === "all" ? true : k === "open" ? !isDone(r) : k === "new" ? r.status === "new" : isDone(r))).length}
            </button>
          ))}
        </div>
      ) : null}

      {canAssign && pick.length ? (
        <div className="crm-assign" role="region" aria-label="Move calls">
          <b className="small">{pick.length} picked</b>
          <select className="select sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Give them to" style={{ width: 200 }}>
            <option value="">Give them to…</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="button" className="b2 sm" disabled={!to || pending} onClick={assign}>{pending ? <LoaderCircle size={15} className="spin" /> : <UserCheck size={15} />} Move</button>
          <button type="button" className="b2 quiet sm" onClick={() => setPick([])}>Clear</button>
        </div>
      ) : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`} role="status"><span>{msg.text}</span></div> : null}

      <div className="tbl-wrap card2" style={{ padding: 0 }}>
        <table className="tbl crm-tbl call-tbl">
          <thead>
            <tr>
              {canAssign ? (
                <th style={{ width: 34 }}>
                  <input type="checkbox" aria-label="Pick all shown" checked={page.length > 0 && page.every((r) => pick.includes(r.id))} onChange={(e) => setPick(e.target.checked ? [...new Set([...pick, ...page.map((r) => r.id)])] : [])} />
                </th>
              ) : null}
              <th>{list === "cold" && tab !== "due" ? "Contractor" : "Company"}</th>
              {tab === "cold" ? <th>Found on</th> : tab === "due" ? <th>Found on / last order</th> : <th>Last order</th>}
              {tab === "cold" || tab === "due" ? <th>Details</th> : <th className="num">Sales 12 mo</th>}
              {showRep ? <th>Rep</th> : null}
              <th>Last touch</th>
              <th>Log the call</th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <CallRow key={r.id} r={r} today={today} showRep={showRep} pickable={canAssign} picked={pick.includes(r.id)} onPick={(v) => setPick(v ? [...pick, r.id] : pick.filter((x) => x !== r.id))} onLogged={logged} />
            ))}
            {!page.length ? (
              <tr><td colSpan={7} className="small muted" style={{ padding: 18 }}>{tab === "due" ? "No call-backs due. Nice." : rows.length ? "Nothing matches." : "No calls on this list yet."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {shown.length > limit ? (
        <button type="button" className="b2 quiet sm" style={{ alignSelf: "center" }} onClick={() => setLimit((l) => l + 60)}>Show {Math.min(60, shown.length - limit)} more of {shown.length - limit}</button>
      ) : null}
    </div>
  );
}

function CallRow({ r, today, showRep, pickable, picked, onPick, onLogged }: { r: Call; today: string; showRep: boolean; pickable: boolean; picked: boolean; onPick: (v: boolean) => void; onLogged: (id: number, o: Outcome, note: string, next: string | null, lead: string | null) => void }) {
  const cold = r.list === "cold";
  const [open, setOpen] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [pending, go] = useTransition();
  const s = statusText(r);
  const phone = firstPhone(r.phone);
  const save = (o: Outcome, n = note, d = next) =>
    go(async () => {
      setErr("");
      if (o === "callback" && !d) return setErr("Pick the day to call back.");
      const res = await saveCall({ id: r.id, outcome: o, note: n, next_on: d || null });
      if (!res.ok) return setErr(res.error);
      onLogged(r.id, o, n.trim(), d || null, res.lead_id);
      setOpen(null); setNote(""); setNext("");
    });
  const tap = (o: { key: Outcome; needs?: "date" | "note" }) => (o.needs ? (setOpen(open === o.key ? null : o.key), setErr("")) : save(o.key, "", ""));
  const cols = 5 + (pickable ? 1 : 0) + (showRep ? 1 : 0);
  return (
    <>
      <tr className={isDue(r, today) ? "crm-hot" : isDone(r) ? "call-done" : undefined}>
        {pickable ? <td><input type="checkbox" aria-label={`Pick ${r.name}`} checked={picked} onChange={(e) => onPick(e.target.checked)} /></td> : null}
        <td style={{ minWidth: 220 }}>
          <Link href={`/sales/calls/${r.id}`} className="crm-name">{r.name}</Link>
          <span className="tiny faint" style={{ display: "block" }}>
            {[r.city, r.state].filter(Boolean).join(", ")}
            {phone ? <> · <a href={`tel:${digits(phone)}`} className="call-tel"><Phone size={11} aria-hidden /> {phone}</a></> : <> · no phone</>}
          </span>
          {r.contact_name ? <span className="tiny muted" style={{ display: "block" }}>{r.contact_name}</span> : null}
        </td>
        {r.list === "cold" ? (
          <td style={{ whiteSpace: "nowrap" }}>
            <span className="row wrap" style={{ gap: 4 }}>
              {(r.source ?? "").split("+").map((x) => x.trim()).filter(Boolean).map((x) => <span key={x} className={`pill ${x === "BBB" ? "info" : "warn"}`}>{x}</span>)}
            </span>
            {r.kind_guess ? <span className="tiny faint" style={{ display: "block", marginTop: 3 }}>{r.kind_guess}</span> : null}
          </td>
        ) : (
          <td style={{ whiteSpace: "nowrap" }}>
            <b className="small">{gone(r.last_invoice, today)}</b>
            <span className="tiny faint" style={{ display: "block" }}>{r.last_invoice ? shortDay(r.last_invoice) + ", " + r.last_invoice.slice(0, 4) : ""}{r.priority ? ` · Priority ${r.priority}` : ""}</span>
          </td>
        )}
        {r.list === "cold" ? (
          <td style={{ minWidth: 180 }} className="tiny muted">
            {r.email ? <span style={{ display: "block" }}>{r.email}</span> : null}
            {r.street ? <span style={{ display: "block" }}>{r.street}{r.zip ? ` ${r.zip}` : ""}</span> : null}
            {!r.email && !r.street ? <span className="faint">–</span> : null}
          </td>
        ) : (
          <td className="num">
            <b>{r.sales_12mo ? kmoney(r.sales_12mo) : <span className="faint">–</span>}</b>
            {r.prev_rep ? <span className="tiny faint" style={{ display: "block" }}>was {r.prev_rep}</span> : null}
          </td>
        )}
        {showRep ? <td className="small">{r.rep_name ?? <span className="faint">None</span>}</td> : null}
        <td style={{ minWidth: 170, maxWidth: 260 }}>
          <span className={`pill ${s.tone}`}>{s.label}</span>
          {r.last_note && r.status !== "new" ? <span className="tiny muted call-note">{r.last_note}</span> : null}
          {r.sheet_note ? <span className="tiny warn-text call-note">{r.sheet_note}</span> : null}
        </td>
        <td>
          <div className="call-outs">
            {outcomes(r.list).map((o) => (
              <button key={o.key} type="button" className={`call-out${o.key === "won" ? " good" : ""}${open === o.key ? " on" : ""}`} disabled={pending} onClick={() => tap(o)} aria-expanded={o.needs ? open === o.key : undefined}>
                {o.label}
              </button>
            ))}
            {pending && !open ? <LoaderCircle size={15} className="spin faint" aria-label="Saving" /> : null}
          </div>
          {err && !open ? <span className="tiny red" style={{ display: "block", marginTop: 4 }}>{err}</span> : null}
        </td>
      </tr>
      {open ? (
        <tr className="call-panel">
          <td colSpan={cols}>
            <div className="call-panel-in">
              <label className="field grow" style={{ minWidth: 240 }}>
                <span className="label">{open === "won" ? (cold ? "What are they interested in?" : "What do they want to order?") : open === "callback" ? "Why call back? (optional)" : "What did they say?"}</span>
                <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder={open === "not_interested" ? "For example: happy with their supplier, price, no work" : "In your own words"} />
              </label>
              {open !== "not_interested" && open !== "won" ? (
                <label className="field" style={{ width: 170 }}>
                  <span className="label">{open === "callback" ? "Call back on" : "Call back on (optional)"}</span>
                  <input className="input" type="date" min={today} value={next} onChange={(e) => setNext(e.target.value)} />
                </label>
              ) : null}
              <div className="row" style={{ gap: 8, alignSelf: "flex-end" }}>
                <button type="button" className="b2 sm" disabled={pending} onClick={() => save(open)}>{pending ? <LoaderCircle size={15} className="spin" /> : null} Save</button>
                <button type="button" className="b2 quiet sm" onClick={() => { setOpen(null); setErr(""); }}>Cancel</button>
              </div>
              {open === "won" ? <span className="tiny muted" style={{ flexBasis: "100%" }}>{cold ? "Saving adds them to your New-customer pipeline as a new lead." : "Saving marks them won back. Start the order from their page."}</span> : null}
              {err ? <span className="tiny red" style={{ flexBasis: "100%" }}>{err}</span> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
