"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { CalendarRange, ClipboardCheck, Contact, FileSignature, Gauge, House, Receipt, Settings, SquareKanban } from "lucide-react";
import { AiNavButton } from "@/components/ops/ai/ai-button";

// AMBIT-OPS: the work in the order it happens, left to right. Steps still being built show when
// they arrive; nothing to click until then.

const STEPS = [
  { href: "/ops", label: "Home", icon: House, exact: true },
  { href: "/ops/pipeline", label: "Leads", icon: SquareKanban, also: ["/ops/leads"] },
  { href: "/ops/customers", label: "Customers", icon: Contact },
  { href: "/ops/quotes", label: "Quotes", icon: FileSignature, also: ["/takeoff"] },
  { href: "/ops/schedule", label: "Schedule", icon: CalendarRange, also: ["/ops/jobs", "/ops/stock"] },
  { href: "/ops/work-orders", label: "Work orders", icon: ClipboardCheck, also: ["/ops/field"] },
  { href: "/ops/invoices", label: "Invoices", icon: Receipt, soon: "Nov 26" },
  { href: "/ops/costing", label: "Job costing", icon: Gauge, soon: "Dec 1" },
] as const;

/** ai: the pulsing AMBIT Intelligence atom, between Schedule and Work orders. */
export function OpsNav({ crm, manage, ai = true }: { crm: boolean; manage: boolean; ai?: boolean }) {
  const path = usePathname() || "/ops";
  const on = (href: string, exact?: boolean, also?: readonly string[]) =>
    exact ? path === href : path === href || path.startsWith(href + "/") || !!also?.some((a) => path.startsWith(a));
  const steps = STEPS.filter((s) => crm || s.href === "/ops");
  return (
    <nav className="ops-nav" aria-label="AMBIT-OPS">
      <div className="ops-nav-in">
        {steps.map((s) => {
          const I = s.icon;
          const soon = "soon" in s ? s.soon : null;
          if (soon) {
            return (
              <span key={s.href} className="ops-step soon" title={`Coming ${soon}`} aria-disabled="true">
                <I size={16} /> {s.label} <i>{soon}</i>
              </span>
            );
          }
          const active = on(s.href, "exact" in s ? s.exact : false, "also" in s ? s.also : undefined);
          return (
            <Fragment key={s.href}>
              {ai && s.href === "/ops/work-orders" ? <AiNavButton /> : null}
              <Link href={s.href} className={`ops-step${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>
                <I size={16} /> {s.label}
              </Link>
            </Fragment>
          );
        })}
        {ai && !steps.some((s) => s.href === "/ops/work-orders") ? <AiNavButton /> : null}
        {manage ? (
          <Link href="/ops/settings" className={`ops-step end${path.startsWith("/ops/settings") ? " on" : ""}`}>
            <Settings size={16} /> Settings
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
