import { Globe, Mail, Receipt } from "lucide-react";
import { getPartner } from "@/lib/partner-store";
import { currentOrigin } from "@/lib/origin";

export const metadata = { title: "QuickBooks & email" };

// Step 2 of the store: his own QuickBooks and his own Gmail. Shown now so he knows what's coming; nothing to click yet.
export default async function DeskConnect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p, origin] = await Promise.all([getPartner(slug), currentOrigin()]);
  return (
    <div className="adc-stack-s">
      <div className="ptn-desk-h">
        <span>
          <h1 className="adc-h1">QuickBooks &amp; email</h1>
          <span className="adc-muted">Your own accounts, linked to your store. Only you connect them, and only your store uses them.</span>
        </span>
      </div>
      <div className="ptn-look">
        <section className="ptn-card">
          <span className="ptn-card-h"><Receipt size={18} aria-hidden="true" /><b>QuickBooks Online</b><span className="ptn-soon">Coming next</span></span>
          <ul className="ptn-list">
            <li>Every store order becomes an invoice in your QuickBooks.</li>
            <li>Your customers pay the invoice online by card through Intuit.</li>
            <li>Customers, purchase prices and sell prices stay the same in both places.</li>
            <li>Later: your QuickBooks inventory goes down when an order ships.</li>
          </ul>
          <span className="adc-muted small">You&apos;ll click Connect QuickBooks here and sign in to Intuit yourself. AMBIT never sees your QuickBooks.</span>
        </section>
        <section className="ptn-card">
          <span className="ptn-card-h"><Mail size={18} aria-hidden="true" /><b>Your Gmail</b><span className="ptn-soon">Coming next</span></span>
          <ul className="ptn-list">
            <li>Order copies, invites and &quot;your order shipped&quot; emails go out from {p?.email ?? "your address"}.</li>
            <li>Your customers&apos; replies land in your inbox.</li>
          </ul>
          <span className="adc-muted small">Until then they go out from the store with your name on them, and replies already go to {p?.email ?? "you"}.</span>
        </section>
        <section className="ptn-card wide">
          <span className="ptn-card-h"><Globe size={18} aria-hidden="true" /><b>Your web address</b></span>
          <span>Your store is at <a href={`${origin}/store/${slug}`}>{origin.replace(/^https?:\/\//, "")}/store/{slug}</a>. Share that link with your customers today.</span>
          <span className="adc-muted small">Later it can move to your own web address. Whoever manages your domain adds one setting we send them.</span>
        </section>
      </div>
    </div>
  );
}
