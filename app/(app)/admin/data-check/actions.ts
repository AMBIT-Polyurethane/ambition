"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { buildCheckEmail, loadCheck, ownerEmails, ownersOf } from "@/lib/data-check";

function back(kind: "msg" | "err", text: string, hash = ""): never {
  revalidatePath("/admin/data-check");
  redirect(`/admin/data-check?${kind}=${encodeURIComponent(text)}${hash}`);
}

/** Admins: email one person (or team) their list from the data check, after reading it on the page. */
export async function sendCheckEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") back("err", "Only an admin can send these.");
  const owner = String(form.get("owner") ?? "");
  const { rows, error } = await loadCheck(s!.supabase);
  if (error) back("err", error);
  const mine = rows.filter((r) => ownersOf(r).includes(owner));
  if (!mine.length) back("err", `Nothing is on ${owner} any more.`);
  const to = await ownerEmails(s!.supabase, owner);
  if (!to.length) back("err", `No email on file for ${owner}. Add it in Admin > Accounts.`);
  const from = s!.profile.full_name ?? "AMBIT";
  const origin = await currentOrigin();
  const mail = buildCheckEmail(owner, mine, from, `${origin}/`);
  const sent = await sendEmail({ to: to.map((p) => p.email), replyTo: s!.profile.email ?? undefined, ...mail });
  if (sent.status !== "sent") back("err", `The email to ${owner} didn't go out (${sent.error ?? sent.status}).`);
  back("msg", `Sent to ${to.map((p) => p.name).join(", ")}.`);
}

/** Admins: two rows of the same lot become one (0080). */
export async function mergeLots(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") back("err", "Only an admin can merge lots.");
  const keep = Number(form.get("keep"));
  const extra = Number(form.get("extra"));
  const { data, error } = await s!.supabase.rpc("inventory_lot_merge", { p_keep: keep, p_extra: extra });
  if (error) back("err", error.message.replace(/^.*?ERROR:\s*/, ""));
  back("msg", `Merged into lot ${data}. FOAM LOTS updates in a couple of minutes; then delete the extra row there (it shows 0).`);
}
