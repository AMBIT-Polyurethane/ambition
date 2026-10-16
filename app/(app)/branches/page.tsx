import { MapPin, Phone, Mail } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar } from "@/components/ui";
import type { Branch } from "@/lib/types";

export const metadata = { title: "Branches" };

export default async function BranchesPage() {
  const { supabase } = await requireActive();
  const { data } = await supabase.from("branches").select("*").eq("active", true).order("sort");
  const branches = (data ?? []) as Branch[];
  return (
    <main className="shell">
      <TopBar title="AMBIT branches" back="/" />
      <div className="col">
        {branches.map((b) => (
          <div key={b.id} className="card col" style={{ gap: 10 }}>
            <div className="row between">
              <div className="h2" style={{ fontSize: 18 }}>{b.name}, {b.state}</div>
              <span className="pill grey">Pickup</span>
            </div>
            {b.address ? <div className="muted small" style={{ whiteSpace: "pre-wrap" }}>{b.address}</div> : <div className="faint small">Address coming soon</div>}
            <div className="row wrap" style={{ gap: 8 }}>
              {b.address ? (
                <a className="btn sm dark" href={`https://maps.google.com/?q=${encodeURIComponent(`${b.address}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Directions</a>
              ) : null}
              {b.phone ? <a className="btn sm dark" href={`tel:${b.phone.replace(/[^\d+]/g, "")}`}><Phone size={14} /> {b.phone}</a> : null}
              {b.email ? <a className="btn sm dark" href={`mailto:${b.email}`}><Mail size={14} /> Email</a> : null}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
