import { requireAdmin } from "@/lib/session";
import { emailConfigured } from "@/lib/email";
import { MICROSOFT_SIGNIN } from "@/lib/env";
import { ListLink, TopBar } from "@/components/ui";

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

  return (
    <main className="shell">
      <TopBar title="Admin" back="/profile" />
      {!mail ? (
        <div className="alert warn small">Email sending isn&apos;t set up yet. Orders are saved and listed under Orders, but nothing is emailed to orders@ambitpu.com.</div>
      ) : null}
      {!MICROSOFT_SIGNIN ? (
        <div className="alert info small">&ldquo;Sign in with Microsoft&rdquo; is off. Until IT finishes the Microsoft set-up, add AMBIT staff by having them request access, then set their role to Employee here.</div>
      ) : null}
      <div className="list">
        <ListLink href="/admin/assistant" icon="spark" title="Ask AMBIT" sub="Teach the assistant, answer questions sent to AMBIT's expert, settings" />
        <ListLink href="/admin/users" icon="users" title="Accounts" sub={`${pending.count ?? 0} waiting for approval`} />
        <ListLink href="/admin/companies" icon="building" title="Customers" sub={`${companies.count ?? 0} companies · sales reps`} />
        <ListLink href="/admin/sales-goals" icon="target" title="Sales goals" sub="Monthly goals by product group for sales reps and warehouse managers" />
        <ListLink href="/admin/products" icon="box" title="Products & pricing" sub={`${products.count ?? 0} active products`} />
        <ListLink href="/orders?status=new" icon="cart" title="Orders" sub={`${newOrders.count ?? 0} new`} />
        <ListLink href="/admin/inventory" icon="boxes" title="Inventory" sub="Live stock from each location's spreadsheet (Microsoft connection)" />
        <ListLink href="/admin/expenses" icon="receipt" title="Expense reports" sub="Every employee's receipts and monthly reports" />
        <ListLink href="/admin/forms" icon="form" title="Forms hub" sub="Credit applications, account setups and every Jotform form" />
        <ListLink href="/admin/promos" icon="megaphone" title="Home banner" sub="Sale slides and news at the top of Home" />
        <ListLink href="/admin/links" icon="link" title="Home screen links & forms" sub="Jotform links, marketing kit, videos" />
        <ListLink href="/admin/docs" icon="docs" title="Docs & bulletins" sub="TDS, SDS, ESR, TSB uploads" />
        <ListLink href="/admin/academy" icon="academy" title="Academy courses" />
        <ListLink href="/admin/branches" icon="pin" title="Branches" sub="Addresses and phone numbers" />
      </div>
    </main>
  );
}
