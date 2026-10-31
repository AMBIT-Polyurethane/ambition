import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { loadWorkspace } from "@/lib/ops/server";
import { FieldApp } from "@/components/ops/field/field-app";

export const metadata = { title: "Work orders" };
export const dynamic = "force-dynamic";

// AMBIT-OPS crew work orders. The page itself is only the frame: the trips come from the phone's own
// copy and the database (components/ops/field), so it opens and works with no signal once it's been
// opened once with signal (public/sw.js keeps it on the phone).
export default async function FieldPage() {
  const { supabase, profile } = await requireActive();
  const ws = await loadWorkspace(supabase, profile);
  if (!ws) redirect("/ops");
  return <FieldApp userId={profile.id} brand={ws.brand} />;
}
