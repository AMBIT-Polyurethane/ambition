import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { TopBar } from "@/components/ui";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "New customer" };
export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const { ws } = await requireOps(opsCan.editCrm);
  return (
    <main className="shell">
      <TopBar title="New customer" back="/ops/customers" />
      <CustomerForm sources={ws.settings.sources} />
    </main>
  );
}
