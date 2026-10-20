import { ExternalLink } from "lucide-react";
import { TopBar } from "@/components/ui";
import { editUrl } from "@/lib/jotform";
import { ownedPriceRequest } from "@/lib/prf-access";

export const metadata = { title: "Edit price request" };
export const dynamic = "force-dynamic";

// Jotform's own edit screen, shown inside the app. Submitting saves over the same request.
export default async function EditPriceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { item } = await ownedPriceRequest(id);
  const url = editUrl(id);
  return (
    <main className="shell wide" style={{ gap: 12 }}>
      <TopBar
        title={`Edit: ${item.customer || item.contact || "price request"}`}
        back={`/price-requests/${id}`}
        right={
          <a className="iconbtn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in browser">
            <ExternalLink size={18} />
          </a>
        }
      />
      <div className="tiny faint">Make your changes and press Submit at the end. It updates this same request; it won't create a duplicate.</div>
      <iframe className="frame" src={url} title="Edit price request" allow="geolocation; camera; fullscreen" />
    </main>
  );
}
