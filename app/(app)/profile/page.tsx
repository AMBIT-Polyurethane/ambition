import { LogOut } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { initials } from "@/lib/format";
import { ListLink, TopBar } from "@/components/ui";
import { ProfileForm } from "@/components/profile-form";
import { ThemePicker } from "@/components/theme-picker";
import { DeleteAccount } from "@/components/delete-account";
import { getTheme } from "@/lib/theme-server";
import { CertForm } from "@/components/tax/cert-form";
import { companyTax } from "@/lib/tax-server";
import { CERT_STATUS, TAX_STATE, taxLine, type CertRow } from "@/lib/tax";
import { dateShort } from "@/lib/format";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { supabase, user, profile } = await requireActive();
  const emp = isEmployee(profile);
  const { data: branches } = await supabase.from("branches").select("id, name, state").eq("active", true).order("sort");
  const usesPassword = (user.identities ?? []).some((i) => i.provider === "email");
  const theme = await getTheme();
  // Contractors: their tax-exempt certificate, and a place to send the renewal.
  const tax = !emp && profile.company_id ? await companyTax(supabase, profile.company_id) : null;
  const { data: certRows } = !emp && profile.company_id
    ? await supabase.from("tax_certificates").select("*").eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(5)
    : { data: [] };
  const certs = (certRows ?? []) as CertRow[];

  return (
    <main className="shell">
      <TopBar title="Profile" />
      <div className="row" style={{ gap: 14 }}>
        <div className="avatar" style={{ width: 60, height: 60, fontSize: 20 }}>{initials(profile.full_name, profile.email)}</div>
        <div className="grow">
          <div className="h2 ellipsis">{profile.full_name ?? profile.email}</div>
          <div className="muted small ellipsis">{profile.email}</div>
          <div className="small" style={{ marginTop: 4 }}>
            <span className="pill">{profile.role === "admin" ? "Admin" : emp ? "AMBIT team" : "Contractor"}</span>
          </div>
        </div>
      </div>

      {!emp && profile.company ? (
        <div className="card small">
          <div className="faint tiny" style={{ marginBottom: 4 }}>COMPANY</div>
          <b>{profile.company.name}</b>
          {profile.company.account_no ? <span className="muted"> · Account {profile.company.account_no}</span> : null}
        </div>
      ) : null}

      <ProfileForm profile={profile} branches={branches ?? []} employee={emp} />

      {!emp && profile.company_id && tax ? (
        <section className="section" id="tax">
          <div className="eyebrow">Sales-tax exemption</div>
          <div className="card col" style={{ gap: 10 }}>
            <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
              <b>{tax.state === "taxable" ? "No tax-exempt certificate on file" : taxLine(tax, dateShort)}</b>
              {tax.state !== "taxable" ? <span className={TAX_STATE[tax.state].cls}>{TAX_STATE[tax.state].label}</span> : null}
            </div>
            {certs.length ? (
              <div className="col tight">
                {certs.map((c) => (
                  <span key={c.id} className="tiny faint">
                    {c.state ?? ""} {c.cert_number ? `#${c.cert_number}` : "certificate"} · {c.no_expiration ? "no expiration" : c.expires_on ? `expires ${dateShort(c.expires_on)}` : ""} ·{" "}
                    {(CERT_STATUS[c.status] ?? CERT_STATUS.pending).label}
                    {c.status === "rejected" && c.note ? ` (${c.note})` : ""}
                  </span>
                ))}
              </div>
            ) : null}
            <details open={tax.state === "expired" || tax.state === "expiring" || tax.state === "missing"}>
              <summary className="linkbtn small">{tax.state === "taxable" ? "Tax-exempt? Send your certificate" : "Send a new or renewed certificate"}</summary>
              <div style={{ marginTop: 12 }}>
                <CertForm companyId={profile.company_id} asCustomer defaultState={null} />
              </div>
            </details>
          </div>
        </section>
      ) : null}

      <ThemePicker current={theme} />

      <div className="list">
        <ListLink href="/orders" icon="cart" title={emp ? "Orders" : "My orders"} sub="History and reorder" />
        {emp ? <ListLink href="/directory" icon="users" title="Company directory" /> : null}
        {profile.role === "admin" ? <ListLink href="/admin" icon="shield" title="Admin" sub="Accounts, products, links and docs" /> : null}
        {usesPassword ? <ListLink href="/reset-password" icon="shield" title="Change password" /> : null}
      </div>

      <div className="card small muted">
        <b style={{ color: "var(--text)" }}>Put AMBIT Intelligence on your home screen.</b> iPhone: open this site in Safari, tap Share, then
        &ldquo;Add to Home Screen&rdquo;. Android: tap the ⋮ menu in Chrome, then &ldquo;Install app&rdquo;.
      </div>

      <form action="/auth/signout" method="post">
        <button className="btn dark block" type="submit"><LogOut size={18} /> Sign out</button>
      </form>

      <DeleteAccount email={profile.email} />
    </main>
  );
}
