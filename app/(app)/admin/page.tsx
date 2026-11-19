import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { emailConfigured } from "@/lib/email";
import { MICROSOFT_SIGNIN } from "@/lib/env";
import { Help } from "@/components/help";
import { TileSection } from "@/components/tile-grid";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const { supabase } = await requireAdmin();
  const [pending, products, companies, newOrders] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);
  const mail = emailConfigured();
  const waiting = pending.count ?? 0;

  return (
    <main className="shell wide">
      <div className="o2 adm">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/profile" className="o2-back" aria-label="Back"><ChevronLeft size={22} /></Link>
            <div className="o2-title"><h1>Admin</h1></div>
          </div>
        </div>

        {!mail || !MICROSOFT_SIGNIN ? (
          <section className="card2 adm-setup" aria-label="Finish setting up">
            {!mail ? (
              <div className="adm-setup-r">
                <span className="adm-dot warn" aria-hidden="true" />
                <span className="grow"><b>Order emails are off.</b> <span>Nothing goes to orders@ambitpu.com yet. Orders are still saved under Orders.</span></span>
              </div>
            ) : null}
            {!MICROSOFT_SIGNIN ? (
              <div className="adm-setup-r">
                <span className="adm-dot info" aria-hidden="true" />
                <span className="grow"><b>Sign in with Microsoft is off.</b> <span>Staff ask for access for now.</span></span>
                <Help label="How to add staff until Microsoft sign-in is on">
                  Until IT finishes the Microsoft set-up, have new staff request access, then open Accounts and set their role to Employee.
                </Help>
              </div>
            ) : null}
          </section>
        ) : null}

        <TileSection
          title="People"
          tiles={[
            { key: "users", href: "/admin/users", icon: "users", title: "Accounts", sub: waiting ? `${waiting} waiting for approval` : "Who can sign in", badge: waiting },
            { key: "alerts", href: "/admin/email-alerts", icon: "mail", title: "Email alerts", sub: "Who gets credit emails" },
            { key: "branches", href: "/admin/branches", icon: "pin", title: "Branches", sub: "Addresses and phones" },
            { key: "holidays", href: "/admin/holidays", icon: "calendar", title: "Holidays", sub: "Days AMBIT is closed" },
          ]}
        />
        <TileSection
          title="Selling"
          tiles={[
            { key: "companies", href: "/admin/companies", icon: "building", title: "Customers", sub: `${companies.count ?? 0} companies, sales reps` },
            { key: "products", href: "/admin/products", icon: "box", title: "Products & pricing", sub: `${products.count ?? 0} active, photos` },
            { key: "goals", href: "/admin/sales-goals", icon: "target", title: "Sales goals", sub: "Monthly, by product group" },
            { key: "promos", href: "/admin/promos", icon: "megaphone", title: "Home banner", sub: "Sale slides and news" },
          ]}
        />
        <TileSection
          title="Running the business"
          tiles={[
            { key: "orders", href: "/orders?status=new", icon: "cart", title: "Orders", sub: `${newOrders.count ?? 0} new`, badge: newOrders.count ?? 0 },
            { key: "inventory", href: "/admin/inventory", icon: "boxes", title: "Inventory", sub: "Spreadsheet connection" },
            { key: "check", href: "/admin/data-check", icon: "shield", title: "Data check", sub: "What needs fixing, and who" },
            { key: "expenses", href: "/admin/expenses", icon: "receipt", title: "Expense reports", sub: "Approvals and the Chase statement" },
            { key: "forms", href: "/admin/forms", icon: "form", title: "Forms hub", sub: "Credit apps, account setups" },
            { key: "ops", href: "/admin/ops", icon: "ops", title: "AMBIT-OPS", sub: "Contractor workspaces" },
          ]}
        />
        <TileSection
          title="Help & content"
          tiles={[
            { key: "assistant", href: "/admin/assistant", icon: "spark", title: "Ask AMBIT", sub: "Teach the assistant" },
            { key: "docs", href: "/admin/docs", icon: "docs", title: "Docs & bulletins", sub: "TDS, SDS, ESR, TSB" },
            { key: "academy", href: "/admin/academy", icon: "academy", title: "Academy courses", sub: "Lessons and videos" },
            { key: "links", href: "/admin/links", icon: "link", title: "Home screen links", sub: "Jotform, marketing kit" },
          ]}
        />
      </div>
    </main>
  );
}
