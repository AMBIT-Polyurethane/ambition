import Link from "next/link";
import { BookOpen, CircleAlert, CircleCheck, Copy, Plus, Ruler } from "lucide-react";
import { requireTakeoff } from "@/lib/takeoff/access";
import { TopBar } from "@/components/ui";
import { ConfirmSubmit, Submit } from "@/components/forms";
import { dateShort } from "@/lib/format";
import { createTakeoff, deleteTemplate } from "./actions";
import { STATUS_TEXT } from "@/lib/takeoff/calc";

export const metadata = { title: "Takeoff" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  customer: string | null;
  address: string | null;
  due_date: string | null;
  status: string;
  updated_at: string;
  created_by_name: string | null;
  takeoff_sheets: { count: number }[];
  takeoff_items: { count: number }[];
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In progress" },
  { id: "sent", label: "Sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export default async function TakeoffListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws, staff } = await requireTakeoff();
  // A contractor sees their workspace's takeoffs; AMBIT staff see AMBIT's (or, helping a contractor, theirs with ?ops=1).
  const inWs = Boolean(ws) && (!staff || sp.ops === "1");
  const f = FILTERS.some((x) => x.id === sp.f) ? sp.f! : "all";
  const q = (sp.q ?? "").trim().slice(0, 80);
  let query = supabase
    .from("takeoffs")
    .select("id, name, customer, address, due_date, status, updated_at, created_by_name, takeoff_sheets(count), takeoff_items(count)")
    .order("updated_at", { ascending: false })
    .limit(300);
  query = inWs ? query.eq("ops_company_id", ws!.company.id) : query.is("ops_company_id", null);
  query = query.eq("is_template", false);
  if (f !== "all") query = query.eq("status", f);
  if (q) {
    const like = `%${q.replace(/[\\%_,()]/g, " ")}%`;
    query = query.or(`name.ilike.${like},customer.ilike.${like},address.ilike.${like}`);
  }
  let tq = supabase.from("takeoffs").select("id, template_name, name, updated_at, takeoff_sheets(count), takeoff_items(count)").eq("is_template", true).order("template_name").limit(200);
  tq = inWs ? tq.eq("ops_company_id", ws!.company.id) : tq.is("ops_company_id", null);
  const [{ data, error }, { data: companies }, { data: tpl }] = await Promise.all([
    query,
    inWs
      ? supabase.from("ops_customers").select("name").eq("company_id", ws!.company.id).order("name").limit(2000)
      : supabase.from("companies").select("name").eq("active", true).order("name").limit(2000),
    tq,
  ]);
  const templates = (tpl ?? []) as unknown as { id: string; template_name: string | null; name: string; updated_at: string; takeoff_sheets: { count: number }[]; takeoff_items: { count: number }[] }[];
  const rows = (data ?? []) as unknown as Row[];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="shell wide">
      <TopBar
        title={inWs ? "Takeoffs" : "Takeoff"}
        back={inWs ? "/ops/quotes" : "/ops"}
        right={<Link href={`/takeoff/rules${inWs && staff ? "?ops=1" : ""}`} className="btn sm dark"><BookOpen size={15} /> AI rules</Link>}
      />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      {error ? <div className="alert warn small">Run supabase/migrations/0019_takeoff.sql in Supabase first (SQL Editor).</div> : null}

      <details className="card to-new" id="new" open={(rows.length === 0 && !q && f === "all") || Boolean(sp.template)}>
        <summary>
          <span className="to-new-ic" aria-hidden="true"><Plus size={20} /></span>
          <span className="grow col tight">
            <b>New takeoff</b>
            <span className="tiny faint">Name the job, then drop in the plan PDFs.</span>
          </span>
        </summary>
        <form action={createTakeoff} className="to-new-form">
          {inWs ? <input type="hidden" name="ops" value="1" /> : null}
          <label className="field">
            <span className="label">Project or job name</span>
            <input className="input" name="name" required maxLength={120} placeholder="Smith Residence" autoComplete="off" />
          </label>
          <label className="field">
            <span className="label">Customer</span>
            <input className="input" name="customer" list="to-customers" maxLength={120} placeholder="Who it's for (optional)" autoComplete="off" />
            <datalist id="to-customers">
              {((companies ?? []) as { name: string }[]).map((c) => <option key={c.name} value={c.name} />)}
            </datalist>
          </label>
          <label className="field">
            <span className="label">Job address</span>
            <input className="input" name="address" maxLength={240} placeholder="Optional" autoComplete="off" />
          </label>
          <label className="field">
            <span className="label">Bid due</span>
            <input className="input" type="date" name="due" />
          </label>
          {templates.length ? (
            <label className="field">
              <span className="label">Start from</span>
              <select className="select" name="template" defaultValue={sp.template ?? ""}>
                <option value="">Blank: add the plans</option>
                {templates.map((x) => <option key={x.id} value={x.id}>Template: {x.template_name || x.name}</option>)}
              </select>
            </label>
          ) : null}
          <Submit className="btn">Create</Submit>
        </form>
      </details>

      <form className="row" style={{ gap: 10, flexWrap: "wrap" }} action="/takeoff">
        <div className="search" style={{ flex: "1 1 260px" }}>
          <Ruler size={18} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Search jobs, customers, addresses" aria-label="Search takeoffs" />
        </div>
        {f !== "all" ? <input type="hidden" name="f" value={f} /> : null}
        {inWs && staff ? <input type="hidden" name="ops" value="1" /> : null}
      </form>
      <div className="chips" role="tablist" aria-label="Show">
        {FILTERS.map((x) => (
          <Link key={x.id} href={`/takeoff?f=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}${inWs && staff ? "&ops=1" : ""}`} className={`chip${x.id === f ? " on" : ""}`} role="tab" aria-selected={x.id === f}>
            {x.label}
          </Link>
        ))}
      </div>

      {templates.length ? (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 800 }}><Copy size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Templates · {templates.length}</summary>
          <p className="tiny faint" style={{ margin: "6px 0 10px" }}>
            Plans built over and over. A new takeoff started from one copies its plans, shapes and quantities (no AI needed): check it and adjust. Save one from a
            takeoff&apos;s Report page.
          </p>
          <div className="list">
            {templates.map((x) => (
              <div key={x.id} className="item">
                <div className="grow col tight" style={{ minWidth: 0 }}>
                  <b className="ellipsis">{x.template_name || x.name}</b>
                  <span className="tiny faint">{x.takeoff_sheets[0]?.count ?? 0} sheets · {x.takeoff_items[0]?.count ?? 0} items · saved {dateShort(x.updated_at)}</span>
                </div>
                <Link href={`/takeoff?template=${x.id}${inWs && staff ? "&ops=1" : ""}#new`} className="btn sm">Use</Link>
                <Link href={`/takeoff/${x.id}`} className="btn sm dark">Open</Link>
                <form action={deleteTemplate}>
                  <input type="hidden" name="id" value={x.id} />
                  <ConfirmSubmit className="btn sm dark" pendingText="…" confirm={`Delete the template "${x.template_name || x.name}"? Takeoffs started from it stay.`}>Delete</ConfirmSubmit>
                </form>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {rows.length === 0 ? (
        <div className="card muted small center">{q || f !== "all" ? "No takeoffs match." : "No takeoffs yet. Start one above."}</div>
      ) : (
        <div className="list to-list">
          <div className="to-row head" aria-hidden="true">
            <span>Job</span><span>Customer</span><span>Sheets</span><span>Status</span><span>Bid due</span><span>Updated</span>
          </div>
          {rows.map((r) => {
            const st = STATUS_TEXT[r.status] ?? STATUS_TEXT.in_progress;
            const late = r.due_date && r.due_date < today && r.status === "in_progress";
            return (
              <Link key={r.id} href={`/takeoff/${r.id}`} className="to-row">
                <span className="col tight" style={{ minWidth: 0 }}>
                  <b className="ellipsis">{r.name}</b>
                  <span className="tiny faint ellipsis">{r.address || `${r.takeoff_items[0]?.count ?? 0} items measured`}</span>
                </span>
                <span className="ellipsis muted">{r.customer || "–"}</span>
                <span className="muted">{r.takeoff_sheets[0]?.count ?? 0}</span>
                <span><span className={st.cls}>{st.label}</span></span>
                <span className={late ? "warn-text" : "muted"}>{r.due_date ? dateShort(r.due_date) : "–"}</span>
                <span className="tiny faint">{dateShort(r.updated_at)}{r.created_by_name ? ` · ${r.created_by_name.split(" ")[0]}` : ""}</span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
