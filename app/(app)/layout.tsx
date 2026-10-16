import { TabBar } from "@/components/tabbar";
import { requireActive } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireActive();
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
