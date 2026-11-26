"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { msDisconnect } from "@/lib/microsoft";
import { kickSync, syncBranch } from "@/lib/inventory/sync";

function back(kind: "msg" | "err", text: string): never {
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  revalidatePath("/order");
  redirect(`/admin/inventory?${kind}=${encodeURIComponent(text)}`);
}

async function admin() {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") return null;
  return s;
}

/** A branch's spreadsheet link, and whether the app uses it. */
export async function saveSheet(form: FormData) {
  const s = await admin();
  if (!s) return;
  const branch = String(form.get("branch") ?? "");
  const url = String(form.get("url") ?? "").trim();
  const enabled = form.get("enabled") === "on";
  if (!/^[a-z]{2,8}$/.test(branch)) back("err", "Pick a location.");
  if (!/^https:\/\/[^\s]+\.(sharepoint\.com|onedrive\.live\.com|1drv\.ms)\//i.test(url)) {
    back("err", "Paste the spreadsheet's Share link (it starts with https:// and has sharepoint.com in it).");
  }
  const { data: before } = await s.supabase.from("inventory_sheets").select("share_url").eq("branch_id", branch).maybeSingle<{ share_url: string }>();
  const changed = !before || before.share_url !== url;
  const patch = {
    branch_id: branch,
    share_url: url,
    enabled,
    updated_at: new Date().toISOString(),
    // A different workbook starts fresh: the app takes its counts and remembers its lines again.
    ...(changed ? { drive_id: null, item_id: null, file_name: null, row_seen: null, connected_at: null, last_error: null } : {}),
  };
  const { error } = await s.supabase.from("inventory_sheets").upsert(patch);
  if (error) back("err", error.message);
  if (enabled) kickSync(branch, "sheet saved");
  back("msg", changed ? "Saved. The app reads the new spreadsheet now." : enabled ? "Saved." : "Saved. The app no longer uses this spreadsheet.");
}

export async function disconnectMicrosoft() {
  const s = await admin();
  if (!s) return;
  await msDisconnect();
  back("msg", "Disconnected from Microsoft. Stock stays as it is until someone connects again.");
}

/** Retire a location's spreadsheet (0120): one last sync, then A.I. is the only inventory record there. */
export async function retireSheet(form: FormData) {
  const s = await admin();
  if (!s) return;
  const branch = String(form.get("branch") ?? "");
  if (!/^[a-z]{2,8}$/.test(branch)) back("err", "Pick a location.");
  if (form.get("sure") !== "on") back("err", "Tick the box to confirm first.");
  // Whatever was typed on the spreadsheet since the last sync comes in first.
  const last = await syncBranch(branch, { force: true, why: "retiring the spreadsheet" });
  // No Microsoft connection: retire anyway (an admin chose to); anything typed on the file since the last sync stays there.
  const noMs = /microsoft/i.test(last.skipped ?? "");
  if (!last.ok && !noMs && !/retired|no spreadsheet/i.test(last.skipped ?? "")) {
    back("err", `The last sync didn't finish, so the spreadsheet wasn't retired: ${last.error ?? last.skipped ?? "try again in a minute"}`);
  }
  if (last.skipped === "another sync is running") back("err", "A sync is running right now. Try again in a minute.");
  const { data, error } = await s.supabase.rpc("inventory_retire_sheet", { p_branch: branch });
  if (error) back("err", /inventory_retire_sheet/.test(error.message) ? "Run the 0120 database update in Supabase first (SQL Editor)." : error.message);
  const r = (data ?? {}) as { already?: boolean };
  back(
    "msg",
    r.already
      ? "That spreadsheet was already retired."
      : `Retired. A.I. is now the only inventory record for this location. Move the spreadsheet into an Archive folder so nobody types in it.${noMs ? " (Microsoft wasn't connected, so nothing new was read from the file first.)" : ""}`,
  );
}
