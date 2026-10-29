import Link from "next/link";
import { CircleAlert, CircleCheck, FileSpreadsheet, MapPin, Plus, Search, Undo2 } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { CLOSED } from "@/lib/ops/defaults";
import { addressLine, phoneText } from "@/lib/ops/crm";
import { Empty, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { undoImport } from "../crm-actions";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.crm);
  const q = (sp.q ?? "").trim().replace(/[\\%_,()]/g, " ").slice(0, 80);
  const kind = sp.k === "company" || sp.k === "person" ? sp.k : null;
  let query = supabase
    .from("ops_customers")
    .select("id, name, kind, phone, email, price_level, import_batch, created_at, properties:ops_properties(street, city, state, zip), leads:ops_leads(stage)", { count: "exact" })
    .eq("company_id", ws.company.id)
    .order("name")
    .limit(300);
  if (kind) query = query.eq("kind", kind);
  if (q) {
    const d = q.replace(/\D/g, "");
    const ors = [`name.ilike.%${q}%`, `email.ilike.%${q}%`];
    if (d.length >= 3) ors.push(`phone.ilike.%${d.slice(-4)}%`);
    query = query.or(ors.join(","));
  }
  const [{ data, count }, { data: lastImport }] = await Promise.all([
    query,
    opsCan.manage(ws.role)
      ? supabase.from("ops_customers").select("import_batch, created_at").eq("company_id", ws.company.id).not("import_batch", "is", null).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  type Row = { id: string; name: string; kind: string; phone: string | null; email: string | null; price_level: string; properties: { street: string | null; city: string | null; state: string | null; zip: string | null }[]; leads: { stage: string }[] };
  const rows = (data ?? []) as unknown as Row[];
  const batch = ((lastImport ?? []) as { import_batch: string; created_at: string }[])[0];
  const recentImport = batch && Date.now() - Date.parse(batch.created_at) < 3 * 86400000 ? batch.import_batch : null;
  const edit = opsCan.editCrm(ws.role);

  return (
    <main className="shell wide">
      <TopBar title="Customers" back="/ops" right={edit ? <Link href="/ops/customers/new" className="btn sm"><Plus size={16} /> New</Link> : undefined} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <form className="search" action="/ops/customers" style={{ flex: "1 1 260px" }}>
          <Search size={18} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Search name, phone or email" aria-label="Search customers" />
          {kind ? <input type="hidden" name="k" value={kind} /> : null}
        </form>
        <div className="chips">
          <Link href={`/ops/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={`chip${!kind ? " on" : ""}`}>All</Link>
          <Link href={`/ops/customers?k=person${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${kind === "person" ? " on" : ""}`}>Homeowners</Link>
          <Link href={`/ops/customers?k=company${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${kind === "company" ? " on" : ""}`}>Builders & companies</Link>
        </div>
        {opsCan.manage(ws.role) ? <Link href="/ops/customers/import" className="btn sm dark"><FileSpreadsheet size={15} /> Import</Link> : null}
      </div>
      {recentImport ? (
        <form action={undoImport} className="alert info small" style={{ alignItems: "center" }}>
          <input type="hidden" name="batch" value={recentImport} />
          <span className="grow">Imported a spreadsheet recently. Something off?</span>
          <Submit className="btn sm ghost" pendingText="Undoing…"><Undo2 size={14} /> Undo that import</Submit>
        </form>
      ) : null}

      {rows.length === 0 ? (
        q || kind ? (
          <div className="card muted small center">No customers match.</div>
        ) : (
          <Empty icon="users" title="No customers yet">
            Add them as leads come in, or bring your whole list in from a spreadsheet.
            {opsCan.manage(ws.role) ? <div style={{ marginTop: 12 }}><Link href="/ops/customers/import" className="btn sm"><FileSpreadsheet size={15} /> Import a spreadsheet</Link></div> : null}
          </Empty>
        )
      ) : (
        <>
          <span className="tiny faint">{count ?? rows.length} customer{(count ?? rows.length) === 1 ? "" : "s"}{(count ?? 0) > rows.length ? `, showing ${rows.length}. Search to narrow it down.` : ""}</span>
          <div className="list ops-cust-list">
            {rows.map((r) => {
              const open = r.leads.filter((l) => !CLOSED.includes(l.stage)).length;
              const won = r.leads.filter((l) => l.stage === "won").length;
              return (
                <Link key={r.id} href={`/ops/customers/${r.id}`} className="item">
                  <div className="ops-avatar">{r.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t ellipsis">{r.name}{r.price_level === "builder" ? <span className="pill grey" style={{ marginLeft: 8 }}>Builder</span> : null}</div>
                    <div className="s ellipsis">{[phoneText(r.phone), r.email].filter(Boolean).join(" · ") || "No phone or email"}</div>
                    {r.properties[0] ? <div className="tiny faint ellipsis"><MapPin size={11} /> {addressLine(r.properties[0])}{r.properties.length > 1 ? ` +${r.properties.length - 1}` : ""}</div> : null}
                  </div>
                  <span className="col tight" style={{ alignItems: "flex-end", flex: "none" }}>
                    {open ? <span className="pill">{open} open</span> : null}
                    {won ? <span className="tiny faint">{won} won</span> : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
