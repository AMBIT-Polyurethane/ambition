import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { canSalesAll, canSalesHub } from "@/lib/access";
import { crmLeads, repList } from "@/lib/crm";
import { TopBar } from "@/components/ui";
import { SalesNav } from "@/components/sales/sales-nav";
import { LeadBoard } from "@/components/sales/lead-board";
import { RepPicker } from "@/components/sales/rep-picker";

export const dynamic = "force-dynamic";
export const metadata = { title: "New-customer pipeline" };

/** New customers, from the first conversation to their second order. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canSalesHub(profile)) redirect("/");
  const all = canSalesAll(profile);
  const pick = all ? (sp.rep ?? "all") : profile.id;
  const who = pick === "all" ? null : pick;
  const [leads, reps, { data: cos }] = await Promise.all([
    crmLeads(supabase, who),
    all ? repList(supabase) : Promise.resolve([{ id: profile.id, name: profile.full_name ?? "Me" }]),
    supabase.from("companies").select("id, name").eq("active", true).order("name").limit(3000),
  ]);
  return (
    <main className="shell full crm">
      <TopBar title="New-customer pipeline" right={all ? <RepPicker reps={reps} value={pick} me={profile.id} /> : undefined} />
      <SalesNav on="pipeline" all={all} admin={profile.role === "admin"} />
      <p className="small muted" style={{ margin: 0 }}>
        Every new customer you&apos;re working on, from the first conversation to their second order. Move a card with its arrows; once they have a customer account in A.I., pick it on the card so their orders show here.
      </p>
      <LeadBoard leads={leads} reps={reps} me={profile.id} all={all} customers={(cos ?? []) as { id: string; name: string }[]} />
    </main>
  );
}
