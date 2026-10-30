"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { RIG_COLORS, RIG_DOES, isDay } from "@/lib/ops/schedule";

// AMBIT-OPS scheduling: rigs and crews (forms), and the rig board and job page (called from the
// screen). Saved with the person's own login; the database checks the role and the workspace.

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
const UUID = /^[0-9a-f-]{36}$/i;
const RIGS = "/ops/schedule/rigs";

export type Done = { ok: true; msg?: string } | { ok: false; error: string };
const fail = (e: { message: string } | null | undefined, fallback = "That didn't save. Try again."): Done => ({ ok: false, error: e?.message || fallback });

function perDay(v: string, max: number) {
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

// ------------------------------------------------------------------ rigs
export async function saveRig(f: FormData) {
  const { supabase, ws } = await requireOps(opsCan.dispatch);
  const id = s(f, "id");
  const does = f.getAll("does").map(String).filter((d) => RIG_DOES.some((x) => x.key === d));
  const oc = perDay(s(f, "oc_sets_day"), 50);
  const cc = perDay(s(f, "cc_sets_day"), 50);
  const sq = perDay(s(f, "sqft_day"), 200000);
  const row = {
    name: s(f, "name").slice(0, 40),
    location_id: UUID.test(s(f, "location_id")) ? s(f, "location_id") : null,
    does: does.length ? does : ["other"],
    color: RIG_COLORS.includes(s(f, "color")) ? s(f, "color") : null,
    oc_sets_day: oc ?? 1,
    cc_sets_day: cc ?? 2,
    sqft_day: sq ?? 4000,
    notes: s(f, "notes").slice(0, 300) || null,
  };
  if (!row.name) go(RIGS, "err", "Name the rig (for example Rig 1 or the truck's name).");
  let rigId = id;
  if (id) {
    const { error } = await supabase.from("ops_rigs").update(row).eq("id", id);
    if (error) go(RIGS, "err", error.message);
  } else {
    const { count } = await supabase.from("ops_rigs").select("id", { count: "exact", head: true }).eq("company_id", ws.company.id);
    const { data, error } = await supabase
      .from("ops_rigs")
      .insert({ ...row, company_id: ws.company.id, sort: count ?? 0, color: row.color ?? RIG_COLORS[(count ?? 0) % RIG_COLORS.length] })
      .select("id")
      .single();
    if (error || !data) go(RIGS, "err", error?.message ?? "That rig didn't save.");
    rigId = data!.id;
  }
  const crew = f.getAll("crew").map(String).filter((c) => UUID.test(c));
  const lead = s(f, "lead");
  if (f.has("crew_set")) {
    const { error } = await supabase.rpc("ops_rig_set_crew", { p_rig: rigId, p_crew: crew, p_lead: UUID.test(lead) && crew.includes(lead) ? lead : crew[0] ?? null });
    if (error) go(RIGS, "err", error.message);
  }
  revalidatePath(RIGS);
  revalidatePath("/ops/schedule");
  go(RIGS, "msg", id ? `${row.name} saved.` : `${row.name} added.`);
}

export async function setRigActive(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const on = s(f, "on") === "1";
  const { error } = await supabase.from("ops_rigs").update({ active: on }).eq("id", s(f, "id"));
  if (error) go(RIGS, "err", error.message);
  revalidatePath(RIGS);
  revalidatePath("/ops/schedule");
  go(RIGS, "msg", on ? "Rig is back on the board." : "Rig taken off the board. Its past trips stay.");
}

// ------------------------------------------------------------------ crew
export async function addCrew(f: FormData) {
  const { supabase, ws } = await requireOps(opsCan.dispatch);
  const name = s(f, "name").slice(0, 60);
  if (name.length < 2) go(RIGS, "err", "Type the person's name.");
  const { error } = await supabase.from("ops_crew").insert({ company_id: ws.company.id, name, phone: s(f, "phone").slice(0, 30) || null });
  if (error) go(RIGS, "err", error.message);
  revalidatePath(RIGS);
  go(RIGS, "msg", `${name} added to your crew list.`);
}

export async function saveCrew(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const name = s(f, "name").slice(0, 60);
  if (name.length < 2) go(RIGS, "err", "Type the person's name.");
  const { error } = await supabase.from("ops_crew").update({ name, phone: s(f, "phone").slice(0, 30) || null }).eq("id", s(f, "id"));
  if (error) go(RIGS, "err", error.message);
  revalidatePath(RIGS);
  go(RIGS, "msg", `${name} saved.`);
}

export async function setCrewActive(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const on = s(f, "on") === "1";
  const { error } = await supabase.from("ops_crew").update({ active: on }).eq("id", s(f, "id"));
  if (error) go(RIGS, "err", error.message);
  revalidatePath(RIGS);
  go(RIGS, "msg", on ? "Back on the crew list." : "Taken off the crew list. Past trips keep their name.");
}

// ------------------------------------------------------------------ the rig board
export async function scheduleTrip(input: { trip: string; rig: string | null; start: string; days: number; time?: string | null; crew?: string[] | null }): Promise<Done> {
  const { supabase } = await requireOps(opsCan.dispatch);
  if (!UUID.test(input.trip)) return { ok: false, error: "Trip not found." };
  if (!isDay(input.start)) return { ok: false, error: "Pick a day." };
  const time = input.time && /^\d{1,2}:\d{2}$/.test(input.time) ? input.time : null;
  const { error } = await supabase.rpc("ops_trip_schedule", {
    p_trip: input.trip,
    p_rig: input.rig && UUID.test(input.rig) ? input.rig : null,
    p_start: input.start,
    p_days: Math.max(1, Math.min(60, Math.round(Number(input.days) || 1))),
    p_time: time,
    p_crew: input.crew ? input.crew.filter((c) => UUID.test(c)) : null,
  });
  if (error) return fail(error);
  revalidatePath("/ops/schedule");
  return { ok: true };
}

export async function unscheduleTrip(trip: string): Promise<Done> {
  const { supabase } = await requireOps(opsCan.dispatch);
  const { error } = await supabase.rpc("ops_trip_unschedule", { p_trip: trip });
  if (error) return fail(error);
  revalidatePath("/ops/schedule");
  return { ok: true };
}

export async function setTripCrew(trip: string, crew: string[], lead: string | null): Promise<Done> {
  const { supabase } = await requireOps(opsCan.dispatch);
  const ids = crew.filter((c) => UUID.test(c));
  const { error } = await supabase.rpc("ops_trip_set_crew", { p_trip: trip, p_crew: ids, p_lead: lead && ids.includes(lead) ? lead : ids[0] ?? null });
  if (error) return fail(error);
  revalidatePath("/ops/schedule");
  return { ok: true };
}

export async function saveTrip(trip: string, patch: { name?: string; notes?: string }): Promise<Done> {
  const { supabase } = await requireOps(opsCan.dispatch);
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim().slice(0, 80);
    if (!n) return { ok: false, error: "Name the trip." };
    row.name = n;
    row.name_auto = false;
  }
  if (patch.notes !== undefined) row.notes = patch.notes.trim().slice(0, 1000) || null;
  const { error } = await supabase.from("ops_trips").update(row).eq("id", trip);
  if (error) return fail(error);
  revalidatePath("/ops/schedule");
  return { ok: true };
}

/** Moves the picked work into another trip (null = a new trip). */
export async function moveLines(lines: string[], trip: string | null, name?: string): Promise<Done> {
  const { supabase } = await requireOps(opsCan.dispatch);
  const ids = lines.filter((l) => UUID.test(l));
  if (!ids.length) return { ok: false, error: "Tick the work to move first." };
  const { error } = await supabase.rpc("ops_lines_to_trip", { p_lines: ids, p_trip: trip && UUID.test(trip) ? trip : null, p_name: name?.trim() || null });
  if (error) return fail(error);
  revalidatePath("/ops/schedule");
  return { ok: true, msg: trip ? "Moved." : "New trip made. Put it on the board when you're ready." };
}

// ------------------------------------------------------------------ jobs
export async function saveJobNotes(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const id = s(f, "id");
  const back = `/ops/jobs/${id}`;
  const { error } = await supabase.from("ops_jobs").update({ crew_notes: s(f, "crew_notes").slice(0, 2000) || null }).eq("id", id);
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  go(back, "msg", "Saved. The crew sees these notes on every trip.");
}

export async function cancelJob(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const id = s(f, "id");
  const back = `/ops/jobs/${id}`;
  const { error } = await supabase.from("ops_jobs").update({ status: "cancelled" }).eq("id", id);
  if (error) go(back, "err", error.message);
  await supabase.from("ops_trips").update({ status: "cancelled" }).eq("job_id", id).in("status", ["unscheduled", "scheduled"]);
  revalidatePath("/ops/schedule");
  revalidatePath(back);
  go(back, "msg", "Job cancelled. Its trips are off the board.");
}

export async function reopenJob(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const id = s(f, "id");
  const back = `/ops/jobs/${id}`;
  const { error } = await supabase.from("ops_jobs").update({ status: "open" }).eq("id", id);
  if (error) go(back, "err", error.message);
  await supabase.from("ops_trips").update({ status: "unscheduled", start_date: null, rig_id: null }).eq("job_id", id).eq("status", "cancelled");
  revalidatePath("/ops/schedule");
  go(back, "msg", "Job open again. Its trips are back in the not-scheduled list.");
}

/** A quote signed before jobs existed. */
export async function makeJob(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const quote = s(f, "quote");
  const { data, error } = await supabase.rpc("ops_quote_make_job", { p_quote: quote });
  if (error || !data) go(`/ops/quotes/${quote}`, "err", error?.message ?? "That didn't work.");
  revalidatePath("/ops/schedule");
  redirect(`/ops/jobs/${data}?msg=${encodeURIComponent("Job made. Put its trip on the board.")}`);
}

/** The customer said yes without signing online (signed paper, in person, by phone). */
export async function markSold(input: { quote: string; option: string; addons: string[]; note: string }): Promise<Done & { job?: string }> {
  const { supabase } = await requireOps(opsCan.quote);
  if (!UUID.test(input.quote) || !UUID.test(input.option)) return { ok: false, error: "Pick the option they chose." };
  const { data, error } = await supabase.rpc("ops_quote_mark_sold", {
    p_quote: input.quote,
    p_option: input.option,
    p_addons: input.addons.filter((a) => UUID.test(a)),
    p_note: input.note.trim().slice(0, 300),
  });
  if (error) return fail(error);
  revalidatePath(`/ops/quotes/${input.quote}`);
  revalidatePath("/ops/schedule");
  return { ok: true, job: (data as string | null) ?? undefined };
}
