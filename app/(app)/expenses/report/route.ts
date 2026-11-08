import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { expensePdf, isMonth } from "@/lib/expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The monthly expense report PDF: your own, or anyone's for expense approvers (?u=<their id>). */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("id, email, full_name, role, status, expense_approver").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "active" || me.role === "customer") return new NextResponse("Not allowed", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const month = sp.get("m") ?? "";
  if (!isMonth(month)) return new NextResponse("Pick a month", { status: 400 });
  const asked = sp.get("u") ?? "";
  const uid = asked && asked !== me.id ? (me.expense_approver && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null) : me.id;
  if (!uid) return new NextResponse("Only expense approvers can open other people's reports", { status: 403 });
  const { data: who } = uid === me.id ? { data: me } : await supabase.from("profiles").select("id, full_name, email").eq("id", uid).maybeSingle();
  if (!who) return new NextResponse("Not found", { status: 404 });

  const name = (who.full_name as string | null) || (who.email as string);
  const { pdf, filename } = await expensePdf(supabase, { id: uid, name, email: who.email as string }, month);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
