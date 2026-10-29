import { requireOps, teamOf, locationsOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { TopBar } from "@/components/ui";
import { LeadForm } from "./lead-form";
import type { CustomerHit } from "../../crm-actions";

export const metadata = { title: "New lead" };
export const dynamic = "force-dynamic";

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile, ws } = await requireOps(opsCan.editCrm);
  const [team, locations, picked] = await Promise.all([
    teamOf(supabase, ws.company.id),
    locationsOf(supabase, ws.company.id),
    sp.customer
      ? supabase.from("ops_customers").select("id, name, phone, email, properties:ops_properties(id, label, street, city, state, zip)").eq("id", sp.customer).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const reps = team.filter((m) => ["owner", "office", "sales", "dispatcher"].includes(m.ops_role ?? ""));
  return (
    <main className="shell">
      <TopBar title="New lead" back={sp.customer ? `/ops/customers/${sp.customer}` : "/ops/pipeline"} />
      <LeadForm
        customer={(picked.data as unknown as CustomerHit) ?? null}
        propertyId={sp.property ?? null}
        services={ws.settings.services}
        sources={ws.settings.sources}
        reps={reps.map((m) => ({ id: m.id, name: m.full_name || m.email }))}
        me={profile.id}
        defaultRep={ws.role === "sales" ? profile.id : ""}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      />
    </main>
  );
}
