import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, ChevronRight, FileSignature, Ruler, Truck, Users, Wallet } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { TopBar } from "@/components/ui";

export const metadata = { title: "AMBIT-OPS" };
export const dynamic = "force-dynamic";

// AMBIT-OPS: the contractor operations software being built inside AMBIT Intelligence. Takeoff is the
// first piece; the rest are listed so everyone can see where it's going. Open to the Takeoff box for now.

const PLANNED = [
  { icon: FileSignature, title: "Quoting & proposals", text: "Turn a takeoff into an estimate and a branded proposal, then into an AMBIT order." },
  { icon: Users, title: "CRM", text: "Customers, leads, contacts and every job in one place." },
  { icon: Truck, title: "Dispatching", text: "Send crews and rigs to jobs; see who's where today." },
  { icon: CalendarRange, title: "Job scheduling", text: "The crew and job calendar, with reminders for the customer." },
  { icon: Wallet, title: "Job costing & yield", text: "Sets used, board feet sprayed and real profit on every job." },
];

export default async function OpsPage() {
  const { supabase, profile } = await requireActive();
  if (!can(profile, "takeoff")) redirect("/");
  const { count } = await supabase.from("takeoffs").select("id", { count: "exact", head: true });

  return (
    <main className="shell wide">
      <TopBar title="AMBIT-OPS" back="/" />
      <section className="ops-hero">
        <span className="eyebrow">Contractor operations software</span>
        <h2>Everything a spray foam and insulation contractor runs on, inside AMBIT Intelligence.</h2>
        <p>Takeoff is live. Quoting, CRM, dispatching and more are being built here next.</p>
      </section>

      <div className="ops-grid">
        <Link href="/takeoff" className="ops-card live">
          <span className="ops-ic"><Ruler size={22} /></span>
          <span className="col tight grow" style={{ minWidth: 0 }}>
            <span className="row" style={{ gap: 8, alignItems: "center" }}>
              <b>Takeoff</b>
              <span className="pill ok">Live</span>
            </span>
            <span className="s">Upload plans, measure areas, walls and counts, and get board feet and materials.</span>
            <span className="tiny faint">{count ?? 0} takeoff{count === 1 ? "" : "s"}</span>
          </span>
          <ChevronRight size={18} className="chev" />
        </Link>
        {PLANNED.map((m) => (
          <div key={m.title} className="ops-card soon" aria-disabled="true">
            <span className="ops-ic"><m.icon size={22} /></span>
            <span className="col tight grow" style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 8, alignItems: "center" }}>
                <b>{m.title}</b>
                <span className="pill grey">Planned</span>
              </span>
              <span className="s">{m.text}</span>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
