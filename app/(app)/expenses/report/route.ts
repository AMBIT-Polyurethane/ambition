import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMonth, receiptsFor } from "@/lib/expenses";
import { expensePdfName, renderExpensePdf } from "@/lib/expense-doc/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The monthly expense report PDF: your own, or anyone's for admins (?email=). */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("id, email, full_name, role, status").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "active" || me.role === "customer") return new NextResponse("Not allowed", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const month = sp.get("m") ?? "";
  if (!isMonth(month)) return new NextResponse("Pick a month", { status: 400 });
  const asked = (sp.get("email") ?? "").trim().toLowerCase();
  const email = asked && me.role === "admin" ? asked : String(me.email).toLowerCase();

  const { data: who } = await supabase.from("profiles").select("id, full_name, email").eq("email", email).maybeSingle();
  const receipts = await receiptsFor(month, email);
  const name = (who?.full_name as string | null) || receipts.find((r) => r.name)?.name || email;
  const { data: sent } = who
    ? await supabase.from("expense_reports").select("sent_at").eq("user_id", who.id).eq("month", `${month}-01`).maybeSingle()
    : { data: null };
  const pdf = await renderExpensePdf({ name, email, month, receipts, sentAt: (sent?.sent_at as string | undefined) ?? null });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${expensePdfName(name, month)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
