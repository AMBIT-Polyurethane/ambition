import { redirect } from "next/navigation";
import { ResetForm } from "@/components/auth-forms";
import { TopBar } from "@/components/ui";
import { getSession } from "@/lib/session";

export const metadata = { title: "New password" };

export default async function ResetPasswordPage() {
  const s = await getSession();
  if (!s) redirect("/signin?error=link");
  return (
    <main className="auth" style={{ paddingTop: 24 }}>
      <TopBar title="Choose a new password" back="/" />
      <p className="muted small" style={{ margin: "14px 0 20px" }}>Signed in as {s.user.email}</p>
      <ResetForm />
    </main>
  );
}
