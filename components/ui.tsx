import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Icon } from "@/components/icons";
import { docState } from "@/lib/order-doc/types";
import type { Order } from "@/lib/types";

export function TopBar({ title, back, right }: { title: string; back?: string; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <Link href={back} className="iconbtn" aria-label="Back">
          <ChevronLeft size={22} />
        </Link>
      ) : null}
      <h1 className="title ellipsis" style={{ margin: 0 }}>{title}</h1>
      {right}
    </header>
  );
}

export function Empty({ icon = "box", title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="ic"><Icon name={icon} size={26} /></div>
      <div style={{ fontWeight: 800, color: "var(--text)" }}>{title}</div>
      {children ? <div className="small">{children}</div> : null}
    </div>
  );
}

export function ListLink({
  href, icon, title, sub, right, external,
}: {
  href: string; icon: string; title: string; sub?: string | null; right?: React.ReactNode; external?: boolean;
}) {
  const inner = (
    <>
      <div className="ic"><Icon name={icon} /></div>
      <div className="grow">
        <div className="t ellipsis">{title}</div>
        {sub ? <div className="s ellipsis">{sub}</div> : null}
      </div>
      {right ?? <ChevronRight size={18} className="chev" />}
    </>
  );
  if (external) {
    return <a className="item" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>;
  }
  return <Link className="item" href={href}>{inner}</Link>;
}

export function StatusPill({ status }: { status: string }) {
  const cls = status === "completed" ? "pill ok" : status === "cancelled" ? "pill grey" : status === "processing" ? "pill warn" : "pill";
  const label = { new: "New", processing: "Processing", completed: "Completed", cancelled: "Cancelled" }[status] ?? status;
  return <span className={cls}>{label}</span>;
}

/** Shown next to the order status while the customer still has to approve. */
export function ApprovalPill({ order }: { order: Pick<Order, "status" | "approval_status" | "approval_expires_at"> }) {
  const st = docState(order);
  if (st === "pending") return <span className="pill warn">Needs approval</span>;
  if (st === "expired") return <span className="pill warn">Approval expired</span>;
  if (st === "changes_requested") return <span className="pill">Changes asked</span>;
  return null;
}
