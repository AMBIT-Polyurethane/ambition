import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadQuote } from "@/lib/ops/quotes";
import { proposalOf, type Proposal } from "@/lib/ops/proposal";
import type { Workspace } from "@/lib/ops/server";

/** The proposal for one of the contractor's own quotes (also a draft that has no link yet). */
export async function proposalForQuote(supabase: SupabaseClient, ws: Workspace, id: string): Promise<{ p: Proposal; token: string | null } | null> {
  const loaded = await loadQuote(supabase, id);
  if (!loaded) return null;
  const q = loaded.quote;
  if (q.public_token) {
    const { data } = await supabase.rpc("ops_proposal", { p_token: q.public_token, p_count: false });
    const p = proposalOf(data);
    if (p) return { p, token: q.public_token };
  }
  const [{ data: cust }, { data: prop }] = await Promise.all([
    supabase.from("ops_customers").select("name, email, phone").eq("id", q.customer_id).maybeSingle(),
    q.property_id ? supabase.from("ops_properties").select("street, city, state, zip").eq("id", q.property_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const st = ws.settings;
  const p = proposalOf({
    quote: { ...q, signed_addons: q.signed_addons ?? [] },
    company: { name: ws.brand, logo_path: ws.company.ops_logo_path, phone: st.phone || null, email: st.email || null, website: st.website || null, address: st.address || null, license_no: st.license_no || null, color: st.color || null, show_line_prices: st.show_line_prices, work_areas: st.work_areas },
    customer: cust ?? null,
    property: prop ?? null,
    options: loaded.options.map((o) => ({ id: o.id, name: o.name, note: o.note })),
    lines: loaded.lines,
  });
  return p ? { p, token: null } : null;
}
