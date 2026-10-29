"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FileSignature, FileText, GraduationCap, House, ShoppingCart, SquareKanban, User } from "lucide-react";
import { cartCount, onCartChange, readCart } from "@/lib/cart";

const TABS = [
  { href: "/", label: "Home", icon: House, match: (p: string) => p === "/" },
  { href: "/order", label: "Order", icon: ShoppingCart, match: (p: string) => p.startsWith("/order") },
  { href: "/academy", label: "Academy", icon: GraduationCap, match: (p: string) => p.startsWith("/academy") },
  { href: "/docs", label: "Docs", icon: FileText, match: (p: string) => p.startsWith("/docs") },
  { href: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") || p.startsWith("/admin") },
];

// AMBIT-OPS contractors: their business first (Home is the OPS home), AMBIT ordering second.
const OPS_TABS = [
  { href: "/ops", label: "Home", icon: House, match: (p: string) => p === "/ops" || p === "/" },
  { href: "/ops/pipeline", label: "Leads", icon: SquareKanban, match: (p: string) => p.startsWith("/ops/pipeline") || p.startsWith("/ops/leads") },
  { href: "/ops/quotes", label: "Quotes", icon: FileSignature, match: (p: string) => p.startsWith("/ops/quotes") || p.startsWith("/takeoff") },
  { href: "/order", label: "Order", icon: ShoppingCart, match: (p: string) => p.startsWith("/order") },
  { href: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") || p.startsWith("/ops/settings") },
];
// Crews: their work, then learning.
const CREW_TABS = [
  { href: "/ops", label: "Home", icon: House, match: (p: string) => p === "/ops" || p === "/" },
  { href: "/academy", label: "Academy", icon: GraduationCap, match: (p: string) => p.startsWith("/academy") },
  { href: "/docs", label: "Docs", icon: FileText, match: (p: string) => p.startsWith("/docs") },
  { href: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") },
];

export function TabBar({ showOrder = true, mode = "default" }: { showOrder?: boolean; mode?: "default" | "ops" | "crew" }) {
  const path = usePathname() || "/";
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(cartCount(readCart()));
    update();
    return onCartChange(update);
  }, []);

  const tabs = mode === "ops" ? OPS_TABS.filter((t) => showOrder || t.href !== "/order") : mode === "crew" ? CREW_TABS : TABS.filter((t) => showOrder || t.href !== "/order");
  return (
    <div className="tabbar">
      <nav aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => {
          const on = t.match(path);
          const I = t.icon;
          return (
            <Link key={t.href} href={t.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
              <I size={22} strokeWidth={on ? 2.2 : 1.8} />
              {t.label}
              {t.href === "/order" && count > 0 ? <span className="badge">{count}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
