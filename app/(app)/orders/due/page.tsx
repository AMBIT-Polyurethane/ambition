import Link from "next/link";
import { Phone, ShoppingCart } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { customersDue, rhythm } from "@/lib/reorder";
import { dateShort } from "@/lib/format";

export const metadata = { title: "Customers due to order" };
export const dynamic = "force-dynamic";

// Sales reps and CRM: customers who usually order on a rhythm and are now well past it.
export default async function DuePage() {
  const { supabase } = await requirePerm("ordering");
  const due = await customersDue(supabase, 200);

  return (
    <main className="shell">
      <TopBar title="Customers due to order" back="/" />
      <p className="muted small" style={{ margin: 0 }}>
        Customers with at least 3 orders whose usual time between orders has passed by a good margin. Most overdue first.
      </p>
      {due === null ? <div className="alert warn small">Run supabase/migrations/0021_intake_photos_reorder_tax.sql in Supabase first.</div> : null}
      {due && !due.length ? (
        <div className="alert info small">Nobody is overdue right now. As more orders go through the app, this list fills in.</div>
      ) : null}
      {due?.length ? (
        <div className="list">
          {due.map((c) => (
            <div key={c.company_id} className="item due-row">
              <div className="grow col tight" style={{ minWidth: 0 }}>
                <span className="t ellipsis">{c.company_name}{c.account_no ? <span className="faint" style={{ fontWeight: 500 }}> · {c.account_no}</span> : null}</span>
                <span className="s">
                  Usually orders {rhythm(Number(c.usual_days))} · last order {dateShort(c.last_at)} ({c.days_since} days ago)
                </span>
                <span className="tiny" style={{ color: "var(--warn-text)", fontWeight: 700 }}>{c.days_over} days past their usual</span>
              </div>
              <div className="row" style={{ gap: 6, flex: "none" }}>
                {c.phone ? (
                  <a className="iconbtn" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${c.contact_name ?? c.company_name}`} title={c.contact_name ?? "Call"}>
                    <Phone size={17} />
                  </a>
                ) : null}
                <Link className="btn sm" href={`/order?smart=all&company=${c.company_id}`} style={{ gap: 6 }}>
                  <ShoppingCart size={15} /> Start order
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
