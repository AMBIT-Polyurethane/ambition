import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { saveCompany } from "../actions";
import { LogoUpload } from "./logo-upload";

export const metadata = { title: "Company and logo" };
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { ws } = await requireOps(opsCan.manage);
  const s = ws.settings;
  return (
    <SettingsShell title="Company and logo" sp={sp}>
      <section className="card col" style={{ gap: 12 }}>
        <b>Logo</b>
        <span className="tiny faint">Shown on proposals, invoices, work orders and your website lead form. A PNG with a clear background looks best.</span>
        <LogoUpload companyId={ws.company.id} url={ws.logoUrl} />
      </section>
      <form action={saveCompany} className="card col" style={{ gap: 12 }}>
        <b>What customers see</b>
        <label className="field">
          <span className="label">Company name</span>
          <input className="input" name="display_name" defaultValue={s.display_name || ws.company.name} maxLength={120} />
        </label>
        <div className="grid2">
          <label className="field">
            <span className="label">Phone</span>
            <input className="input" name="phone" inputMode="tel" defaultValue={s.phone} maxLength={40} />
          </label>
          <label className="field">
            <span className="label">Email</span>
            <input className="input" name="email" type="email" defaultValue={s.email} maxLength={160} />
          </label>
          <label className="field">
            <span className="label">Website</span>
            <input className="input" name="website" defaultValue={s.website} maxLength={200} placeholder="www.yourcompany.com" />
          </label>
          <label className="field">
            <span className="label">License or registration #</span>
            <input className="input" name="license_no" defaultValue={s.license_no} maxLength={80} placeholder="Optional" />
          </label>
        </div>
        <label className="field">
          <span className="label">Address</span>
          <input className="input" name="address" defaultValue={s.address} maxLength={300} placeholder="Street, city, state ZIP" />
        </label>
        <label className="field" style={{ maxWidth: 240 }}>
          <span className="label">Brand color</span>
          <input className="input" type="color" name="color" defaultValue={s.color || "#e33527"} style={{ padding: 6, height: 50 }} />
        </label>
        <Submit className="btn" pendingText="Saving…">Save</Submit>
      </form>
    </SettingsShell>
  );
}
