import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { DocForm } from "@/components/doc-form";
import { NewDoc } from "@/components/doc-admin";
import { deleteDoc } from "@/app/(app)/admin/actions";
import type { DocumentRow } from "@/lib/types";

export const metadata = { title: "Docs admin" };

export default async function DocsAdminPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("documents").select("*").order("doc_type").order("sort").order("title");
  const docs = (data ?? []) as DocumentRow[];
  return (
    <main className="shell wide">
      <TopBar title="Docs & bulletins" back="/admin" />
      <details className="card" open={docs.length === 0}>
        <summary><b>+ Add a document</b></summary>
        <div style={{ marginTop: 14 }}><NewDoc /></div>
      </details>
      <div className="list">
        {docs.map((d) => (
          <details key={d.id}>
            <summary className="item" style={{ minHeight: 56, opacity: d.active ? 1 : 0.5 }}>
              <span className="pill grey">{d.doc_type}</span>
              <div className="grow">
                <div className="t ellipsis">{d.code ? `${d.code} ` : ""}{d.title}</div>
                <div className="s ellipsis">{d.storage_path ? "Uploaded file" : d.url ? d.url : "No file yet"} · {d.audience === "employee" ? "Staff only" : d.audience === "customer" ? "Contractors" : "Everyone"}</div>
              </div>
              <span className="small red">Edit</span>
            </summary>
            <div className="col" style={{ padding: "0 16px 16px" }}>
              <DocForm doc={d} />
              <form action={deleteDoc}>
                <input type="hidden" name="id" value={d.id} />
                <button className="linkbtn" type="submit">Delete this document</button>
              </form>
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
