import { ForgotForm } from "@/components/auth-forms";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <main className="auth" style={{ paddingTop: 24 }}>
      <TopBar title="Reset password" back="/signin" />
      <p className="muted small" style={{ margin: "14px 0 20px" }}>
        Enter the email you sign in with and we&apos;ll send you a link to choose a new password.
        AMBIT employees who sign in with Microsoft reset their password through IT.
      </p>
      <ForgotForm />
    </main>
  );
}
