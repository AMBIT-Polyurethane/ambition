"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ClipboardCheck, FileSignature, FileText, GraduationCap, House, ShoppingCart, SquareKanban, User } from "lucide-react";
import { cartCount, onCartChange, readCart } from "@/lib/cart";
import { AiTabButton } from "@/components/ops/ai/ai-button";

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
  { href: "/ops/field", label: "Work", icon: ClipboardCheck, match: (p: string) => p.startsWith("/ops/field") },
  { href: "/academy", label: "Academy", icon: GraduationCap, match: (p: string) => p.startsWith("/academy") },
  { href: "/docs", label: "Docs", icon: FileText, match: (p: string) => p.startsWith("/docs") },
  { href: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") },
];

/**
 * ai: the AMBIT Intelligence atom in the middle of the bar ("always" for contractors in AMBIT-OPS, "ops"
 * for an AMBIT admin working in a workspace, only on the OPS screens). With it the bar keeps four tabs,
 * two each side; Profile moves to the top of OPS Home (and the menu).
 */
export function TabBar({ showOrder = true, mode = "default", ai = false }: { showOrder?: boolean; mode?: "default" | "ops" | "crew"; ai?: false | "always" | "ops" }) {
  const path = usePathname() || "/";
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(cartCount(readCart()));
    update();
    return onCartChange(update);
  }, []);

  let tabs = mode === "ops" ? OPS_TABS.filter((t) => showOrder || t.href !== "/order") : mode === "crew" ? CREW_TABS : TABS.filter((t) => showOrder || t.href !== "/order");
  const withAi = ai === "always" || (ai === "ops" && (path === "/ops" || path.startsWith("/ops/")));
  if (withAi) {
    const drop = mode === "crew" ? "/academy" : mode === "ops" && tabs.length > 4 ? "/profile" : tabs.length > 4 ? "/academy" : null;
    tabs = tabs.filter((t) => t.href !== drop).slice(0, 4);
  }
  const half = Math.ceil(tabs.length / 2);
  const cells = withAi ? [...tabs.slice(0, half), null, ...tabs.slice(half)] : tabs;
  return (
    <div className={`tabbar${withAi ? " has-ai" : ""}`}>
      <nav aria-label="Main" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
        {cells.map((t) => {
          if (!t) return <AiTabButton key="ai" />;
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
