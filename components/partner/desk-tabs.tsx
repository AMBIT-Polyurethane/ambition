"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Palette, PlugZap, Tags, Users } from "lucide-react";

export function DeskTabs({ slug, newOrders }: { slug: string; newOrders: number }) {
  const path = usePathname();
  const base = `/store/${slug}/desk`;
  const tabs = [
    { href: base, label: "Price sheet", icon: Tags },
    { href: `${base}/orders`, label: "Orders", icon: ClipboardList, n: newOrders },
    { href: `${base}/customers`, label: "Customers", icon: Users },
    { href: `${base}/store`, label: "Store look & contact", icon: Palette },
    { href: `${base}/connect`, label: "QuickBooks & email", icon: PlugZap },
  ];
  return (
    <nav className="ptn-desk-tabs" aria-label="Desk">
      <div className="adc-wrap">
        {tabs.map((t) => {
          const on = t.href === base ? path === base : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
              <t.icon size={17} aria-hidden="true" /> {t.label}
              {t.n ? <span className="ptn-n">{t.n}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
