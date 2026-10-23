import { NextResponse } from "next/server";
import { getSession, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { prfFields, prfPricing, prfStatus, prfSubmission, priceRows, toItems, type RepLink } from "@/lib/jotform";
import { formSections } from "@/lib/forms";
import { formPdfName, renderPrfPdf } from "@/lib/form-doc/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A price request as a printable PDF, for its rep and for anyone who approves prices. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(`/price-requests/${id}/pdf`)}`, req.url));
  const profile = s.profile;
  if (!profile || profile.status !== "active" || !isEmployee(profile)) return new NextResponse("Not found", { status: 404 });

  const [sub, fields, pairs, staffRes, linksRes] = await Promise.all([
    prfSubmission(id),
    prfFields(),
    prfPricing().catch(() => []),
    s.supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
    s.supabase.from("rep_name_links").select("rep_name, profile_id"),
  ]);
  if (!sub) return new NextResponse("Not found", { status: 404 });
  const staff = (staffRes.data ?? []) as { id: string; full_name: string | null; email: string }[];
  const [item] = toItems([sub], fields, (linksRes.error ? [] : linksRes.data ?? []) as RepLink[], staff);
  if (!can(profile, "prf_approve") && item.ownerId !== profile.id) return new NextResponse("Not found", { status: 404 });

  const { data: review } = await s.supabase.from("prf_reviews").select("approved_by_name, approved_at, note").eq("submission_id", id).maybeSingle();
  const owner = staff.find((x) => x.id === item.ownerId);
  const skip = new Set(pairs.flatMap((p) => [p.reqQid, p.apprQid].filter(Boolean) as string[]));
  const pdf = await renderPrfPdf({
    sub: { id: sub.id, created_at: sub.created_at, updated_at: sub.updated_at },
    customer: item.customer,
    contact: item.contact,
    rep: owner?.full_name || item.rep,
    status: prfStatus(sub, pairs, Boolean(review)),
    prices: priceRows(sub, pairs),
    review: (review as { approved_by_name: string | null; approved_at: string; note: string | null } | null) ?? null,
    sections: formSections(sub, skip),
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${formPdfName("Price-Request", item.customer || item.contact || id)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
