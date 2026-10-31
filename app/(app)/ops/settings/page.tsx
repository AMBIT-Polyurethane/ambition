import Link from "next/link";
import { Building2, ChevronRight, ClipboardCheck, Globe, LifeBuoy, MapPinned, Package, SlidersHorizontal, SquareKanban, Truck, Users } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { TopBar } from "@/components/ui";

export const metadata = { title: "OPS settings" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "company", icon: Building2, title: "Company and logo", sub: "Name, logo, phone, address and brand color on everything customers see" },
  { href: "team", icon: Users, title: "Team", sub: "Invite people and set what each role can do" },
  { href: "pricing", icon: SlidersHorizontal, title: "Pricing, margins and labor", sub: "Target and lowest margin, labor rates, waste, tax, how crews measure foam" },
  { href: "products", icon: Package, title: "Products and AMBIT costs", sub: "Foam sets, fiberglass and supplies with your AMBIT invoice prices and yields" },
  { href: "pipeline", icon: SquareKanban, title: "Pipeline and lists", sub: "Lead stages, lead sources, lost reasons, work areas, services" },
  { href: "locations", icon: MapPinned, title: "Locations", sub: "Shops or branches, each with its own crews and stock" },
  { href: "/ops/schedule/rigs", icon: Truck, title: "Rigs and crews", sub: "Each rig, what it sprays in a day, and its regular crew" },
  { href: "work-orders", icon: ClipboardCheck, title: "Work orders", sub: "Send finished spray logs to AMBIT tech support, and how crews enter foam" },
  { href: "lead-form", icon: Globe, title: "Website lead form", sub: "A link or a block for your website; requests go straight to Leads" },
  { href: "support", icon: LifeBuoy, title: "Let AMBIT help", sub: "Let AMBIT open your workspace to help, and see every visit", owner: true },
] as const;

export default async function OpsSettingsPage() {
  const { ws } = await requireOps(opsCan.manage);
  return (
    <main className="shell">
      <TopBar title="Settings" back="/ops" />
      <div className="list">
        {SECTIONS.filter((x) => !("owner" in x) || ws.role === "owner").map((x) => (
          <Link key={x.href} href={x.href.startsWith("/") ? x.href : `/ops/settings/${x.href}`} className="item">
            <div className="ic"><x.icon size={18} /></div>
            <div className="grow">
              <div className="t">{x.title}</div>
              <div className="s">{x.sub}</div>
            </div>
            <ChevronRight size={18} className="chev" />
          </Link>
        ))}
      </div>
    </main>
  );
}
