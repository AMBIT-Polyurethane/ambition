import { MapPinned, Plus } from "lucide-react";
import { requireOps, locationsOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { deleteLocation, saveLocation } from "../actions";

export const metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

export default async function LocationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.manage);
  const locations = await locationsOf(supabase, ws.company.id);
  return (
    <SettingsShell title="Locations" sp={sp}>
      <p className="muted small" style={{ margin: 0 }}>Most contractors have one. Add more if you run crews and stock out of more than one shop; leads, people and reports can then be split by location.</p>
      {locations.map((l) => (
        <form key={l.id} action={saveLocation} className="card col" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={l.id} />
          <div className="row" style={{ gap: 8, alignItems: "center" }}><MapPinned size={18} /><b>{l.name}</b></div>
          <div className="grid2">
            <input className="input sm" name="name" defaultValue={l.name} maxLength={60} aria-label="Name" />
            <input className="input sm" name="phone" defaultValue={l.phone ?? ""} maxLength={40} placeholder="Phone" aria-label="Phone" />
          </div>
          <input className="input sm" name="address" defaultValue={l.address ?? ""} maxLength={300} placeholder="Address" aria-label="Address" />
          <div className="row" style={{ gap: 8 }}>
            <Submit className="btn sm dark" pendingText="Saving…">Save</Submit>
            {locations.length > 1 ? (
              <button formAction={deleteLocation} className="btn sm ghost" type="submit">Remove</button>
            ) : null}
          </div>
        </form>
      ))}
      <form action={saveLocation} className="card col" style={{ gap: 10 }}>
        <b><Plus size={16} style={{ verticalAlign: -3 }} /> Add a location</b>
        <div className="grid2">
          <input className="input sm" name="name" required maxLength={60} placeholder="Name: Tulsa shop" aria-label="Name" />
          <input className="input sm" name="phone" maxLength={40} placeholder="Phone" aria-label="Phone" />
        </div>
        <input className="input sm" name="address" maxLength={300} placeholder="Address" aria-label="Address" />
        <Submit className="btn sm" pendingText="Adding…">Add location</Submit>
      </form>
    </SettingsShell>
  );
}
