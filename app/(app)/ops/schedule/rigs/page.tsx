import { CircleAlert, CircleCheck, KeyRound, Plus, Truck, UserRound } from "lucide-react";
import { requireOps, locationsOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { loadCrew, loadRigCrew, loadRigs } from "@/lib/ops/jobs-server";
import { RIG_COLORS, RIG_DEFAULTS, RIG_DOES, type CrewPerson, type Rig } from "@/lib/ops/schedule";
import { Submit } from "@/components/forms";
import { TopBar } from "@/components/ui";
import { addCrew, saveCrew, saveRig, setCrewActive, setRigActive } from "../actions";

export const metadata = { title: "Rigs and crews" };
export const dynamic = "force-dynamic";

export default async function RigsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.dispatch);
  // Team members with a crew login show up on the crew list by themselves.
  await supabase.rpc("ops_crew_sync");
  const [rigs, crew, rigCrew, locations] = await Promise.all([
    loadRigs(supabase, ws.company.id, true),
    loadCrew(supabase, ws.company.id, true),
    loadRigCrew(supabase, ws.company.id),
    locationsOf(supabase, ws.company.id),
  ]);
  const active = crew.filter((c) => c.active);
  return (
    <main className="shell">
      <TopBar title="Rigs and crews" back="/ops/schedule" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="small muted" style={{ margin: 0 }}>
        Each rig is a row on the schedule. &quot;A day&apos;s work&quot; is how much it usually does in a day; the schedule uses it to suggest how many days a job takes. The regular crew goes on every trip the rig gets (you can change it per trip).
      </p>

      {rigs.map((r) => (
        <RigForm key={r.id} rig={r} crew={active} regular={rigCrew.get(r.id) ?? []} locations={locations} />
      ))}
      <RigForm rig={null} crew={active} regular={[]} locations={locations} nextColor={RIG_COLORS[rigs.length % RIG_COLORS.length]} />

      <section className="col" style={{ gap: 10, marginTop: 8 }}>
        <div className="row between">
          <b style={{ fontSize: 17 }}>Crew</b>
          <span className="tiny faint">{active.length} on the list</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          People with a crew login (Settings › Team: crew lead, crew member or sub) are added here by themselves. Add helpers by name; they can get a login later.
        </p>
        {crew.length ? (
          <div className="list">
            {crew.map((c) => <CrewRow key={c.id} c={c} />)}
          </div>
        ) : null}
        <form action={addCrew} className="card col" style={{ gap: 10 }}>
          <b><Plus size={16} style={{ verticalAlign: -3 }} /> Add someone by name</b>
          <div className="grid2">
            <input className="input sm" name="name" required maxLength={60} placeholder="Name" aria-label="Name" />
            <input className="input sm" name="phone" maxLength={30} placeholder="Cell (optional)" aria-label="Cell" inputMode="tel" />
          </div>
          <Submit className="btn sm" pendingText="Adding…">Add to crew list</Submit>
        </form>
      </section>
    </main>
  );
}

function RigForm({ rig, crew, regular, locations, nextColor }: { rig: Rig | null; crew: CrewPerson[]; regular: { crew_id: string; lead: boolean }[]; locations: { id: string; name: string }[]; nextColor?: string }) {
  const r = rig;
  const color = r?.color ?? nextColor ?? RIG_COLORS[0];
  const lead = regular.find((x) => x.lead)?.crew_id ?? regular[0]?.crew_id ?? "";
  const on = new Set(regular.map((x) => x.crew_id));
  return (
    <form action={saveRig} className={`card col rig-form${r && !r.active ? " off" : ""}`} style={{ gap: 12 }}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <input type="hidden" name="crew_set" value="1" />
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <span className="rig-dot" style={{ background: color }} aria-hidden="true"><Truck size={15} /></span>
        <b className="grow">{r ? r.name : "Add a rig"}</b>
        {r && !r.active ? <span className="pill grey">Off the board</span> : null}
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Name</span>
          <input className="input sm" name="name" defaultValue={r?.name ?? ""} required maxLength={40} placeholder="Rig 1" />
        </label>
        <label className="field">
          <span className="label">Home shop</span>
          <select className="select sm" name="location_id" defaultValue={r?.location_id ?? locations[0]?.id ?? ""}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">What it does</legend>
        <div className="chips wrap ops-kinds">
          {RIG_DOES.map((d) => (
            <label key={d.key} className="chip">
              <input type="checkbox" name="does" value={d.key} defaultChecked={r ? r.does.includes(d.key) : d.key === "foam_oc" || d.key === "foam_cc"} /> {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">A day&apos;s work</legend>
        <div className="grid3">
          <label className="field"><span className="tiny faint">Open cell sets</span><input className="input sm" name="oc_sets_day" inputMode="decimal" defaultValue={r?.oc_sets_day ?? RIG_DEFAULTS.oc_sets_day} aria-label="Open cell sets a day" /></label>
          <label className="field"><span className="tiny faint">Closed cell sets</span><input className="input sm" name="cc_sets_day" inputMode="decimal" defaultValue={r?.cc_sets_day ?? RIG_DEFAULTS.cc_sets_day} aria-label="Closed cell sets a day" /></label>
          <label className="field"><span className="tiny faint">Sq ft of blown or batts</span><input className="input sm" name="sqft_day" inputMode="numeric" defaultValue={r?.sqft_day ?? RIG_DEFAULTS.sqft_day} aria-label="Square feet of blown or batts a day" /></label>
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Color on the schedule</legend>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {RIG_COLORS.map((c) => (
            <label key={c} className="rig-swatch" style={{ background: c }} title={c}>
              <input type="radio" name="color" value={c} defaultChecked={c === color} aria-label={`Color ${c}`} />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Regular crew</legend>
        {crew.length ? (
          <div className="crew-pick">
            {crew.map((c) => (
              <div key={c.id} className="crew-opt">
                <label className="check grow"><input type="checkbox" name="crew" value={c.id} defaultChecked={on.has(c.id)} /> {c.name}</label>
                <label className="tiny faint check"><input type="radio" name="lead" value={c.id} defaultChecked={c.id === lead} /> Lead</label>
              </div>
            ))}
          </div>
        ) : (
          <span className="small muted">Add people to the crew list below first.</span>
        )}
      </fieldset>
      <label className="field">
        <span className="label">Notes (optional)</span>
        <input className="input sm" name="notes" defaultValue={r?.notes ?? ""} maxLength={300} placeholder="Graco E-30, 300 ft hose" />
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Submit className="btn sm" pendingText="Saving…">{r ? "Save rig" : "Add rig"}</Submit>
        {r ? (
          <>
            <input type="hidden" name="on" value={r.active ? "0" : "1"} />
            <button formAction={setRigActive} className="btn sm ghost" type="submit">{r.active ? "Take off the board" : "Put back on the board"}</button>
          </>
        ) : null}
      </div>
    </form>
  );
}

function CrewRow({ c }: { c: CrewPerson }) {
  return (
    <form action={saveCrew} className={`item crew-row${c.active ? "" : " off"}`}>
      <input type="hidden" name="id" value={c.id} />
      <span className="ic">{c.profile_id ? <KeyRound size={16} /> : <UserRound size={16} />}</span>
      <div className="grow col tight" style={{ minWidth: 0, gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <input className="input sm" name="name" defaultValue={c.name} maxLength={60} aria-label="Name" style={{ flex: 2 }} />
          <input className="input sm" name="phone" defaultValue={c.phone ?? ""} maxLength={30} placeholder="Cell" aria-label="Cell" style={{ flex: 1.3 }} />
        </div>
        <span className="tiny faint">{c.profile_id ? "Has a login" : "Name only"}{c.active ? "" : " · off the list"}</span>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <Submit className="btn sm dark" pendingText="…">Save</Submit>
        <input type="hidden" name="on" value={c.active ? "0" : "1"} />
        <button formAction={setCrewActive} type="submit" className="btn sm ghost">{c.active ? "Remove" : "Add back"}</button>
      </div>
    </form>
  );
}
