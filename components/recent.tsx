"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { openOrders } from "@/app/(app)/recent-actions";

// "Jump back in" on the home screen: the last few things this person opened on this device
// (orders, price requests, credit applications, bulletins, product docs). Kept in the browser only.

export type RecentKind = "order" | "prf" | "credit" | "form" | "tsb" | "doc";
export type RecentItem = { href: string; title: string; sub: string; kind: RecentKind; code?: string; external?: boolean; at: number };

const keyFor = (uid: string) => `ambition-recent-v1:${uid}`;

export function readRecent(uid: string): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    const list = raw ? (JSON.parse(raw) as RecentItem[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.href === "string" && typeof x.title === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecent(uid: string, item: Omit<RecentItem, "at">) {
  if (!uid || !item.href || !item.title) return;
  try {
    const list = readRecent(uid).filter((x) => x.href !== item.href);
    list.unshift({ ...item, title: item.title.slice(0, 80), sub: item.sub.slice(0, 40), at: Date.now() });
    window.localStorage.setItem(keyFor(uid), JSON.stringify(list.slice(0, 8)));
  } catch {
    // storage blocked (private mode): nothing to remember
  }
}

/** Put on a page to remember that it was opened. Renders nothing. */
export function TrackRecent({ uid, ...item }: Omit<RecentItem, "at"> & { uid: string }) {
  useEffect(() => {
    recordRecent(uid, item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, item.href]);
  return null;
}

const ART: Record<RecentKind, { color: string; icon: string; label: string }> = {
  order: { color: "#E33527", icon: "cart", label: "Order" },
  prf: { color: "#E59A0B", icon: "tag", label: "Price request" },
  credit: { color: "#4F46E5", icon: "card", label: "Credit app" },
  form: { color: "#5B6B82", icon: "form", label: "Form" },
  tsb: { color: "#2563EB", icon: "bulletin", label: "Bulletin" },
  doc: { color: "#0D9488", icon: "docs", label: "Doc" },
};

const orderId = (href: string) => href.match(/^\/orders\/([0-9a-f-]{36})$/i)?.[1] ?? null;

/** Forget things that are gone (orders deleted, cancelled or completed), on this device too. */
function forget(uid: string, hrefs: Set<string>) {
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(readRecent(uid).filter((x) => !hrefs.has(x.href))));
  } catch {
    // storage blocked: nothing to forget
  }
}

/**
 * The home screen's "Jump back in" grid. Hidden until something has been opened. Orders show only while they're
 * still open: deleted, cancelled and completed (picked up / delivered) ones drop off.
 */
export function JumpBackIn({ uid }: { uid: string }) {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    let live = true;
    const all = readRecent(uid);
    const orders = all.map((x) => orderId(x.href)).filter((x): x is string => Boolean(x));
    // Non-orders show straight away; orders once the app has checked they're still open.
    setItems(all.filter((x) => !orderId(x.href)).slice(0, 4));
    if (!orders.length) return;
    openOrders(orders)
      .then((open) => {
        if (!live) return;
        if (open === null) return setItems(all.slice(0, 4)); // couldn't check: show them as before
        const ok = new Set(open);
        const gone = new Set(all.filter((x) => orderId(x.href) && !ok.has(orderId(x.href)!)).map((x) => x.href));
        if (gone.size) forget(uid, gone);
        setItems(all.filter((x) => !gone.has(x.href)).slice(0, 4));
      })
      .catch(() => live && setItems(all.slice(0, 4)));
    return () => {
      live = false;
    };
  }, [uid]);
  if (!items.length) return null;
  return (
    <section className="section">
      <span className="sec-title">Jump back in</span>
      <div className="jump-grid">
        {items.map((it) => {
          const a = ART[it.kind] ?? ART.doc;
          const inner = (
            <>
              <span className="art" style={{ ["--c" as string]: a.color }}>
                {it.kind === "tsb" && it.code ? (
                  <span className="code">
                    <small>TSB</small>
                    {it.code}
                  </span>
                ) : (
                  <Icon name={a.icon} size={22} />
                )}
              </span>
              <span className="col" style={{ gap: 1, minWidth: 0 }}>
                <span className="t">{it.title}</span>
                <span className="k" style={{ ["--c" as string]: a.color }}>{it.sub || a.label}</span>
              </span>
            </>
          );
          return it.external ? (
            <a key={it.href} className="jump" href={it.href} target="_blank" rel="noopener noreferrer">{inner}</a>
          ) : (
            <Link key={it.href} className="jump" href={it.href}>{inner}</Link>
          );
        })}
      </div>
    </section>
  );
}

/** A link that also remembers what was opened (for links that leave the app, like a bulletin's PDF). */
export function RecentLink({
  uid,
  item,
  className,
  children,
}: {
  uid: string;
  item: Omit<RecentItem, "at">;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a className={className} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => recordRecent(uid, item)}>
      {children}
    </a>
  );
}
