import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { IntakeForm } from "@/components/intake/intake-form";
import { claudeReady } from "@/lib/ai/claude";
import { dateTime } from "@/lib/format";

export const metadata = { title: "AI order intake" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "To check", cls: "pill warn" },
  opened: { label: "Opened in Order", cls: "pill grey" },
  sent: { label: "Order placed", cls: "pill ok" },
  discarded: { label: "Discarded", cls: "pill grey" },
};

export default async function IntakePage() {
  const { supabase } = await requirePerm("ordering");
  const { data, error } = await supabase
    .from("order_drafts")
    .select("id, created_at, created_by_name, customer_text, status, items, source_text, images, company:companies(name)")
    .neq("status", "discarded")
    .order("created_at", { ascending: false })
    .limit(25);
  const drafts = (data ?? []) as unknown as {
    id: string;
    created_at: string;
    created_by_name: string | null;
    customer_text: string | null;
    status: string;
    items: unknown[];
    source_text: string | null;
    images: string[];
    company: { name: string } | null;
  }[];

  return (
    <main className="shell">
      <TopBar title="AI order intake" back="/order" />
      <p className="muted small" style={{ margin: 0 }}>
        Got an order by text, email or a handwritten note? Paste it or snap it. AMBIT A.I. reads it, picks the customer and the AMBIT products,
        and builds a draft for you to check.
      </p>
      {error ? <div className="alert warn small">Run supabase/migrations/0021_intake_photos_reorder_tax.sql in Supabase first.</div> : null}
      <IntakeForm ready={claudeReady()} />

      {drafts.length ? (
        <section className="section">
          <div className="eyebrow">Recent</div>
          <div className="list">
            {drafts.map((d) => {
              const st = STATUS[d.status] ?? STATUS.draft;
              return (
                <Link key={d.id} href={`/order/intake/${d.id}`} className="item">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t ellipsis">{d.company?.name ?? d.customer_text ?? "Customer not matched"}</div>
                    <div className="s ellipsis">
                      {(d.items ?? []).length} line{(d.items ?? []).length === 1 ? "" : "s"} · {d.images?.length ? "photo" : "pasted"} · {d.created_by_name} · {dateTime(d.created_at)}
                    </div>
                  </div>
                  <span className={st.cls}>{st.label}</span>
                  <ChevronRight size={18} className="chev" />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
