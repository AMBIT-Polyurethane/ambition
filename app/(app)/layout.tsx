import { TabBar } from "@/components/tabbar";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireActive();
  return (
    <>
      {children}
      <TabBar showOrder={profile.role === "customer" || can(profile, "ordering")} />
    </>
  );
}
