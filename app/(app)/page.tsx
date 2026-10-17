import Link from "next/link";
import { ArrowRight, Bell, ChevronRight, RefreshCw, UserCheck } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { firstName, greeting, initials, orderNo, qtyText, dateShort } from "@/lib/format";
import { linkHref } from "@/lib/links";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/ui";
import type { LinkRow, Order, OrderItem } from "@/lib/types";

type Tile = { key: string; icon: string; title: string; sub: string; href: string | null; external?: boolean };

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  const audiences = emp ? ["all", "employee"] : ["all", "customer"];

  const [{ data: linkRows }, lastOrderRes, pendingRes, newOrdersRes] = await Promise.all([
    supabase.from("links").select("*").eq("active", true).in("audience", audiences).order("sort").order("title"),
    emp
      ? Promise.resolve({ data: null })
      : supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    profile.role === "admin"
      ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    emp
      ? supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "new")
      : Promise.resolve({ count: 0 }),
  ]);

  const links = (linkRows ?? []) as LinkRow[];
  const forms = links.filter((l) => l.section === "forms");
  const extraTiles: Tile[] = links
    .filter((l) => l.section === "resources")
    .map((l) => {
      const h = linkHref(l);
      return { key: l.id, icon: l.icon, title: l.title, sub: l.subtitle ?? "", href: h?.href ?? null, external: h?.external };
    });

  const builtIn: Tile[] = emp
    ? [
        { key: "dir", icon: "users", title: "Company directory", sub: "Find anyone at AMBIT", href: "/directory" },
        { key: "orders", icon: "cart", title: "Orders", sub: "Everything sent through AMBITION", href: "/orders" },
        { key: "docs", icon: "docs", title: "Product docs", sub: "TDS · SDS · ESR · SPFA", href: "/docs" },
        { key: "tsb", icon: "bulletin", title: "Tech bulletins", sub: "TSBs from AMBIT", href: "/docs?type=tsb" },
        { key: "academy", icon: "academy", title: "AMBIT Academy", sub: "Courses & quizzes", href: "/academy" },
        { key: "branches", icon: "pin", title: "Branches", sub: "Addresses & phones", href: "/branches" },
      ]
    : [
        { key: "docs", icon: "docs", title: "Product docs", sub: "TDS · SDS · ESR · SPFA", href: "/docs" },
        { key: "tsb", icon: "bulletin", title: "Tech bulletins", sub: "TSBs from AMBIT", href: "/docs?type=tsb" },
        { key: "academy", icon: "academy", title: "AMBIT Academy", sub: "Courses & quizzes", href: "/academy" },
        { key: "orders", icon: "cart", title: "My orders", sub: "History & reorder", href: "/orders" },
        { key: "branches", icon: "pin", title: "Branches", sub: "Pickup locations", href: "/branches" },
      ];
  const tiles = [...builtIn, ...extraTiles];

  const lastOrder = lastOrderRes.data as (Order & { order_items: OrderItem[] }) | null;
  const pending = pendingRes.count ?? 0;
  const newOrders = newOrdersRes.count ?? 0;

  return (
    <main className="shell">
      <header className="row between" style={{ paddingTop: 8 }}>
        <img src="/brand/logo-white.png" alt="AMBIT Polyurethane" style={{ height: 28, width: "auto" }} />
        <div className="row" style={{ gap: 10 }}>
          {emp ? (
            <Link href="/orders?status=new" className="iconbtn" aria-label={`${newOrders} new orders`} style={{ position: "relative" }}>
              <Bell size={20} />
              {newOrders > 0 ? (
                <span style={{ position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, background: "var(--red)", fontSize: 11, fontWeight: 800, display: "grid", placeItems: "center", padding: "0 5px" }}>
                  {newOrders}
                </span>
              ) : null}
            </Link>
          ) : null}
          <Link href="/profile" className="avatar" aria-label="Profile">{initials(profile.full_name, profile.email)}</Link>
        </div>
      </header>

      {sp.password === "updated" ? <div className="alert ok">Your password was updated.</div> : null}

      <div className="col tight">
        <span className="pill" style={{ alignSelf: "flex-start" }}>{emp ? (profile.role === "admin" ? "AMBIT team · Admin" : "AMBIT team") : "Contractor"}</span>
        <div className="muted small" style={{ marginTop: 4 }}>{greeting()},</div>
        <div className="h1">{firstName(profile.full_name, profile.email)}</div>
        {!emp && profile.company ? <div className="muted small">{profile.company.name}{profile.company.account_no ? ` · ${profile.company.account_no}` : ""}</div> : null}
      </div>

      {pending > 0 ? (
        <Link href="/admin/users" className="alert warn" style={{ alignItems: "center" }}>
          <UserCheck size={18} />
          <span className="grow"><b>{pending}</b> access {pending === 1 ? "request is" : "requests are"} waiting for approval</span>
          <ChevronRight size={18} />
        </Link>
      ) : null}

      <Link href="/order" className="hero">
        <div className="ring" aria-hidden="true" />
        <div className="col tight grow" style={{ position: "relative" }}>
          <span className="eyebrow" style={{ color: "rgba(255,255,255,0.85)" }}>{emp ? "For a customer" : "Order request"}</span>
          <span className="h1" style={{ fontSize: 24 }}>{emp ? "Order for a customer" : "Place an order"}</span>
          <span className="small" style={{ opacity: 0.92 }}>Pick items, choose pickup or delivery, and it goes straight to AMBIT.</span>
        </div>
        <span className="go"><ArrowRight size={22} /></span>
      </Link>

      {lastOrder ? (
        <section className="section">
          <div className="eyebrow">Your last order</div>
          <div className="card col" style={{ gap: 10 }}>
            <div className="row between">
              <Link href={`/orders/${lastOrder.id}`} style={{ color: "#fff", fontWeight: 800 }}>{orderNo(lastOrder.order_no)}</Link>
              <StatusPill status={lastOrder.status} />
            </div>
            <div className="small muted ellipsis">
              {lastOrder.order_items.slice(0, 1).map((i) => `${i.name} × ${qtyText(i.qty, i.unit)}`).join("")}
              {lastOrder.order_items.length > 1 ? ` + ${lastOrder.order_items.length - 1} more` : ""}
            </div>
            <div className="row between">
              <span className="tiny faint">{dateShort(lastOrder.created_at)}</span>
              <Link href={`/order?reorder=${lastOrder.id}`} className="btn sm dark"><RefreshCw size={14} /> Reorder</Link>
            </div>
          </div>
        </section>
      ) : null}

      {forms.length ? (
        <section className="section">
          <div className="eyebrow">{emp ? "Internal forms" : "Forms"}</div>
          <div className="list">
            {forms.map((f) => {
              const h = linkHref(f);
              const inner = (
                <>
                  <div className="ic"><Icon name={f.icon} /></div>
                  <div className="grow">
                    <div className="t ellipsis">{f.title}</div>
                    <div className="s ellipsis">{h ? f.subtitle : "Coming soon"}</div>
                  </div>
                  {h ? <ChevronRight size={18} className="chev" /> : null}
                </>
              );
              if (!h) return <div key={f.id} className="item" style={{ opacity: 0.55 }}>{inner}</div>;
              return h.external ? (
                <a key={f.id} className="item" href={h.href} target="_blank" rel="noopener noreferrer">{inner}</a>
              ) : (
                <Link key={f.id} className="item" href={h.href}>{inner}</Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="eyebrow">Resources</div>
        <div className="grid2 tiles">
          {tiles.map((t) => {
            const inner = (
              <>
                <div className="ic"><Icon name={t.icon} /></div>
                <div className="col" style={{ gap: 3 }}>
                  <div className="t">{t.title}</div>
                  <div className="s">{t.href ? t.sub : "Coming soon"}</div>
                </div>
              </>
            );
            if (!t.href) return <div key={t.key} className="tile off">{inner}</div>;
            return t.external ? (
              <a key={t.key} className="tile" href={t.href} target="_blank" rel="noopener noreferrer">{inner}</a>
            ) : (
              <Link key={t.key} className="tile" href={t.href}>{inner}</Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
