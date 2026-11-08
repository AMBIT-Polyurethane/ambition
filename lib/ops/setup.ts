import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { opsCan } from "@/lib/ops/roles";
import type { Workspace } from "@/lib/ops/server";

// AMBIT-OPS guided setup (owner and office): what's left before the first quote. The Home checklist,
// the AMBIT Intelligence guide and its coach all use this list, so they always agree on what's done.

export type SetupStep = {
  key: "company" | "products" | "pricing" | "team" | "customers" | "form";
  done: boolean;
  label: string;
  hint: string;
  href: string;
  /** What the guide says on that screen: exactly what to do there. */
  coach: string;
};

const STEPS: Omit<SetupStep, "done">[] = [
  {
    key: "company",
    label: "Add your logo and contact info",
    hint: "Your colors come from your logo",
    href: "/ops/settings/company",
    coach: "Tap Upload logo and pick your logo. I'll pull your colors out of it. Then fill in your phone, email and address and tap Save at the bottom.",
  },
  {
    key: "products",
    label: "Check your products and AMBIT costs",
    hint: "Foam sets and fiberglass are loaded from your AMBIT invoices",
    href: "/ops/settings/products",
    coach: "These are the products you buy from AMBIT, with your AMBIT cost. Check the yields and costs, add anything else you sell, then tap These look right.",
  },
  {
    key: "pricing",
    label: "Set labor rates and margins",
    hint: "Defaults are in; add your target and lowest margin",
    href: "/ops/settings/pricing",
    coach: "Type the margin you aim for and the lowest you'll go. Check the labor rates (foam is per set), then tap Save pricing and labor.",
  },
  {
    key: "team",
    label: "Invite your team",
    hint: "Office, sales and crews each get their own login",
    href: "/ops/settings/team",
    coach: "Under Invite someone, type their email, pick what they do (office, sales, crew) and send it. They get a link to make their own login.",
  },
  {
    key: "customers",
    label: "Bring in your customers",
    hint: "Upload a spreadsheet or add them as you go",
    href: "/ops/customers/import",
    coach: "Upload a spreadsheet of your customers from QuickBooks, Jobber or Excel. You'll match the columns and see every row before anything is saved.",
  },
  {
    key: "form",
    label: "Put the lead form on your website",
    hint: "Requests land right in your pipeline",
    href: "/ops/settings/lead-form",
    coach: "Copy the link or the code and send it to whoever runs your website. When it's up, tap I've put it on my website.",
  },
];

export async function setupSteps(supabase: SupabaseClient, ws: Workspace): Promise<SetupStep[]> {
  if (!opsCan.manage(ws.role)) return [];
  const co = ws.company.id;
  const [{ count: customers }, { count: team }, { count: products }, { count: invites }] = await Promise.all([
    supabase.from("ops_customers").select("id", { count: "exact", head: true }).eq("company_id", co),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", co).not("ops_role", "is", null),
    supabase.from("ops_products").select("id", { count: "exact", head: true }).eq("company_id", co).eq("active", true),
    supabase.from("invites").select("id", { count: "exact", head: true }).eq("company_id", co).is("accepted_at", null).is("cancelled_at", null),
  ]);
  const s = ws.settings;
  const reviewed = (((ws.company.ops_settings ?? {}) as Record<string, unknown>).reviewed ?? {}) as Record<string, boolean>;
  const done: Record<SetupStep["key"], boolean> = {
    company: !!ws.company.ops_logo_path && !!s.phone,
    products: !!reviewed.products && (products ?? 0) > 0,
    pricing: !!reviewed.labor && s.target_margin !== null && s.floor_margin !== null,
    team: (team ?? 0) + (invites ?? 0) > 1,
    customers: (customers ?? 0) > 0,
    form: !!reviewed.form,
  };
  return STEPS.map((x) => ({ ...x, done: done[x.key] }));
}
