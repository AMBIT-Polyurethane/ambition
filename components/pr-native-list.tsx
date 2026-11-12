import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/components/icons";
import { dateShort } from "@/lib/format";
import { PR_STATUS, prRef, type PrRow } from "@/lib/price-requests";

/** Price requests made in the app (0066). */
export function PrNativeList({ rows, counts, showRep = false }: { rows: PrRow[]; counts: Map<number, { n: number; auto: number }>; showRep?: boolean }) {
  return (
    <div className="list">
      {rows.map((r) => {
        const c = counts.get(r.id);
        return (
          <Link key={r.id} className="item" href={`/price-requests/n/${r.id}`}>
            <div className="ic"><Icon name="tag" /></div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row between" style={{ gap: 8 }}>
                <span className="t ellipsis">{r.company_name}</span>
                <span className={PR_STATUS[r.status].pill}>{PR_STATUS[r.status].label}</span>
              </div>
              <div className="s ellipsis">{[prRef(r.id), showRep ? r.rep_name : null, c ? `${c.n} ${c.n === 1 ? "product" : "products"}${c.auto ? ` · ${c.auto} by the rules` : ""}` : null].filter(Boolean).join(" · ")}</div>
              <div className="tiny faint">Sent {dateShort(r.created_at)}{r.decided_by_name ? ` · ${r.decided_by_name}` : ""}</div>
            </div>
            <ChevronRight size={18} className="chev" />
          </Link>
        );
      })}
    </div>
  );
}

export async function lineCounts(db: import("@supabase/supabase-js").SupabaseClient, ids: number[]) {
  const out = new Map<number, { n: number; auto: number }>();
  if (!ids.length) return out;
  const { data } = await db.from("price_request_lines").select("request_id, auto").in("request_id", ids);
  for (const l of (data ?? []) as { request_id: number; auto: boolean }[]) {
    const c = out.get(l.request_id) ?? { n: 0, auto: 0 };
    c.n++;
    if (l.auto) c.auto++;
    out.set(l.request_id, c);
  }
  return out;
}
