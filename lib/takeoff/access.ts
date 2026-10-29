import "server-only";
import { redirect } from "next/navigation";
import { can } from "@/lib/access";
import { getSession, requireActive } from "@/lib/session";
import { getWorkspace, type Workspace } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";

// Who can use Takeoff: AMBIT staff with the Takeoff box (AMBIT's own takeoffs), and a contractor's
// office, dispatch and sales in their AMBIT-OPS workspace (their own takeoffs). The database rules
// (0032) decide which takeoffs each one sees.

export type TakeoffAccess = Awaited<ReturnType<typeof requireActive>> & { ws: Workspace | null; staff: boolean };

export async function takeoffAccess(): Promise<TakeoffAccess | null> {
  const s = await getSession();
  if (!s?.profile || s.profile.status !== "active") return null;
  const w = await getWorkspace();
  const ws = w?.ws ?? null;
  if (can(s.profile, "takeoff")) return { ...s, profile: s.profile, ws, staff: true };
  if (ws && opsCan.editCrm(ws.role)) return { ...s, profile: s.profile, ws, staff: false };
  return null;
}

export async function requireTakeoff(): Promise<TakeoffAccess> {
  const a = await takeoffAccess();
  if (!a) {
    await requireActive();
    redirect("/");
  }
  return a;
}
