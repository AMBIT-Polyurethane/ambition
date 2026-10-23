import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { formSections, formSubmission, hubForm, reviewable, summarize } from "@/lib/forms";
import { formPdfName, renderFormPdf } from "@/lib/form-doc/pdf";
import { reviewsFor } from "../../../reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins: one Jotform submission as a printable PDF. */
export async function GET(req: Request, { params }: { params: Promise<{ formId: string; subId: string }> }) {
  const { formId, subId } = await params;
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(`/admin/forms/${formId}/${subId}/pdf`)}`, req.url));
  if (s.profile?.role !== "admin" || s.profile.status !== "active") return new NextResponse("Admins only", { status: 403 });

  const [form, sub] = await Promise.all([hubForm(formId), formSubmission(formId, subId)]);
  if (!form || !sub) return new NextResponse("Not found", { status: 404 });
  const canReview = reviewable(form.kind);
  const review = canReview ? (await reviewsFor(s.supabase, formId)).get(subId) ?? null : null;
  const { title, sub: subtitle } = summarize(sub);
  const pdf = await renderFormPdf({
    formTitle: form.title,
    kind: form.kind,
    reviewable: canReview,
    sub: { id: sub.id, created_at: sub.created_at, updated_at: sub.updated_at },
    title,
    subtitle,
    sections: formSections(sub),
    review,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${formPdfName(form.title, title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
