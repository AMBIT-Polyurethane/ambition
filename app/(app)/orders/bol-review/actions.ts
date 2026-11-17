"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { bolCheckReady, bolsToCheck, checkOrderBol, markBolError } from "@/lib/order-doc/bol-check";

const PER_CALL = 4;

/** Admins: read the next few signed BOLs that haven't been read yet (BOL review calls this until none are left). */
export async function checkBolBatch(): Promise<{ ok: true; done: number; failed: string[]; left: number; cents: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return { ok: false, error: "Only an admin can do that." };
  if (!bolCheckReady()) return { ok: false, error: "The app's connection to Claude isn't set up (ANTHROPIC_API_KEY in Vercel)." };
  const todo = await bolsToCheck(s.supabase);
  const now = todo.slice(0, PER_CALL);
  // Each read gets 45 seconds (the page has 60): one that takes longer is set aside so the next round moves on.
  const res = await Promise.all(
    now.map(async (o) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<{ ok: false; error: string; cost: number; late: true }>((r) => {
        timer = setTimeout(() => r({ ok: false, error: "took too long to read (use Read it again)", cost: 0, late: true }), 45_000);
      });
      const r = await Promise.race([checkOrderBol(s.supabase, o.id), late]);
      clearTimeout(timer);
      if ("late" in r) await markBolError(s.supabase, o.id, r.error);
      return { ...r, no: o.order_no };
    }),
  );
  if (res.some((r) => r.error && /order_bol_check_save/.test(r.error))) return { ok: false, error: "This needs the 0082 database update first (Supabase > SQL Editor)." };
  return {
    ok: true,
    done: res.filter((r) => r.ok).length,
    failed: res.filter((r) => !r.ok).map((r) => `ORD-${r.no}: ${r.error ?? "couldn't be read"}`),
    left: Math.max(0, todo.length - now.length),
    cents: res.reduce((t, r) => t + (r.cost ?? 0), 0),
  };
}

function back(to: string, kind: "msg" | "err", text: string): never {
  revalidatePath("/orders/bol-review");
  revalidatePath("/admin/data-check");
  const [path, hash] = to.split("#");
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}${hash ? `#${hash}` : ""}`);
}

const safeBack = (v: FormDataEntryValue | null) => {
  const b = String(v ?? "");
  return b.startsWith("/orders/bol-review") || b.startsWith("/admin/data-check") ? b : "/orders/bol-review";
};

/** Admins: read one order's signed BOL again (after a new photo, or when the AI couldn't read it). */
export async function recheckBol(form: FormData) {
  const s = await getSession();
  const to = safeBack(form.get("back"));
  if (!s?.profile || s.profile.role !== "admin") back(to, "err", "Only an admin can do that.");
  const id = String(form.get("order") ?? "");
  const r = await checkOrderBol(s!.supabase, id);
  back(to, r.ok ? "msg" : "err", r.ok ? "Read it again." : `Couldn't read it: ${r.error}`);
}

/** Admins: the AI got this one wrong ("Looks right"), or undo that. */
export async function bolLooksRight(form: FormData) {
  const s = await getSession();
  const to = safeBack(form.get("back"));
  if (!s?.profile || s.profile.role !== "admin") back(to, "err", "Only an admin can do that.");
  const ok = String(form.get("ok") ?? "1") === "1";
  const { error } = await s!.supabase.rpc("order_bol_check_ok", { p_order: String(form.get("order") ?? ""), p_ok: ok, p_note: String(form.get("note") ?? "") || null });
  if (error) back(to, "err", error.message);
  back(to, "msg", ok ? "Marked as looking right. It's off the Data check." : "Undone: the AI's findings are back.");
}
