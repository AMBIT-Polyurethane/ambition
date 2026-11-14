"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { serviceClient } from "@/lib/supabase/service";

const DEPTS = ["mfg", "lab", "sales", "tech", "admin"];

/** Admins: which Daily Pulse each person fills in (or none). */
export async function setPulseDept(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const db = serviceClient();
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("d:")) continue;
    const dept = DEPTS.includes(String(v)) ? String(v) : null;
    await db.from("profiles").update({ pulse_dept: dept }).eq("id", k.slice(2));
  }
  revalidatePath("/pulse");
}
