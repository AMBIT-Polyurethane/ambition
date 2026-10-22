"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, GraduationCap, House, ShoppingCart, User } from "lucide-react";
import { cartCount, onCartChange, readCart } from "@/lib/cart";

const TABS = [
  { href: "/", label: "Home", icon: House, match: (p: string) => p === "/" },
  { href: "/order", label: "Order", icon: ShoppingCart, match: (p: string) => p.startsWith("/order") },
  { href: "/academy", label: "Academy", icon: GraduationCap, match: (p: string) => p.startsWith("/academy") },
  { href: "/docs", label: "Docs", icon: FileText, match: (p: string) => p.startsWith("/docs") },
  { href: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") || p.startsWith("/admin") },
];

export function TabBar({ showOrder = true }: { showOrder?: boolean }) {
  const path = usePathname() || "/";
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(cartCount(readCart()));
    update();
    return onCartChange(update);
  }, []);

  return (
    <div className="tabbar">
      <nav aria-label="Main" style={{ gridTemplateColumns: `repeat(${showOrder ? 5 : 4}, 1fr)` }}>
        {TABS.filter((t) => showOrder || t.href !== "/order").map((t) => {
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
