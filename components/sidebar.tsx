"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  MessagesSquare,
  TrendingUp,
  Gauge,
  CirclePlay,
  Blocks,
  ClipboardCheck,
  NotebookPen,
  Boxes,
  CalendarRange,
  Package,
  ClipboardList,
  Download,
  FileSignature,
  FileText,
  FileChartColumn,
  GraduationCap,
  House,
  Landmark,
  HandCoins,
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
  ChevronRight,
  ClipboardPen,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { cartCount, onCartChange, readCart } from "@/lib/cart";
import { BrandImg } from "@/components/brand";

// The computer layout: a menu down the left side instead of the phone's bottom tabs.
// Same pages, same app; the screen width decides which one shows (globals.css, "Desktop").

export type SideItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; exact?: boolean; sub?: string };
/** A group in the menu (Orders, Customers, Forms…): hover it and its pages fly out to the right. */
export type SideGroup = { group: string; label: string; icon: keyof typeof ICONS; items: SideItem[] };
export type SideEntry = SideItem | SideGroup;
const isGroup = (e: SideEntry): e is SideGroup => "group" in e;

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
  howto: CirclePlay,
  chat: MessagesSquare,
  directory: Users,
  tax: Landmark,
  credit: HandCoins,
  reports: FileChartColumn,
  complaints: MessageSquareWarning,
  admin: ShieldCheck,
  profile: User,
  pipeline: SquareKanban,
  customers: Contact,
  quotes: FileSignature,
  schedule: CalendarRange,
  stock: Package,
  workorders: ClipboardCheck,
  spraylogs: NotebookPen,
  settings: Settings,
  forms: ClipboardPen,
  learn: BookOpen,
  sales: TrendingUp,
  salesdash: Gauge,
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

export function Sidebar({ items: entries, name, sub }: { items: SideEntry[]; name: string; sub: string }) {
  const path = usePathname() || "/";
  // Which group's flyout is open, and where (fixed to the screen so the menu's scrolling doesn't clip it).
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => { if (timer.current) clearTimeout(timer.current); };
  const show = (key: string, el: HTMLElement, now = false) => {
    keep();
    const r = el.getBoundingClientRect();
    const open = () => setFly({ key, top: Math.max(8, Math.min(r.top - 8, window.innerHeight - 420)) });
    if (now || fly) open(); else timer.current = setTimeout(open, 90);
  };
  const hide = () => { keep(); timer.current = setTimeout(() => setFly(null), 220); };
  useEffect(() => setFly(null), [path]);
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
        {entries.map((e) => {
          if (!isGroup(e)) return <Item key={e.href} it={e} path={path} compact={compact} cart={count} />;
          const live = e.items.filter(Boolean);
          if (live.length === 1) return <Item key={e.group} it={live[0]} path={path} compact={compact} cart={count} />;
          const I = ICONS[e.icon];
          const on = live.some((it) => isOn(it.href, path, it.exact));
          const badge = live.reduce((n, it) => n + (it.badge ?? 0), 0);
          return (
            <div key={e.group} className={`side-grp${fly?.key === e.group ? " open" : ""}`}
              onMouseEnter={(ev) => show(e.group, ev.currentTarget)} onMouseLeave={hide} onFocus={(ev) => show(e.group, ev.currentTarget)} onBlur={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node)) hide(); }}>
              <button type="button" className={`side-grp-btn${on ? " on" : ""}`} aria-expanded={fly?.key === e.group} aria-haspopup="true" title={compact ? e.label : undefined}
                onClick={(ev) => (fly?.key === e.group ? setFly(null) : show(e.group, ev.currentTarget.parentElement as HTMLElement, true))}>
                <I size={19} strokeWidth={on ? 2.2 : 1.8} />
                <span className="lbl">{e.label}</span>
                {badge > 0 ? <span className="side-badge">{badge > 99 ? "99+" : badge}</span> : <ChevronRight size={15} className="side-chev" />}
              </button>
              {fly?.key === e.group ? (
                <div className="side-fly" role="menu" aria-label={e.label} style={{ top: fly.top }} onMouseEnter={keep} onMouseLeave={hide}>
                  <b className="side-fly-title">{e.label}</b>
                  {live.map((it) => {
                    const J = ICONS[it.icon];
                    const here = isOn(it.href, path, it.exact);
                    return (
                      <Link key={it.href} href={it.href} role="menuitem" className={here ? "on" : ""} onClick={() => setFly(null)}>
                        <J size={17} />
                        <span className="col tight"><span>{it.label}</span>{it.sub ? <small>{it.sub}</small> : null}</span>
                        {it.badge ? <span className="side-badge">{it.badge}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
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

function Item({ it, path, compact, cart }: { it: SideItem; path: string; compact: boolean; cart: number }) {
  const I = ICONS[it.icon];
  const on = isOn(it.href, path, it.exact);
  const badge = it.href === "/order" ? cart : it.badge ?? 0;
  return (
    <Link href={it.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined} title={compact ? it.label : undefined}>
      <I size={19} strokeWidth={on ? 2.2 : 1.8} />
      <span className="lbl">{it.label}</span>
      {badge > 0 ? <span className="side-badge">{badge > 99 ? "99+" : badge}</span> : null}
    </Link>
  );
}
