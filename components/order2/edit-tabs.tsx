import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Help } from "@/components/help";

/** One Edit order, two parts: what's on it (items and lots) and who / where / when (customer, ship-to, PO, dates). */
export function EditTabs({ id, title, on, items, details, help }: { id: string; title: string; on: "items" | "details"; items: boolean; details: boolean; help?: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="o2-head">
        <div className="o2-head-l">
          <Link href={`/orders/${id}`} className="o2-back" aria-label="Back to the order"><ChevronLeft size={20} /></Link>
          <div className="o2-title">
            <div className="row"><h1>{title}</h1>{help ? <Help>{help}</Help> : null}</div>
          </div>
        </div>
      </div>
      {items && details ? (
        <nav className="seg2" aria-label="What to edit">
          <Link href={`/orders/${id}/edit`} className={on === "items" ? "on" : undefined} aria-current={on === "items" ? "page" : undefined}>Items &amp; lots</Link>
          <Link href={`/orders/${id}/details`} className={on === "details" ? "on" : undefined} aria-current={on === "details" ? "page" : undefined}>Customer, ship-to &amp; dates</Link>
        </nav>
      ) : null}
    </div>
  );
}
