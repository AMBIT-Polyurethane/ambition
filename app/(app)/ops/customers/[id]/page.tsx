import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CircleAlert, CircleCheck, Mail, MapPin, MessageSquare, Phone, Plus, Trash2 } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { stageName } from "@/lib/ops/defaults";
import { addressLine, mapsUrl, money0, phoneText, type OpsCustomer, type OpsNote, type OpsProperty } from "@/lib/ops/crm";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { AddressFields, ContactFields, NameFields } from "@/components/ops/customer-fields";
import { dateShort, dateTime } from "@/lib/format";
import { addNote, deleteCustomer, deleteNote, deleteProperty, saveProperty, updateCustomer } from "../../crm-actions";

export const metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile, ws } = await requireOps(opsCan.crm);
  const { data: c } = await supabase.from("ops_customers").select("*").eq("id", id).maybeSingle<OpsCustomer>();
  if (!c) notFound();
  const [{ data: props }, { data: leadRows }, { data: noteRows }, { data: quoteRows }] = await Promise.all([
    supabase.from("ops_properties").select("*").eq("customer_id", id).order("created_at"),
    supabase.from("ops_leads").select("id, number, title, stage, services, value_est, created_at, property_id").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("ops_notes").select("*").eq("customer_id", id).is("lead_id", null).neq("kind", "task").order("created_at", { ascending: false }).limit(100),
    supabase.from("ops_quotes").select("id, number, title, status, totals, signed_total, updated_at").eq("customer_id", id).order("created_at", { ascending: false }),
  ]);
  const quotes = (quoteRows ?? []) as { id: string; number: number; title: string | null; status: string; totals: { options?: Record<string, { total: number }> }; signed_total: number | null; updated_at: string }[];
  const properties = (props ?? []) as OpsProperty[];
  const leads = (leadRows ?? []) as { id: string; number: number; title: string | null; stage: string; services: string[]; value_est: number | null; created_at: string; property_id: string | null }[];
  const notes = (noteRows ?? []) as OpsNote[];
  const edit = opsCan.editCrm(ws.role);
  const back = `/ops/customers/${id}`;

  return (
    <main className="shell wide">
      <TopBar title={c.name} back="/ops/customers" right={edit ? <Link href={`/ops/leads/new?customer=${id}`} className="btn sm"><Plus size={16} /> New lead</Link> : undefined} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="card col" style={{ gap: 10 }}>
        <span className="col tight">
          <span className="eyebrow">{c.kind === "company" ? "Builder / company" : "Homeowner"}{c.price_level === "builder" ? " · builder prices" : ""}{c.tax_exempt ? " · tax exempt" : ""}</span>
          <span className="small muted">{[c.source ? `From ${c.source}` : null, `customer since ${dateShort(c.created_at)}`].filter(Boolean).join(" · ")}</span>
        </span>
        <div className="ops-contact">
          {c.phone ? <a href={`tel:${c.phone}`} className="btn sm dark"><Phone size={15} /> {phoneText(c.phone)}</a> : null}
          {c.phone ? <a href={`sms:${c.phone}`} className="btn sm dark"><MessageSquare size={15} /> Text</a> : null}
          {c.email ? <a href={`mailto:${c.email}`} className="btn sm dark"><Mail size={15} /> {c.email}</a> : null}
        </div>
        {c.notes ? <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.notes}</p> : null}
      </section>

      <div className="ops-lead">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Jobs and leads ({leads.length})</div>
            {leads.length ? (
              <div className="list">
                {leads.map((l) => (
                  <Link key={l.id} href={`/ops/leads/${l.id}`} className="item">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t ellipsis">#{l.number} · {l.title || l.services.join(", ") || "Lead"}</div>
                      <div className="s ellipsis">{[addressLine(properties.find((p) => p.id === l.property_id)), dateShort(l.created_at), money0(l.value_est)].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span className={`pill${l.stage === "won" ? " ok" : l.stage === "lost" ? " grey" : ""}`}>{stageName(ws.settings, l.stage)}</span>
                    <ChevronRight size={18} className="chev" />
                  </Link>
                ))}
              </div>
            ) : (
              <span className="small muted">No leads yet.</span>
            )}
          </section>

          {quotes.length ? (
            <section className="col" style={{ gap: 8 }}>
              <div className="eyebrow">Quotes ({quotes.length})</div>
              <div className="list">
                {quotes.map((q) => (
                  <Link key={q.id} href={`/ops/quotes/${q.id}`} className="item">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t ellipsis">#{q.number}{q.title ? ` · ${q.title}` : ""}</div>
                      <div className="s ellipsis">{dateShort(q.updated_at)}</div>
                    </div>
                    <b>{money0(q.signed_total ?? Math.max(0, ...Object.values(q.totals?.options ?? {}).map((o) => o.total)))}</b>
                    <span className={`pill${q.status === "signed" ? " ok" : q.status === "draft" || q.status === "declined" ? " grey" : " warn"}`}>{q.status === "viewed" ? "Opened" : q.status[0].toUpperCase() + q.status.slice(1)}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Addresses ({properties.length})</div>
            {properties.map((p) => (
              <details key={p.id} className="card ops-prop">
                <summary>
                  <MapPin size={16} />
                  <span className="grow col tight" style={{ minWidth: 0 }}>
                    <b className="ellipsis">{p.label ? `${p.label}: ` : ""}{addressLine(p) || "No street yet"}</b>
                    {p.gate_code || p.notes ? <span className="tiny faint ellipsis">{[p.gate_code ? `Gate ${p.gate_code}` : null, p.notes].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  <a href={mapsUrl(p)} target="_blank" rel="noopener noreferrer" className="linkbtn tiny">Map</a>
                </summary>
                {edit ? (
                  <form action={saveProperty} className="col" style={{ gap: 10, marginTop: 10 }}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="customer_id" value={id} />
                    <AddressFields required defaults={{ street: p.street ?? "", city: p.city ?? "", state: p.state ?? "", zip: p.zip ?? "" }} />
                    <div className="grid2">
                      <input className="input sm" name="label" defaultValue={p.label ?? ""} placeholder="Label: Home, Lot 12…" maxLength={60} />
                      <input className="input sm" name="gate_code" defaultValue={p.gate_code ?? ""} placeholder="Gate code" maxLength={60} />
                    </div>
                    <input className="input sm" name="property_notes" defaultValue={p.notes ?? ""} placeholder="Notes for the crew: dogs, parking, attic access…" maxLength={1000} />
                    <div className="row" style={{ gap: 8 }}>
                      <Submit className="btn sm" pendingText="Saving…">Save address</Submit>
                    </div>
                  </form>
                ) : null}
                {opsCan.remove(ws.role) ? (
                  <form action={deleteProperty} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="customer_id" value={id} />
                    <button type="submit" className="linkbtn tiny">Remove this address</button>
                  </form>
                ) : null}
              </details>
            ))}
            {edit ? (
              <details className="card ops-prop">
                <summary><Plus size={16} /> <span className="grow">Add an address</span></summary>
                <form action={saveProperty} className="col" style={{ gap: 10, marginTop: 10 }}>
                  <input type="hidden" name="customer_id" value={id} />
                  <AddressFields required />
                  <div className="grid2">
                    <input className="input sm" name="label" placeholder="Label: Home, Lot 12…" maxLength={60} />
                    <input className="input sm" name="gate_code" placeholder="Gate code" maxLength={60} />
                  </div>
                  <Submit className="btn sm" pendingText="Saving…">Add address</Submit>
                </form>
              </details>
            ) : null}
          </section>

          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Notes</div>
            {edit ? (
              <form action={addNote} className="card col" style={{ gap: 8 }}>
                <input type="hidden" name="customer_id" value={id} />
                <input type="hidden" name="kind" value="note" />
                <textarea className="textarea" name="body" rows={2} maxLength={4000} placeholder="A note about this customer" required />
                <Submit className="btn sm" pendingText="Saving…">Add note</Submit>
              </form>
            ) : null}
            {notes.map((n) => (
              <div key={n.id} className="card small row" style={{ gap: 10, alignItems: "flex-start" }}>
                <span className="grow col tight" style={{ minWidth: 0 }}>
                  <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span>
                  <span className="tiny faint">{n.created_by_name} · {dateTime(n.created_at)}</span>
                </span>
                {edit && (n.created_by === profile.id || opsCan.remove(ws.role)) ? (
                  <form action={deleteNote}>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="back" value={back} />
                    <button type="submit" className="iconbtn sm" aria-label="Delete note"><Trash2 size={14} /></button>
                  </form>
                ) : null}
              </div>
            ))}
          </section>
        </div>

        <aside className="col" style={{ gap: 14, minWidth: 0 }}>
          {edit ? (
            <section className="card col" style={{ gap: 10 }}>
              <b>Contact info</b>
              <form action={updateCustomer} className="col" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={id} />
                <NameFields kind={c.kind} defaults={{ first_name: c.first_name ?? (c.kind === "person" ? c.name : ""), last_name: c.last_name ?? "", company_name: c.company_name ?? c.name }} />
                <ContactFields defaults={{ phone: c.phone ?? "", email: c.email ?? "" }} />
                <label className="field">
                  <span className="label">Second phone</span>
                  <input className="input sm" name="phone2" defaultValue={c.phone2 ?? ""} inputMode="tel" />
                </label>
                <div className="grid2">
                  <label className="field">
                    <span className="label">Source</span>
                    <select className="select sm" name="source" defaultValue={c.source ?? ""}>
                      <option value="">–</option>
                      {[...new Set([...(c.source ? [c.source] : []), ...ws.settings.sources])].map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Prices</span>
                    <select className="select sm" name="price_level" defaultValue={c.price_level}>
                      <option value="retail">Retail</option>
                      <option value="builder">Builder</option>
                    </select>
                  </label>
                </div>
                <label className="check"><input type="checkbox" name="tax_exempt" defaultChecked={c.tax_exempt} /> Tax exempt</label>
                <label className="field">
                  <span className="label">Notes</span>
                  <textarea className="textarea" name="customer_notes" rows={2} defaultValue={c.notes ?? ""} maxLength={2000} />
                </label>
                <Submit className="btn sm dark" pendingText="Saving…">Save</Submit>
              </form>
            </section>
          ) : null}
          {opsCan.remove(ws.role) ? (
            <details className="ops-more danger-zone">
              <summary className="tiny faint">Delete this customer</summary>
              <form action={deleteCustomer} className="col" style={{ gap: 8, marginTop: 8 }}>
                <input type="hidden" name="id" value={id} />
                {leads.length ? <label className="check small"><input type="checkbox" name="sure" value="1" /> Delete their {leads.length} lead{leads.length === 1 ? "" : "s"} too</label> : null}
                <Submit className="btn sm danger" pendingText="Deleting…">Delete {c.name} for good</Submit>
              </form>
            </details>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
