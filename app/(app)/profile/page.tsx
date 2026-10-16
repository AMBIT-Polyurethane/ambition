import { LogOut } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { initials } from "@/lib/format";
import { ListLink, TopBar } from "@/components/ui";
import { ProfileForm } from "@/components/profile-form";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { supabase, user, profile } = await requireActive();
  const emp = isEmployee(profile);
  const { data: branches } = await supabase.from("branches").select("id, name, state").eq("active", true).order("sort");
  const usesPassword = (user.identities ?? []).some((i) => i.provider === "email");

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

      <div className="list">
        <ListLink href="/orders" icon="cart" title={emp ? "Orders" : "My orders"} sub="History and reorder" />
        {emp ? <ListLink href="/directory" icon="users" title="Company directory" /> : null}
        {profile.role === "admin" ? <ListLink href="/admin" icon="shield" title="Admin" sub="Accounts, products, links and docs" /> : null}
        {usesPassword ? <ListLink href="/reset-password" icon="shield" title="Change password" /> : null}
      </div>

      <div className="card small muted">
        <b style={{ color: "#fff" }}>Put AMBITION on your home screen.</b> iPhone: open this site in Safari, tap Share, then
        &ldquo;Add to Home Screen&rdquo;. Android: tap the ⋮ menu in Chrome, then &ldquo;Install app&rdquo;.
      </div>

      <form action="/auth/signout" method="post">
        <button className="btn dark block" type="submit"><LogOut size={18} /> Sign out</button>
      </form>
    </main>
  );
}
