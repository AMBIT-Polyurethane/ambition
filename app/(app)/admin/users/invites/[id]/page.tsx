import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { InviteForm, type EditInvite } from "@/components/invite-form";
import { ORDER_CUSTOMER_COLUMNS, type OrderCustomer } from "@/lib/customers";
import type { Branch } from "@/lib/types";

export const metadata = { title: "Edit invite" };
export const dynamic = "force-dynamic";

/**
 * Admin → Accounts → Invited → Edit: change an invite before the person uses it. Once they've set up
 * their login, the account itself is what gets edited, so this sends the admin there.
 */
export default async function EditInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireAdmin();
  const { data: inv } = await supabase
    .from("invites")
    .select("id, email, full_name, phone, role, company_id, branch_id, job_role, perms, note, accepted_at, cancelled_at")
    .eq("id", id)
    .maybeSingle<EditInvite & { accepted_at: string | null; cancelled_at: string | null }>();
  if (!inv) notFound();
  if (inv.accepted_at) {
    redirect(`/admin/users?tab=${inv.role === "customer" ? "customer" : "employee"}&q=${encodeURIComponent(inv.email)}`);
  }
  if (inv.cancelled_at) redirect(`/admin/users?tab=invited&error=${encodeURIComponent("That invite was cancelled. Create the account again.")}`);

  const [{ data: companies }, { data: branches }] = await Promise.all([
    supabase.from("companies").select(ORDER_CUSTOMER_COLUMNS).eq("active", true).order("name").limit(5000),
    supabase.from("branches").select("*").eq("active", true).order("sort"),
  ]);
  return (
    <main className="shell">
      <TopBar title="Edit invite" back="/admin/users?tab=invited" />
      <p className="muted small" style={{ margin: 0 }}>
        Change anything before they set up their login. Changing the email sends a fresh link to the new address.
      </p>
      <InviteForm customers={(companies ?? []) as OrderCustomer[]} branches={(branches ?? []) as Branch[]} invite={{ ...inv, perms: inv.perms ?? [] }} />
    </main>
  );
}
