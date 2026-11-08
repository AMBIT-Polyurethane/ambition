import { LifeBuoy } from "lucide-react";
import { getWorkspace } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { OpsNav } from "@/components/ops/ops-nav";
import { Submit } from "@/components/forms";
import { leaveWorkspace } from "./workspace-actions";
import { brandCss, pickBrand, type BrandTheme } from "@/lib/ops/brand";
import { GuideCoach } from "@/components/ops/ai/guide";

// Every AMBIT-OPS screen: the contractor's colors, the workflow strip across the top, and a banner when an
// AMBIT admin is helping in a contractor's workspace (so it's never mistaken for AMBIT's own data).
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const s = await getWorkspace();
  if (!s) return <>{children}</>;
  const { ws, profile } = s;
  // The contractor's colors (from their logo) for everything inside the workspace. AMBIT keeps the frame.
  const brand = pickBrand(((ws.company.ops_settings ?? {}) as { theme?: BrandTheme }).theme, ws.settings.color);
  return (
    <div className={`ops-brand${brand.fromLogo ? " has-brand" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: brandCss(brand) }} />
      {ws.support ? (
        <div className="ops-support">
          <LifeBuoy size={16} />
          <span className="grow">
            {ws.company.ops_demo ? "AMBIT demo workspace: " : "Helping as AMBIT support in "}
            <b>{ws.brand}</b>
            {ws.company.ops_demo ? "" : " (visits are logged for the owner)"}
          </span>
          <form action={leaveWorkspace}>
            <Submit className="btn sm ghost" pendingText="…">Leave</Submit>
          </form>
        </div>
      ) : null}
      {!opsCan.fieldOnly(ws.role) ? <OpsNav crm={opsCan.crm(ws.role)} manage={opsCan.manage(ws.role)} /> : null}
      {children}
      {opsCan.manage(ws.role) ? <GuideCoach userId={profile.id} /> : null}
    </div>
  );
}
