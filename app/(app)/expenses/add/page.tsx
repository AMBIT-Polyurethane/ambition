import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { expensesReady, receiptFormUrl } from "@/lib/expenses";

export const metadata = { title: "Add a receipt" };
export const dynamic = "force-dynamic";

// The receipt form (Jotform), filled in with who's signed in.
export default async function AddReceiptPage() {
  const { profile } = await requireEmployee();
  if (!expensesReady()) notFound();
  const url = receiptFormUrl(profile);
  return (
    <main className="shell wide" style={{ gap: 12 }}>
      <TopBar
        title="Add a receipt"
        back="/expenses"
        right={
          <a className="iconbtn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in browser">
            <ExternalLink size={18} />
          </a>
        }
      />
      <iframe className="frame" src={url} title="Add a receipt" allow="camera; fullscreen" />
    </main>
  );
}
