import { requireEmployee } from "@/lib/session";
import { DirectoryList, type Person } from "@/components/directory-list";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Company directory" };

export default async function DirectoryPage() {
  const { supabase } = await requireEmployee();
  const [{ data: people }, { data: branches }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, phone, title, branch_id").in("role", ["employee", "admin"]).eq("status", "active").order("full_name"),
    supabase.from("branches").select("id, name"),
  ]);
  const bname = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const list: Person[] = (people ?? []).map((p) => ({ ...p, branch: p.branch_id ? bname.get(p.branch_id) ?? null : null }));
  return (
    <main className="shell">
      <TopBar title="Company directory" back="/" />
      <p className="muted small" style={{ margin: 0 }}>Everyone at AMBIT who has signed in to AMBIT Intelligence. Add your title and phone on your Profile.</p>
      <DirectoryList people={list} />
    </main>
  );
}
