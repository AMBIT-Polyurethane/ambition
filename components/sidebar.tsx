"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Blocks,
  Boxes,
  ClipboardList,
  Download,
  FileText,
  GraduationCap,
  House,
  Landmark,
  MessageSquareWarning,
  Receipt,
  Ruler,
  ShieldCheck,
  Contact,
  Settings,
  ShoppingCart,
  Sparkles,
  SquareKanban,
  Tag,
  Truck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cartCount, onCartChange, readCart } from "@/lib/cart";
import { BrandImg } from "@/components/brand";

// The computer layout: a menu down the left side instead of the phone's bottom tabs.
// Same pages, same app; the screen width decides which one shows (globals.css, "Desktop").

export type SideItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; exact?: boolean };

const ICONS = {
  home: House,
  assistant: Sparkles,
  cart: ShoppingCart,
  orders: ClipboardList,
  desk: Truck,
  takeoff: Ruler,
  ops: Blocks,
  inventory: Boxes,
  prices: Tag,
  expenses: Receipt,
  docs: FileText,
  academy: GraduationCap,
  directory: Users,
  tax: Landmark,
  complaints: MessageSquareWarning,
  admin: ShieldCheck,
  profile: User,
  pipeline: SquareKanban,
  customers: Contact,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isOn(href: string, path: string, exact?: boolean) {
  if (exact) return path === href;
  if (href === "/") return path === "/";
  if (href === "/orders") return path === "/orders" || (path.startsWith("/orders/") && !path.startsWith("/orders/desk"));
  if (href === "/profile") return path.startsWith("/profile");
  if (href === "/ops") return path === "/ops" || path.startsWith("/ops/") || path === "/takeoff" || path.startsWith("/takeoff/");
  return path === href || path.startsWith(href + "/");
}

export function Sidebar({ items, name, sub }: { items: SideItem[]; name: string; sub: string }) {
  const path = usePathname() || "/";
  const [count, setCount] = useState(0);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  // The takeoff screen needs every inch: the menu shrinks to icons there.
  const compact = /^\/takeoff\/[^/]+$/.test(path);

  useEffect(() => {
    const update = () => setCount(cartCount(readCart()));
    update();
    return onCartChange(update);
  }, []);

  // Chrome and Edge on a computer can install the app with its own icon and window.
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  return (
    <aside className={`side${compact ? " compact" : ""}`} aria-label="Main menu">
      <Link href="/" className="side-brand" aria-label="AMBIT Intelligence home">
        <BrandImg art="atom-mark" width={34} height={34} />
        <span className="side-word">
          <b>AMBIT</b>
          <i>INTELLIGENCE</i>
        </span>
      </Link>
      <nav className="side-nav">
        {items.map((it) => {
          const I = ICONS[it.icon];
          const on = isOn(it.href, path, it.exact);
          const badge = it.href === "/order" ? count : it.badge ?? 0;
          return (
            <Link key={it.href} href={it.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined} title={compact ? it.label : undefined}>
              <I size={19} strokeWidth={on ? 2.2 : 1.8} />
              <span className="lbl">{it.label}</span>
              {badge > 0 ? <span className="side-badge">{badge > 99 ? "99+" : badge}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="side-foot">
        {install ? (
          <button
            type="button"
            className="side-install"
            onClick={async () => {
              await install.prompt();
              await install.userChoice.catch(() => null);
              setInstall(null);
            }}
            title="Install on this computer"
          >
            <Download size={17} />
            <span className="lbl">Install on this computer</span>
          </button>
        ) : null}
        <Link href="/profile" className="side-me" title={compact ? name : undefined}>
          <span className="av" aria-hidden="true">{initials(name)}</span>
          <span className="lbl">
            <b>{name}</b>
            <small>{sub}</small>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function initials(n: string) {
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "A";
}
