import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { DocForm } from "@/components/doc-form";
import { CopyAllDocs, NewDoc } from "@/components/doc-admin";
import { deleteDoc } from "@/app/(app)/admin/actions";
import { DOC_GROUPS, TYPE_ORDER, docProducts, productFamilies, renewalState, typeInfo } from "@/lib/docs";
import type { DocumentRow } from "@/lib/types";

export const metadata = { title: "Docs admin" };
// Copying files from a website runs inside this page's server actions.
export const maxDuration = 60;

export default async function DocsAdminPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("documents").select("*").order("sort").order("title");
  const docs = ((data ?? []) as DocumentRow[]).sort(
    (a, b) => a.sort - b.sort || (TYPE_ORDER[a.doc_type] ?? 99) - (TYPE_ORDER[b.doc_type] ?? 99) || a.title.localeCompare(b.title),
  );
  const families = productFamilies(docs);
  const pending = docs.filter((d) => d.url && !d.storage_path).map((d) => ({ id: d.id, title: d.title }));
  const renewals = docs.filter((d) => ["past", "soon"].includes(renewalState(d.renewal_on).state));
  const groups = DOC_GROUPS.filter((g) => g.id !== "all")
    .map((g) => ({ ...g, docs: docs.filter((d) => g.types.includes(d.doc_type)) }))
    .concat([{ id: "other", label: "Other", types: [], docs: docs.filter((d) => !DOC_GROUPS.some((g) => g.types.includes(d.doc_type))) }])
    .filter((g) => g.docs.length);

  return (
    <main className="shell wide">
      <TopBar title="Docs & bulletins" back="/admin" />

      <CopyAllDocs pending={pending} />

      {renewals.length ? (
        <div className="card col" style={{ gap: 8 }}>
          <b>Code reports to check</b>
          {renewals.map((d) => {
            const r = renewalState(d.renewal_on);
            return (
              <div key={d.id} className="row small" style={{ gap: 10 }}>
                <span className={`pill ${r.state === "past" ? "" : "warn"}`}>{r.state === "past" ? "Past renewal" : "Renews soon"}</span>
                <span className="grow">{d.code ? `${d.code} · ` : ""}{d.title}</span>
                <span className="muted">{r.label}</span>
              </div>
            );
          })}
          <span className="tiny faint">Upload the renewed report (or paste its new link) and update the renewal date.</span>
        </div>
      ) : null}

      <details className="card" open={docs.length === 0}>
        <summary><b>+ Add a document</b></summary>
        <div style={{ marginTop: 14 }}><NewDoc families={families} /></div>
      </details>

      {groups.map((g) => (
        <details key={g.id} className="section" open={g.id !== "spfa"}>
          <summary className="eyebrow" style={{ cursor: "pointer", padding: "6px 2px" }}>{g.label} · {g.docs.length}</summary>
          <div className="list">
            {g.docs.map((d) => {
              const r = renewalState(d.renewal_on);
              const where = d.storage_path ? "In the app" : d.url ? "Website link" : "No file yet";
              const meta = [docProducts(d).join(", ") || d.category, d.revision, where, d.audience === "employee" ? "Staff only" : d.audience === "customer" ? "Contractors" : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <details key={d.id}>
                  <summary className="item" style={{ minHeight: 56, opacity: d.active ? 1 : 0.5 }}>
                    <span className="pill grey">{typeInfo(d.doc_type).short}</span>
                    <div className="grow">
                      <div className="t ellipsis">{d.code ? `${d.code} ` : ""}{d.title}</div>
                      <div className="s ellipsis">{meta}</div>
                    </div>
                    {r.state === "past" || r.state === "soon" ? <span className={`pill ${r.state === "past" ? "" : "warn"}`}>{r.state === "past" ? "Renewal passed" : "Renews soon"}</span> : null}
                    {!d.storage_path && d.url ? <span className="pill warn">Link</span> : null}
                    <span className="small red">Edit</span>
                  </summary>
                  <div className="col" style={{ padding: "0 16px 16px" }}>
                    <DocForm doc={d} families={families} />
                    <form action={deleteDoc}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="linkbtn" type="submit">Delete this document</button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      ))}
    </main>
  );
}
