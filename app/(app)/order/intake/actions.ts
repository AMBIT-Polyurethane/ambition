"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { claudeReady, friendlyClaudeError } from "@/lib/ai/claude";
import { readOrder, type DraftItem } from "@/lib/intake/read";

const UUID = /^[0-9a-f-]{36}$/i;

/** Reads a pasted / photographed order and saves it as a draft to check. */
export async function readIntake(input: { text: string; photos: string[] }): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await requirePerm("ordering");
  const text = String(input.text ?? "").slice(0, 12000);
  const photos = (input.photos ?? []).filter((p) => typeof p === "string" && p.startsWith(`${profile.id}/`)).slice(0, 4);
  if (!text.trim() && !photos.length) return { error: "Paste the order or add a photo of it first." };
  if (!claudeReady()) return { error: "AI order intake needs the Claude connection (ANTHROPIC_API_KEY in Vercel)." };

  let r;
  try {
    r = await readOrder({ supabase, uid: profile.id, text, photos });
  } catch (e) {
    console.error("order intake failed", e);
    return { error: friendlyClaudeError(e) };
  }
  const { data, error } = await supabase
    .from("order_drafts")
    .insert({
      created_by: profile.id,
      created_by_name: profile.full_name || profile.email,
      source_text: text || null,
      images: photos,
      customer_text: r.customer_text || null,
      matches: r.matches,
      company_id: r.company_id,
      branch_id: r.branch_id,
      delivery_method: r.delivery_method,
      ship_address: r.ship_address,
      po_number: r.po_number,
      needed_by: r.needed_by,
      notes: r.notes,
      items: r.items,
      questions: r.questions,
      model: r.model,
      cost_cents: r.cost_cents,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Read it, but couldn't save the draft. Try again." };
  revalidatePath("/order/intake");
  return { id: data.id as string };
}

export type DraftSave = {
  id: string;
  company_id: string | null;
  branch_id: string | null;
  delivery_method: string | null;
  ship_address: string | null;
  po_number: string | null;
  needed_by: string | null;
  notes: string | null;
  items: DraftItem[];
};

/** Saves the checked draft; with open=true it's marked as taken to the Order screen. */
export async function saveDraft(d: DraftSave, open = false): Promise<{ ok?: boolean; error?: string }> {
  const { supabase } = await requirePerm("ordering");
  if (!UUID.test(d.id)) return { error: "Draft not found." };
  const items = (d.items ?? []).slice(0, 80).map((i) => ({
    raw: String(i.raw ?? "").slice(0, 300),
    product_id: i.product_id && UUID.test(i.product_id) ? i.product_id : null,
    qty: Math.max(0, Math.min(100000, Number(i.qty) || 0)),
    confidence: i.confidence === "high" || i.confidence === "medium" ? i.confidence : "low",
    note: i.note ? String(i.note).slice(0, 300) : null,
  }));
  const { error } = await supabase
    .from("order_drafts")
    .update({
      company_id: d.company_id && UUID.test(d.company_id) ? d.company_id : null,
      branch_id: d.branch_id || null,
      delivery_method: d.delivery_method === "pickup" || d.delivery_method === "jobsite" || d.delivery_method === "dropship" ? d.delivery_method : null,
      ship_address: d.ship_address?.slice(0, 500) || null,
      po_number: d.po_number?.slice(0, 100) || null,
      needed_by: d.needed_by && /^\d{4}-\d{2}-\d{2}$/.test(d.needed_by) ? d.needed_by : null,
      notes: d.notes?.slice(0, 2000) || null,
      items,
      ...(open ? { status: "opened" } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.id);
  if (error) return { error: "Couldn't save the draft." };
  revalidatePath("/order/intake");
  return { ok: true };
}

export async function discardDraft(id: string): Promise<{ ok?: boolean }> {
  const { supabase } = await requirePerm("ordering");
  await supabase.from("order_drafts").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/order/intake");
  return { ok: true };
}
