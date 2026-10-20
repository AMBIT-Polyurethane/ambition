import Link from "next/link";
import { PencilLine } from "lucide-react";
import { TopBar } from "@/components/ui";
import { jfDate } from "@/lib/format";
import { answerRows } from "@/lib/jotform";
import { ownedPriceRequest } from "@/lib/prf-access";

export const metadata = { title: "Price request" };
export const dynamic = "force-dynamic";

export default async function PriceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sub, item, mine, ownerName } = await ownedPriceRequest(id);
  const rows = answerRows(sub);

  return (
    <main className="shell">
      <TopBar title={item.customer || item.contact || "Price request"} back="/price-requests" />

      <div className="card col" style={{ gap: 6 }}>
        <div className="eyebrow">Price request</div>
        <div className="h2">{item.customer || item.contact || "Price request"}</div>
        <div className="small muted">
          {[item.contact && item.customer ? item.contact : null, mine ? null : ownerName || item.rep || "No rep picked"].filter(Boolean).join(" · ")}
        </div>
        <div className="tiny faint">
          Sent {jfDate(sub.created_at, true)}
          {sub.updated_at ? ` · Last edited ${jfDate(sub.updated_at, true)}` : ""}
        </div>
        <Link className="btn" href={`/price-requests/${id}/edit`} style={{ marginTop: 8 }}>
          <PencilLine size={16} /> Edit &amp; resubmit
        </Link>
      </div>

      <div className="list">
        {rows.map((r, i) =>
          "heading" in r ? (
            <div key={i} className="eyebrow" style={{ padding: "16px 16px 6px", background: "var(--bg)" }}>{r.heading}</div>
          ) : (
            <div key={i} className="answer">
              <div className="q">{r.label}</div>
              <div className="a">{r.value}</div>
            </div>
          ),
        )}
      </div>
    </main>
  );
}
