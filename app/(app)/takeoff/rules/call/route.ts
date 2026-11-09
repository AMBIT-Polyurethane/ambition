import { NextResponse, type NextRequest } from "next/server";
import { takeoffAccess } from "@/lib/takeoff/access";

export const dynamic = "force-dynamic";

/** One logged AI call, in full (what was asked about and what came back). */
export async function GET(req: NextRequest) {
  const a = await takeoffAccess();
  if (!a) return new NextResponse("Not allowed", { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data } = await a.supabase.from("takeoff_ai_calls").select("*").eq("id", id).maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
