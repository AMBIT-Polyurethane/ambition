"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { linesFromTakeoff, loadProducts, loadQuote, quoteParams, type QuoteRow } from "@/lib/ops/quotes";
import { priceLines, quoteTotals, type QLine, type QOption } from "@/lib/ops/quote-calc";
import { currentOrigin } from "@/lib/origin";
import { sendEmail, wrapEmail } from "@/lib/email";
import { escapeHtml as h, firstName } from "@/lib/format";

// AMBIT-OPS quotes. Every save is priced again here with the contractor's own products and settings
// (the screen's numbers are only a preview), then stored in one go (ops_quote_save).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);

const DEFAULT_TERMS =
  "Price includes materials, labor and cleanup for the work listed. Areas must be clear and accessible on the scheduled day. Any change to the work is quoted separately before it's done. Payment: deposit (if shown) to schedule, balance on completion.";

/** A new quote for a lead or a customer (optionally from a takeoff), then the quote screen. */
export async function createQuote(f: FormData) {
  const { supabase, profile, ws } = await requireOps(opsCan.quote);
  const leadId = s(f, "lead_id");
  const takeoffId = s(f, "takeoff_id");
  let customerId = s(f, "customer_id");
  let propertyId = s(f, "property_id") || null;
  let title = s(f, "title").slice(0, 140) || null;
  let rep: string | null = null;
  if (UUID.test(leadId)) {
    const { data: lead } = await supabase.from("ops_leads").select("id, customer_id, property_id, title, services, rep_id").eq("id", leadId).maybeSingle();
    if (!lead) go("/ops/quotes/new", "err", "That lead isn't there anymore.");
    customerId = lead!.customer_id;
    propertyId = propertyId || lead!.property_id;
    title = title || lead!.title || ((lead!.services as string[]) ?? []).join(", ") || null;
    rep = lead!.rep_id;
  }
  if (!UUID.test(customerId)) go("/ops/quotes/new", "err", "Pick the customer.");
  const { data: cust } = await supabase.from("ops_customers").select("id, price_level, tax_exempt").eq("id", customerId).maybeSingle();
  if (!cust) go("/ops/quotes/new", "err", "That customer isn't there anymore.");
  const st = ws.settings;
  const { data: q, error } = await supabase
    .from("ops_quotes")
    .insert({
      company_id: ws.company.id,
      lead_id: UUID.test(leadId) ? leadId : null,
      customer_id: customerId,
      property_id: propertyId && UUID.test(propertyId) ? propertyId : null,
      takeoff_id: UUID.test(takeoffId) ? takeoffId : null,
      title,
      price_level: cust!.price_level === "builder" ? "builder" : "retail",
      target_margin: st.target_margin,
      floor_margin: st.floor_margin,
      burden_pct: st.burden_pct,
      tax_rate: st.tax_rate,
      tax_labor: st.tax_labor,
      tax_exempt: !!cust!.tax_exempt,
      deposit_pct: st.deposit_pct,
      terms: DEFAULT_TERMS,
      rep_id: rep ?? (ws.role === "sales" ? profile.id : null),
      created_by: profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !q) go("/ops/quotes/new", "err", error?.message ?? "Couldn't start the quote.");

  // One option to start, filled from the takeoff if there is one.
  const optId = crypto.randomUUID();
  let lines: QLine[] = [];
  let note = "";
  if (UUID.test(takeoffId)) {
    const products = await loadProducts(supabase, ws.company.id);
    const r = await linesFromTakeoff(supabase, takeoffId, products, st);
    lines = r.lines.map((l, i) => ({ ...l, option_id: optId, sort: i }));
    if (r.skipped.length) note = ` ${r.skipped.length} item${r.skipped.length === 1 ? " has" : "s have"} no size yet (${r.skipped.slice(0, 3).join(", ")}).`;
    await supabase.from("takeoffs").update({ lead_id: UUID.test(leadId) ? leadId : null, ops_customer_id: customerId }).eq("id", takeoffId);
  }
  const res = await persist(q!.id, { options: [{ id: optId, name: "Option 1", note: null, sort: 0 }], lines });
  if (!res.ok) go(`/ops/quotes/${q!.id}`, "err", res.error ?? "Couldn't save.");
  revalidatePath("/ops/quotes");
  go(`/ops/quotes/${q!.id}`, "msg", lines.length ? `Quote started from the takeoff: ${lines.length} line${lines.length === 1 ? "" : "s"}. Check each one.${note}` : "Quote started. Add the work below.");
}

export type QuoteFields = {
  title: string | null;
  property_id: string | null;
  price_level: "retail" | "builder";
  target_margin: number | null;
  floor_margin: number | null;
  burden_pct: number | null;
  tax_rate: number | null;
  tax_labor: boolean;
  tax_exempt: boolean;
  deposit_pct: number | null;
  intro: string | null;
  terms: string | null;
  rep_id: string | null;
};

export type SaveResult = { ok: boolean; error?: string; lines?: QLine[]; totals?: ReturnType<typeof quoteTotals>; needsApproval?: boolean; at?: string };

/** Prices everything again with the contractor's numbers and saves the quote, its options and lines. */
async function persist(id: string, body: { fields?: Partial<QuoteFields>; options: QOption[]; lines: QLine[] }): Promise<SaveResult> {
  const { supabase, ws } = await requireOps(opsCan.quote);
  const loaded = await loadQuote(supabase, id);
  if (!loaded) return { ok: false, error: "Quote not found." };
  const cur = loaded.quote;
  if (cur.status === "signed") return { ok: false, error: "This quote is signed. Make a copy to change it." };
  const f: QuoteFields = {
    title: body.fields?.title ?? cur.title,
    property_id: body.fields && "property_id" in body.fields ? body.fields.property_id ?? null : cur.property_id,
    price_level: (body.fields?.price_level ?? cur.price_level) === "builder" ? "builder" : "retail",
    target_margin: body.fields && "target_margin" in body.fields ? clampPct(body.fields.target_margin) : cur.target_margin,
    floor_margin: body.fields && "floor_margin" in body.fields ? clampPct(body.fields.floor_margin) : cur.floor_margin,
    burden_pct: body.fields && "burden_pct" in body.fields ? clampPct(body.fields.burden_pct, 200) : cur.burden_pct,
    tax_rate: body.fields && "tax_rate" in body.fields ? clampPct(body.fields.tax_rate, 30) : cur.tax_rate,
    tax_labor: body.fields?.tax_labor ?? cur.tax_labor,
    tax_exempt: body.fields?.tax_exempt ?? cur.tax_exempt,
    deposit_pct: body.fields && "deposit_pct" in body.fields ? clampPct(body.fields.deposit_pct, 100) : cur.deposit_pct,
    intro: body.fields && "intro" in body.fields ? (body.fields.intro ?? "").slice(0, 4000) || null : cur.intro,
    terms: body.fields && "terms" in body.fields ? (body.fields.terms ?? "").slice(0, 8000) || null : cur.terms,
    rep_id: body.fields && "rep_id" in body.fields ? (body.fields.rep_id && UUID.test(body.fields.rep_id) ? body.fields.rep_id : null) : cur.rep_id,
  };
  const options = (body.options ?? []).filter((o) => UUID.test(o.id)).slice(0, 6).map((o, i) => ({ id: o.id, name: String(o.name ?? "").slice(0, 60) || `Option ${i + 1}`, note: o.note ? String(o.note).slice(0, 500) : null, sort: i }));
  if (!options.length) return { ok: false, error: "A quote needs at least one option." };
  const optIds = new Set(options.map((o) => o.id));
  const raw = (body.lines ?? []).filter((l) => UUID.test(l.id) && (l.option_id === null || optIds.has(l.option_id))).slice(0, 400);
  const products = await loadProducts(supabase, ws.company.id);
  const byId = new Map(products.map((p) => [p.id, p]));
  const params = quoteParams({ ...cur, ...f }, ws.settings);
  const lines = priceLines(
    raw.map((l, i) => ({ ...l, sort: i, product_id: l.product_id && byId.has(l.product_id) ? l.product_id : null })),
    byId,
    ws.settings,
    params,
  );
  const totals = quoteTotals(options, lines, params);
  const needsApproval = totals.below_floor.length > 0;
  const { error } = await supabase.rpc("ops_quote_save", {
    p_quote: id,
    p_fields: { ...f, needs_approval: needsApproval, totals },
    p_options: options,
    p_lines: lines,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, lines, totals, needsApproval, at: new Date().toISOString() };
}

const clampPct = (v: number | null | undefined, max = 99) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(max, Number(v))));

export async function saveQuote(id: string, body: { fields: Partial<QuoteFields>; options: QOption[]; lines: QLine[] }): Promise<SaveResult> {
  if (!UUID.test(id)) return { ok: false, error: "Quote not found." };
  const r = await persist(id, body);
  if (r.ok) revalidatePath("/ops/quotes");
  return r;
}

/** Lines from a takeoff, for the quote screen to add to an option. */
export async function takeoffLines(takeoffId: string): Promise<{ ok: boolean; error?: string; lines?: QLine[]; skipped?: string[] }> {
  const { supabase, ws } = await requireOps(opsCan.quote);
  if (!UUID.test(takeoffId)) return { ok: false, error: "Pick a takeoff." };
  const products = await loadProducts(supabase, ws.company.id);
  const r = await linesFromTakeoff(supabase, takeoffId, products, ws.settings);
  return { ok: true, lines: r.lines, skipped: r.skipped };
}

export async function approveQuote(f: FormData) {
  const { supabase } = await requireOps(opsCan.approve);
  const id = s(f, "id");
  const { error } = await supabase.rpc("ops_quote_approve", { p_quote: id });
  if (error) go(`/ops/quotes/${id}`, "err", error.message);
  revalidatePath(`/ops/quotes/${id}`);
  go(`/ops/quotes/${id}`, "msg", "Approved. It can be sent now.");
}

/** Sends the proposal: by email if there's an address (and email works), always with a link to copy or text. */
export async function sendQuote(id: string, opts: { email: boolean; to?: string | null; message?: string | null }): Promise<{ ok: boolean; error?: string; link?: string; emailed?: string | null; emailNote?: string | null }> {
  const { supabase, profile, ws } = await requireOps(opsCan.quote);
  if (!UUID.test(id)) return { ok: false, error: "Quote not found." };
  const loaded = await loadQuote(supabase, id);
  if (!loaded) return { ok: false, error: "Quote not found." };
  const q = loaded.quote;
  if (!loaded.lines.some((l) => l.option_id)) return { ok: false, error: "Add the work first: the quote has no lines." };
  const { data: tok, error } = await supabase.rpc("ops_quote_mark_sent", { p_quote: id, p_days: ws.settings.quote_days });
  if (error) return { ok: false, error: error.message };
  const link = `${await currentOrigin()}/p/${tok}`;
  revalidatePath(`/ops/quotes/${id}`);
  revalidatePath("/ops/quotes");
  if (q.lead_id) revalidatePath(`/ops/leads/${q.lead_id}`);
  if (!opts.email) return { ok: true, link };
  const { data: cust } = await supabase.from("ops_customers").select("name, email").eq("id", q.customer_id).maybeSingle();
  const to = (opts.to || cust?.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: true, link, emailed: null, emailNote: "No email address for this customer. Copy the link and text or email it yourself." };
  const brand = ws.brand;
  const replyTo = ws.settings.email || profile.email;
  const hi = firstName(cust?.name ?? null, to);
  const msg = (opts.message ?? "").trim().slice(0, 1500);
  const html = wrapEmail(
    brand,
    `<div style="font-size:20px;font-weight:800;margin-bottom:10px;">Hi ${h(hi)},</div>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px;">${h(msg || `Here's your proposal from ${brand}${q.title ? ` for ${q.title}` : ""}. You can look it over, pick an option and sign it online.`)}</p>
<p style="margin:0 0 16px;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">VIEW MY PROPOSAL</a></p>
<p style="font-size:13px;line-height:1.5;color:#52525b;margin:0;">Questions? Just reply to this email${ws.settings.phone ? ` or call ${h(ws.settings.phone)}` : ""}.</p>
<p style="font-size:11px;color:#a1a1aa;margin:16px 0 0;word-break:break-all;">Button not working? Copy this into your browser: ${h(link)}</p>`,
  );
  const res = await sendEmail({ to: [to], replyTo, fromName: brand, subject: `Your proposal from ${brand}${q.number ? ` (#${q.number})` : ""}`, html, text: `Hi ${hi}, ${msg || `here's your proposal from ${brand}.`}\n${link}` });
  if (res.status === "sent") {
    await supabase.from("ops_notes").insert({ company_id: ws.company.id, lead_id: q.lead_id, customer_id: q.customer_id, kind: "email", body: `Emailed quote #${q.number} to ${to}`, created_by: profile.id, created_by_name: profile.full_name || profile.email });
    return { ok: true, link, emailed: to };
  }
  return { ok: true, link, emailed: null, emailNote: res.status === "not_configured" ? "Email isn't set up in the app yet. Copy the link and text or email it yourself." : `The email didn't go out (${(res.error ?? "").slice(0, 160)}). Copy the link and send it yourself.` };
}

/** A copy to change (a signed or declined quote stays as it was). */
export async function copyQuote(f: FormData) {
  const { supabase, profile, ws } = await requireOps(opsCan.quote);
  const id = s(f, "id");
  const loaded = await loadQuote(supabase, id);
  if (!loaded) go("/ops/quotes", "err", "Quote not found.");
  const q = loaded!.quote;
  const { data: nq, error } = await supabase
    .from("ops_quotes")
    .insert({
      company_id: ws.company.id,
      lead_id: q.lead_id,
      customer_id: q.customer_id,
      property_id: q.property_id,
      takeoff_id: q.takeoff_id,
      title: q.title,
      price_level: q.price_level,
      target_margin: q.target_margin,
      floor_margin: q.floor_margin,
      burden_pct: q.burden_pct,
      tax_rate: q.tax_rate,
      tax_labor: q.tax_labor,
      tax_exempt: q.tax_exempt,
      deposit_pct: q.deposit_pct,
      intro: q.intro,
      terms: q.terms,
      rep_id: q.rep_id,
      created_by: profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !nq) go(`/ops/quotes/${id}`, "err", error?.message ?? "Couldn't copy it.");
  const map = new Map(loaded!.options.map((o) => [o.id, crypto.randomUUID()]));
  const options = loaded!.options.map((o) => ({ ...o, id: map.get(o.id)! }));
  const lines = loaded!.lines.map((l) => ({ ...l, id: crypto.randomUUID(), option_id: l.option_id ? map.get(l.option_id) ?? null : null }));
  const r = await persist(nq!.id, { options, lines });
  if (!r.ok) go(`/ops/quotes/${nq!.id}`, "err", r.error ?? "Couldn't copy the lines.");
  revalidatePath("/ops/quotes");
  go(`/ops/quotes/${nq!.id}`, "msg", `Copy of quote #${q.number}. Change what you need, then send it.`);
}

export async function deleteQuote(f: FormData) {
  const { supabase } = await requireOps(opsCan.manage);
  const id = s(f, "id");
  const { error } = await supabase.from("ops_quotes").delete().eq("id", id);
  if (error) go(`/ops/quotes/${id}`, "err", error.message);
  revalidatePath("/ops/quotes");
  go("/ops/quotes", "msg", "Quote deleted.");
}

// ------------------------------------------------------------------ saved packages
export async function savePackage(name: string, lines: QLine[]): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { supabase, profile, ws } = await requireOps(opsCan.quote);
  const nm = name.trim().slice(0, 80);
  if (!nm) return { ok: false, error: "Name the package." };
  const keep = lines.slice(0, 60).map((l) => ({
    kind: l.kind,
    product_id: l.product_id,
    name: l.name,
    area_code: l.area_code,
    measure: l.measure,
    depth_in: l.depth_in,
    r_value: l.r_value,
    framing: l.framing,
    waste_pct: l.waste_pct,
    hours: l.hours,
    qty: l.measure === "each" ? l.qty : null,
    price: l.price_locked ? l.price : null,
    price_locked: l.price_locked,
  }));
  if (!keep.length) return { ok: false, error: "Add lines first." };
  const { data, error } = await supabase.from("ops_packages").insert({ company_id: ws.company.id, name: nm, lines: keep, created_by: profile.id }).select("id").single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data!.id };
}

export async function deletePackage(id: string): Promise<{ ok: boolean }> {
  const { supabase } = await requireOps(opsCan.quote);
  await supabase.from("ops_packages").delete().eq("id", id);
  return { ok: true };
}

export type { QuoteRow };
