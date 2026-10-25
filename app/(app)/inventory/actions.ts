"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { kickSync, syncBranch } from "@/lib/inventory/sync";

const BRANCH = /^[a-z]{2,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(branch: string, kind: "msg" | "err", text: string, anchor = ""): never {
  revalidatePath("/inventory");
  revalidatePath("/order");
  redirect(`/inventory?b=${branch}&${kind}=${encodeURIComponent(text)}${anchor ? `#${anchor}` : ""}`);
}

/** Warehouse: a count, a delivery received, or stock taken out. Goes to the spreadsheet right after. */
export async function stockChange(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "inventory")) return;
  const branch = String(form.get("branch") ?? "");
  const product = String(form.get("product") ?? "");
  const mode = String(form.get("mode") ?? "count");
  const sku = String(form.get("sku") ?? "").slice(0, 60);
  const raw = String(form.get("qty") ?? "").trim().replace(/,/g, "");
  if (!BRANCH.test(branch) || !UUID.test(product)) return;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) back(branch, "err", "Type a number (up to 2 decimals).", `p-${product}`);
  const qty = Number(raw);
  const { data, error } = await s.supabase.rpc("inventory_set_count", {
    p_branch: branch,
    p_product: product,
    p_qty: qty,
    p_mode: ["count", "received", "removed"].includes(mode) ? mode : "count",
    p_note: String(form.get("note") ?? "").trim().slice(0, 200) || null,
  });
  if (error) back(branch, "err", error.message, `p-${product}`);
  kickSync(branch, "stock change");
  const now = Number(data);
  back(
    branch,
    "msg",
    mode === "count" ? `${sku}: counted ${now}. It goes onto the spreadsheet in a few seconds.` : `${sku}: ${mode === "received" ? "added" : "taken out"}, now ${now} in stock.`,
    `p-${product}`,
  );
}

/** Read the spreadsheet now instead of waiting for the 2-minute timer. */
export async function syncNow(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "inventory")) return;
  const branch = String(form.get("branch") ?? "");
  const to = String(form.get("to") ?? "inventory");
  if (!BRANCH.test(branch)) return;
  const r = await syncBranch(branch, { force: true, why: "sync now" });
  const text = r.ok
    ? r.skipped === "another sync is running"
      ? "A sync was already running. Give it a few seconds and refresh."
      : `Synced. ${summaryText(r.summary)}`
    : r.error
      ? `The sync didn't finish: ${r.error}`
      : `Not synced: ${r.skipped}.`;
  revalidatePath("/inventory");
  revalidatePath("/admin/inventory");
  revalidatePath("/order");
  const kind = r.ok ? "msg" : "err";
  if (to === "admin") redirect(`/admin/inventory?${kind}=${encodeURIComponent(text)}`);
  redirect(`/inventory?b=${branch}&${kind}=${encodeURIComponent(text)}`);
}

function summaryText(s: { from_sheet: number; to_sheet: number; new_products: string[]; lines_added: number; sheet_closed: number; conflicts: number } | undefined): string {
  if (!s) return "";
  const bits = [
    s.from_sheet ? `${s.from_sheet} count${s.from_sheet === 1 ? "" : "s"} from the sheet` : "",
    s.to_sheet ? `${s.to_sheet} sent to the sheet` : "",
    s.new_products.length ? `${s.new_products.length} new item${s.new_products.length === 1 ? "" : "s"} added` : "",
    s.lines_added ? `${s.lines_added} order line${s.lines_added === 1 ? "" : "s"} added to PENDING ORDERS` : "",
    s.sheet_closed ? `${s.sheet_closed} pickup${s.sheet_closed === 1 ? "" : "s"} taken out of stock` : "",
    s.conflicts ? `${s.conflicts} changed on both sides (see the log)` : "",
  ].filter(Boolean);
  return bits.length ? `${bits.join(", ")}.` : "Everything already matched.";
}
