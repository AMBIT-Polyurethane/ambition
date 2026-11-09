import { NextResponse, type NextRequest } from "next/server";
import { takeoffAccess } from "@/lib/takeoff/access";
import { loadTeaching, rulesScope, teachingJson, teachingMarkdown } from "@/lib/takeoff/teaching";

export const dynamic = "force-dynamic";

/** Download everything the takeoff AI has been taught: ?f=json (to import into another app) or ?f=md (to read). */
export async function GET(req: NextRequest) {
  const a = await takeoffAccess();
  if (!a) return new NextResponse("Not allowed", { status: 403 });
  const ops = req.nextUrl.searchParams.get("ops") === "1";
  const scope = rulesScope(a, ops);
  const t = await loadTeaching(a.supabase, scope);
  const j = teachingJson(t, { scopeName: scope ? a.ws?.company.name ?? "Your company" : "AMBIT", withPrompts: scope === null });
  const day = new Date().toISOString().slice(0, 10);
  const md = req.nextUrl.searchParams.get("f") === "md";
  return new NextResponse(md ? teachingMarkdown(j) : JSON.stringify(j, null, 2), {
    headers: {
      "Content-Type": md ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="takeoff-ai-teaching-${day}.${md ? "md" : "json"}"`,
      "Cache-Control": "no-store",
    },
  });
}
