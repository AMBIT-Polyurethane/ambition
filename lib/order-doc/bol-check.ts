import "server-only";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claudeReady, costCents, fillForm } from "@/lib/ai/claude";
import { shrinkImage } from "@/lib/image-shrink";
import { loadAiSettings } from "@/lib/assistant/settings";
import { qtyText } from "@/lib/format";
import { bolProblems, fileVerdicts, type BolOrder, type BolProblem, type BolSeen, type FileVerdict } from "@/lib/bol-audit";

// 0082: the app reads an order's signed BOL photos with AI and saves what's on them (order number, customer,
// signature, lot numbers). bolProblems() compares that with the order.

const FORM = {
  name: "record_signed_bol",
  description: "Record exactly what is on each file attached as the order's signed BOL.",
  schema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "integer", description: "The file number" },
            kind: {
              type: "string",
              enum: ["ambit_packing_slip", "bill_of_lading", "other_document", "not_a_document", "unreadable"],
              description:
                "ambit_packing_slip = AMBIT's own packing slip / order form; bill_of_lading = a trucking or shipping BOL / delivery receipt; other_document = some other paper; not_a_document = a photo of something that isn't paperwork (drums, a truck, a screen); unreadable = too blurry, dark or cut off to read",
            },
            shows: { type: "string", description: "One short sentence: what the file shows" },
            order_numbers: { type: "array", items: { type: "string" }, description: "Every AMBIT order number on it (like ORD-1122), printed or written. Empty if none." },
            customer: { type: "string", description: "The customer / consignee / sold-to company on it, or empty" },
            signed: { type: "boolean", description: "A customer or driver signature is on it (a real signature, not just a blank signature line)" },
            lots: {
              type: "array",
              description: "Every lot / batch number on it",
              items: {
                type: "object",
                properties: {
                  lot_no: { type: "string", description: "The lot number exactly as written" },
                  product: { type: "string", description: "What it's for, as written (brand / product / SKU), or empty" },
                  qty: { type: "number", description: "How many drums / totes for that lot if shown, else 0" },
                  written: { type: "string", enum: ["printed", "handwritten"] },
                  clear: { type: "boolean", description: "true only if you can read every character for sure" },
                },
                required: ["lot_no", "product", "qty", "written", "clear"],
              },
            },
          },
          required: ["file", "kind", "shows", "order_numbers", "customer", "signed", "lots"],
        },
      },
      matches_order: { type: "string", enum: ["yes", "no", "unclear"], description: "Is this paperwork for the order described?" },
      why: { type: "string", description: "One short sentence on why" },
    },
    required: ["files", "matches_order", "why"],
  } as Record<string, unknown>,
};

const SYSTEM = `You check the signed paperwork AMBIT Polyurethane's warehouse staff attach to an order when it is picked up or shipped out (spray foam chemicals in drums and totes, insulation, supplies). Staff sometimes attach the wrong photo (another order's slip, a photo of drums, a blank or cut-off page), forget the signature, or write lot numbers that don't match. Read each file carefully and record exactly what is on it. Never guess: if something is hard to read, say so (clear: false).

AMBIT's own packing slip: "AMBIT ORDER" and a big order number like ORD-1122 at the top right, the customer, a table of SKUs and quantities, and under each spray foam line the lot the app printed (for example "2 drums Wanhua · Lot 2605P0428 · exp 5/7/27": lot 2605P0428, printed). At the bottom right is a "FOR AMBIT USE" box with handwritten fields: Picked by, Checked by, Lot numbers, Picked up by (print), Customer signature, QuickBooks invoice #. Lot numbers written in by hand anywhere are "handwritten". A trucking company's bill of lading may be attached instead of, or as well as, the slip.
Lot numbers look like LW8043, L7970, 2605P0428, PA86002866, GEO23461, AP9166AB. Don't list order numbers, PO numbers, invoice numbers, sales order numbers, phone numbers or dates as lots.`;

type Order = {
  order_no: number;
  company_name: string | null;
  ship_address: string | null;
  delivery_method: string;
  po_number: string | null;
  ambit_po: string | null;
  invoice_no: string | null;
};

export const bolCheckReady = claudeReady;

/** Read an order's signed BOL files with AI and save what's on them. Needs an AMBIT staff session. */
export async function checkOrderBol(supabase: SupabaseClient, orderId: string): Promise<{ ok: boolean; error?: string; cost: number }> {
  const [{ data: o }, { data: itRows }, { data: fRows }, { data: sigRows }] = await Promise.all([
    supabase.from("orders").select("order_no, company_name, ship_address, delivery_method, po_number, ambit_po, invoice_no").eq("id", orderId).maybeSingle<Order>(),
    supabase.from("order_items").select("sku, name, qty, unit").eq("order_id", orderId).order("id"),
    supabase.from("order_files").select("id, path, name").eq("order_id", orderId).eq("kind", "bol").order("id"),
    supabase.from("packing_slip_signatures").select("file_path").eq("order_id", orderId),
  ]);
  if (!o) return { ok: false, error: "Order not found.", cost: 0 };
  const files = (fRows ?? []) as { id: number; path: string; name: string | null }[];
  if (!files.length) return { ok: true, cost: 0 };
  const ids = files.map((f) => f.id);
  const onScreen = new Set(((sigRows ?? []) as { file_path: string | null }[]).map((s) => s.file_path).filter(Boolean));
  const save = (p: { hashes: string[]; seen: BolSeen | null; status: string; error: string | null; model: string | null; cost: number }) =>
    supabase.rpc("order_bol_check_save", { p_order: orderId, p_file_ids: ids, p_hashes: p.hashes, p_seen: p.seen, p_status: p.status, p_error: p.error, p_model: p.model, p_cost: p.cost });

  // Signed on screen in the app: made by the app from the order itself, nothing to read.
  if (files.every((f) => onScreen.has(f.path))) {
    const { error } = await save({ hashes: [], seen: null, status: "app_signed", error: null, model: null, cost: 0 });
    return error ? { ok: false, error: error.message, cost: 0 } : { ok: true, cost: 0 };
  }

  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  const hashes: string[] = [];
  let readable = 0;
  for (const [i, f] of files.slice(0, 6).entries()) {
    if (onScreen.has(f.path)) {
      hashes.push("");
      blocks.push({ type: "text", text: `File ${i + 1}: the packing slip signed on screen in the app (not shown; skip it).` });
      continue;
    }
    const { data } = await supabase.storage.from("order-files").download(f.path);
    if (!data) {
      hashes.push("");
      blocks.push({ type: "text", text: `File ${i + 1}: couldn't be opened.` });
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    hashes.push(createHash("sha256").update(buf).digest("hex"));
    if (/\.pdf$/i.test(f.path)) {
      if (buf.byteLength > 20 * 1024 * 1024) {
        blocks.push({ type: "text", text: `File ${i + 1}: a PDF too big to read.` });
        continue;
      }
      blocks.push({ type: "text", text: `File ${i + 1}:` });
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } });
      readable += 1;
    } else {
      const small = await shrinkImage(buf, 2000, 85);
      if (!small) {
        blocks.push({ type: "text", text: `File ${i + 1}: a photo in a format the app can't open.` });
        continue;
      }
      blocks.push({ type: "text", text: `File ${i + 1}:` });
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.body.toString("base64") } });
      readable += 1;
    }
  }
  if (!readable) {
    const { error } = await save({ hashes, seen: null, status: "error", error: "The app couldn't open the BOL files to read them.", model: null, cost: 0 });
    return { ok: false, error: error?.message ?? "The app couldn't open the BOL files.", cost: 0 };
  }

  const settings = await loadAiSettings(supabase);
  const model = settings?.model === "claude-opus-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";
  const items = ((itRows ?? []) as { sku: string; name: string; qty: number; unit: string }[]).map((it) => `- ${qtyText(Number(it.qty), it.unit)} ${it.name} (${it.sku})`).join("\n");
  const where = o.delivery_method === "pickup" ? "picked up at AMBIT's warehouse" : `delivered to ${o.ship_address ?? "the customer"}`;
  const ask = `These are the files attached as the signed BOL for AMBIT order ORD-${o.order_no}.
The order: customer ${o.company_name ?? "(unknown)"}; ${where}${o.po_number ? `; customer PO ${o.po_number}` : ""}${o.ambit_po ? `; Sales Order # ${o.ambit_po}` : ""}${o.invoice_no ? `; invoice # ${o.invoice_no}` : ""}.
Items:
${items || "(none listed)"}
Record each file (one entry per file number shown), then say whether this paperwork is for this order.`;
  try {
    const { data, usage } = await fillForm<BolSeen>({ model, maxTokens: 4000, system: SYSTEM, content: [...blocks, { type: "text", text: ask }], ...FORM });
    const seen: BolSeen = {
      files: (data.files ?? []).slice(0, 12).map((p) => ({
        file: Number(p.file) || 0,
        kind: p.kind,
        shows: String(p.shows ?? "").slice(0, 300),
        order_numbers: (p.order_numbers ?? []).map((x) => String(x).slice(0, 20)).slice(0, 10),
        customer: String(p.customer ?? "").slice(0, 120),
        signed: Boolean(p.signed),
        lots: (p.lots ?? []).slice(0, 30).map((l) => ({
          lot_no: String(l.lot_no ?? "").trim().slice(0, 40),
          product: String(l.product ?? "").slice(0, 80),
          qty: Math.max(0, Math.min(10000, Number(l.qty) || 0)),
          written: l.written === "handwritten" ? "handwritten" : "printed",
          clear: Boolean(l.clear),
        })),
      })),
      matches_order: data.matches_order === "no" || data.matches_order === "yes" ? data.matches_order : "unclear",
      why: String(data.why ?? "").slice(0, 300),
    };
    const cost = costCents(model, usage);
    const { error } = await save({ hashes, seen, status: "read", error: null, model, cost });
    return error ? { ok: false, error: error.message, cost } : { ok: true, cost };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await save({ hashes, seen: null, status: "error", error: msg, model, cost: 0 });
    return { ok: false, error: msg, cost: 0 };
  }
}

export type BolFinding = {
  order_id: string;
  order_no: number;
  company: string | null;
  branch: string | null;
  status: string;
  error: string | null;
  checked_at: string;
  problems: BolProblem[];
  ok_by_name: string | null;
  ok_note: string | null;
  uploaders: string[];
};

/** Every order's BOL check, with its problems worked out against the order right now. */
export async function loadBolFindings(supabase: SupabaseClient): Promise<{ list: BolFinding[]; ready: boolean }> {
  const { data, error } = await supabase.from("order_bol_checks").select("order_id, file_hashes, seen, status, error, checked_at, ok_at, ok_by_name, ok_note");
  if (error) return { list: [], ready: false };
  type C = { order_id: string; file_hashes: string[]; seen: BolSeen | null; status: string; error: string | null; checked_at: string; ok_at: string | null; ok_by_name: string | null; ok_note: string | null };
  const checks = (data ?? []) as C[];
  if (!checks.length) return { list: [], ready: true };
  const ids = checks.map((c) => c.order_id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const got = await Promise.all(
    chunks.map((ch) =>
      Promise.all([
        supabase.from("orders").select("id, order_no, company_name, branch_id, status, ambit_po, invoice_no, po_number").in("id", ch),
        supabase.from("inventory_lines").select("order_id, lot_no").in("order_id", ch).eq("state", "done"),
        supabase.from("order_files").select("order_id, uploaded_by_name").in("order_id", ch).eq("kind", "bol"),
      ]),
    ),
  );
  const orders = got.flatMap(([a]) => (a.data ?? []) as { id: string; order_no: number; company_name: string | null; branch_id: string | null; status: string; ambit_po: string | null; invoice_no: string | null; po_number: string | null }[]);
  const whoIs = await orderIndex(supabase);
  const lines = got.flatMap(([, b]) => (b.data ?? []) as { order_id: string; lot_no: string | null }[]);
  const files = got.flatMap(([, , c]) => (c.data ?? []) as { order_id: string; uploaded_by_name: string | null }[]);
  const byId = new Map(orders.map((o) => [o.id, o]));
  // The same photo on two orders.
  const hashOrders = new Map<string, Set<string>>();
  for (const c of checks) for (const h of c.file_hashes ?? []) if (h) hashOrders.set(h, new Set([...(hashOrders.get(h) ?? []), c.order_id]));
  const list: BolFinding[] = [];
  for (const c of checks) {
    const o = byId.get(c.order_id);
    if (!o || o.status !== "completed") continue;
    const same = new Set<number>();
    for (const h of c.file_hashes ?? []) for (const other of hashOrders.get(h) ?? []) if (other !== c.order_id && byId.get(other)) same.add(byId.get(other)!.order_no);
    const problems = c.status === "read" || same.size ? bolProblems(o, c.seen, lines.filter((l) => l.order_id === c.order_id).map((l) => l.lot_no), [...same].sort(), whoIs) : [];
    list.push({
      order_id: c.order_id,
      order_no: o.order_no,
      company: o.company_name,
      branch: o.branch_id,
      status: c.status,
      error: c.error,
      checked_at: c.checked_at,
      problems: c.ok_at ? [] : problems,
      ok_by_name: c.ok_at ? c.ok_by_name : null,
      ok_note: c.ok_at ? c.ok_note : null,
      uploaders: [...new Set(files.filter((f) => f.order_id === c.order_id).map((f) => (f.uploaded_by_name ?? "").trim()).filter(Boolean))],
    });
  }
  return { list: list.sort((a, b) => b.order_no - a.order_no), ready: true };
}

/** The completed orders whose signed BOL hasn't been read yet (or changed since), newest first. */
export async function bolsToCheck(supabase: SupabaseClient): Promise<{ id: string; order_no: number }[]> {
  const [{ data: fRows }, { data: cRows }] = await Promise.all([
    supabase.from("order_files").select("id, order_id, orders!inner(order_no, status)").eq("kind", "bol").eq("orders.status", "completed"),
    supabase.from("order_bol_checks").select("order_id, file_ids, status"),
  ]);
  type F = { id: number; order_id: string; orders: { order_no: number } | { order_no: number }[] };
  const now = new Map<string, { ids: number[]; no: number }>();
  for (const f of (fRows ?? []) as F[]) {
    const no = Array.isArray(f.orders) ? f.orders[0]?.order_no : f.orders?.order_no;
    const cur = now.get(f.order_id) ?? { ids: [], no: no ?? 0 };
    cur.ids.push(Number(f.id));
    now.set(f.order_id, cur);
  }
  const done = new Map(((cRows ?? []) as { order_id: string; file_ids: number[]; status: string }[]).map((c) => [c.order_id, c]));
  const same = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].map(Number).sort((x, y) => x - y)[i]);
  return [...now.entries()]
    .filter(([id, v]) => {
      const c = done.get(id);
      return !c || !same(v.ids, c.file_ids ?? []);
    })
    .map(([id, v]) => ({ id, order_no: v.no }))
    .sort((a, b) => b.order_no - a.order_no);
}

/** One order's BOL check (the order page), or null when it hasn't been read. */
export async function orderBolFinding(supabase: SupabaseClient, orderId: string, orderNo: number): Promise<{ problems: BolProblem[]; status: string; ok_by_name: string | null } | null> {
  const { data: c, error } = await supabase
    .from("order_bol_checks")
    .select("file_hashes, seen, status, ok_at, ok_by_name")
    .eq("order_id", orderId)
    .maybeSingle<{ file_hashes: string[]; seen: BolSeen | null; status: string; ok_at: string | null; ok_by_name: string | null }>();
  if (error || !c) return null;
  if (c.ok_at) return { problems: [], status: c.status, ok_by_name: c.ok_by_name };
  const hashes = (c.file_hashes ?? []).filter(Boolean);
  const [{ data: ln }, { data: others }] = await Promise.all([
    supabase.from("inventory_lines").select("lot_no").eq("order_id", orderId).eq("state", "done"),
    hashes.length
      ? supabase.from("order_bol_checks").select("order_id, orders!inner(order_no, status)").overlaps("file_hashes", hashes).neq("order_id", orderId).eq("orders.status", "completed")
      : Promise.resolve({ data: [] }),
  ]);
  type O = { orders: { order_no: number } | { order_no: number }[] };
  const same = ((others ?? []) as O[]).map((r) => (Array.isArray(r.orders) ? r.orders[0]?.order_no : r.orders?.order_no)).filter((n): n is number => !!n);
  const { data: me } = await supabase.from("orders").select("order_no, ambit_po, invoice_no, po_number").eq("id", orderId).maybeSingle<BolOrder>();
  const problems = c.status === "read" || same.length ? bolProblems(me ?? { order_no: orderNo }, c.seen, ((ln ?? []) as { lot_no: string | null }[]).map((l) => l.lot_no), same.sort(), await orderIndex(supabase)) : [];
  return { problems, status: c.status, ok_by_name: null };
}

/** A read that took too long: saved as "couldn't read it" so the next round moves on (Read it again retries it). */
export async function markBolError(supabase: SupabaseClient, orderId: string, msg: string) {
  const { data } = await supabase.from("order_files").select("id").eq("order_id", orderId).eq("kind", "bol").order("id");
  const ids = ((data ?? []) as { id: number }[]).map((f) => f.id);
  if (!ids.length) return;
  await supabase.rpc("order_bol_check_save", { p_order: orderId, p_file_ids: ids, p_hashes: [], p_seen: null, p_status: "error", p_error: msg, p_model: null, p_cost: 0 });
}

/** Which order a number on a BOL belongs to: its ORD number, AMBIT Sales Order # or invoice #. */
export async function orderIndex(supabase: SupabaseClient): Promise<(num: string) => number | null> {
  const { data } = await supabase.from("orders").select("order_no, ambit_po, invoice_no").order("order_no", { ascending: false }).range(0, 4999);
  const map = new Map<string, number>();
  const num = (x: string | null | undefined) => (/(\d{3,8})/.exec(x ?? "") ?? [])[1] ?? "";
  for (const o of (data ?? []) as { order_no: number; ambit_po: string | null; invoice_no: string | null }[]) {
    for (const k of [num(o.ambit_po), num(o.invoice_no)]) if (k && !map.has(k)) map.set(k, o.order_no);
  }
  for (const o of (data ?? []) as { order_no: number }[]) map.set(String(o.order_no), o.order_no);
  return (n: string) => map.get(n) ?? null;
}

/** What the AI made of each signed BOL / packing slip page on an order, by file id (the Files panel). */
export async function orderFileVerdicts(supabase: SupabaseClient, orderId: string): Promise<Map<number, FileVerdict>> {
  const out = new Map<number, FileVerdict>();
  const [{ data: c, error }, { data: me }, { data: sig }, { data: fl }] = await Promise.all([
    supabase.from("order_bol_checks").select("file_ids, seen, status").eq("order_id", orderId).maybeSingle<{ file_ids: number[]; seen: BolSeen | null; status: string }>(),
    supabase.from("orders").select("order_no, ambit_po, invoice_no, po_number").eq("id", orderId).maybeSingle<BolOrder>(),
    supabase.from("packing_slip_signatures").select("file_path").eq("order_id", orderId),
    supabase.from("order_files").select("id, path").eq("order_id", orderId).eq("kind", "bol"),
  ]);
  const onScreen = new Set(((sig ?? []) as { file_path: string | null }[]).map((r) => r.file_path).filter(Boolean));
  for (const f of (fl ?? []) as { id: number; path: string }[]) if (onScreen.has(f.path)) out.set(Number(f.id), { tone: "ok", text: "Signed in the app", belongsTo: null });
  if (error || !c || !me) return out;
  const ids = (c.file_ids ?? []).map(Number);
  if (c.status === "error") return out;
  const v = fileVerdicts(me, c.seen, await orderIndex(supabase));
  for (const [n, verdict] of v) {
    const id = ids[n - 1];
    if (id && !out.has(id)) out.set(id, verdict);
  }
  return out;
}

/** Read the order's signed paperwork now, but give up after a while (the page can't wait forever). */
export async function checkOrderBolNow(supabase: SupabaseClient, orderId: string, ms = 35_000): Promise<{ ok: boolean; late?: boolean; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ ok: false; late: true }>((r) => {
    timer = setTimeout(() => r({ ok: false, late: true }), ms);
  });
  try {
    return await Promise.race([checkOrderBol(supabase, orderId), late]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}
