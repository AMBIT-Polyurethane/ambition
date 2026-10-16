import { RequestAccessForm } from "@/components/auth-forms";
import { TopBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Request access" };

export default async function RequestAccessPage() {
  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name, state").eq("active", true).order("sort");
  return (
    <main className="auth" style={{ paddingTop: 24 }}>
      <TopBar title="Request contractor access" back="/signin" />
      <p className="muted small" style={{ margin: "14px 0 20px" }}>
        For AMBIT contractor customers. Tell us who you are and we&apos;ll link your login to your company account,
        usually within one business day.
      </p>
      <RequestAccessForm branches={branches ?? []} />
    </main>
  );
}
