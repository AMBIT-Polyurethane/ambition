import QRCode from "qrcode";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { currentOrigin } from "@/lib/origin";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { CopyBox } from "./copy-box";
import { markFormShared, newFormLink } from "../actions";

export const metadata = { title: "Website lead form" };
export const dynamic = "force-dynamic";

export default async function LeadFormSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { ws } = await requireOps(opsCan.manage);
  const origin = await currentOrigin();
  const link = `${origin}/lead/${ws.company.ops_form_token}`;
  const embed = `<iframe src="${link}?embed=1" title="Request a quote from ${ws.brand.replace(/"/g, "")}" style="width:100%;max-width:560px;height:760px;border:0;"></iframe>`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 360 });
  const shared = !!(((ws.company.ops_settings ?? {}) as Record<string, unknown>).reviewed as Record<string, boolean> | undefined)?.form;
  return (
    <SettingsShell title="Website lead form" sp={sp}>
      <p className="muted small" style={{ margin: 0 }}>
        Customers fill this in to ask for a quote. Each request lands on your Leads board as a new lead, with the customer, their address and what they need already filled in. No sign-in for them.
      </p>
      <section className="card col" style={{ gap: 10 }}>
        <b>Your link</b>
        <span className="tiny faint">Put it on a &ldquo;Get a quote&rdquo; button on your website, in your Google Business Profile, on Facebook, or in a text.</span>
        <CopyBox value={link} label="Copy link" />
        <a href={link} target="_blank" rel="noopener noreferrer" className="linkbtn small">Open the form to see it</a>
      </section>
      <section className="card col" style={{ gap: 10 }}>
        <b>Or put the form right on your website</b>
        <span className="tiny faint">Send this to whoever runs your website. It shows the form inside any page.</span>
        <CopyBox value={embed} label="Copy website code" multiline />
      </section>
      <section className="card row wrap" style={{ gap: 16, alignItems: "center" }}>
        <img src={qr} alt="QR code for your lead form" width={150} height={150} style={{ borderRadius: 10, background: "#fff", padding: 6 }} />
        <span className="col" style={{ gap: 6, flex: "1 1 200px" }}>
          <b>QR code</b>
          <span className="tiny faint">For yard signs, truck wraps and flyers. Right-click or press and hold to save it.</span>
        </span>
      </section>
      <div className="row wrap" style={{ gap: 8 }}>
        {!shared ? <form action={markFormShared}><Submit className="btn sm" pendingText="…">I&apos;ve put it on my website</Submit></form> : null}
        <form action={newFormLink}><Submit className="btn sm ghost" pendingText="…">Make a new link (stops the old one)</Submit></form>
      </div>
    </SettingsShell>
  );
}
