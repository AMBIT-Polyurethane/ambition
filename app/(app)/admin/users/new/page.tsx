import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { InviteForm } from "@/components/invite-form";
import { ORDER_CUSTOMER_COLUMNS, type OrderCustomer } from "@/lib/customers";
import type { Branch } from "@/lib/types";

export const metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  const { supabase } = await requireAdmin();
  const [{ data: companies }, { data: branches }] = await Promise.all([
    supabase.from("companies").select(ORDER_CUSTOMER_COLUMNS).eq("active", true).order("name").limit(5000),
    supabase.from("branches").select("*").eq("active", true).order("sort"),
  ]);
  return (
    <main className="shell">
      <TopBar title="Create an account" back="/admin/users" />
      <p className="muted small" style={{ margin: 0 }}>
        Set someone up yourself instead of waiting for them to request access. They get a link to create their password,
        and everything you pick here is already in place when they sign in.
      </p>
      <InviteForm customers={(companies ?? []) as OrderCustomer[]} branches={(branches ?? []) as Branch[]} />
    </main>
  );
}
