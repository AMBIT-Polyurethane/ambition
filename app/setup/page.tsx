import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";
import { redirect } from "next/navigation";
import { BrandImg } from "@/components/brand";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (SUPABASE_URL && SUPABASE_KEY) redirect("/");
  return (
    <main className="auth">
      <div className="col" style={{ gap: 16, marginTop: 40 }}>
        <BrandImg art="atom-mark" width={88} height={88} />
        <h1 className="h1">
          <span className="wordmark">AMBIT <span>Intelligence</span></span> is almost ready
        </h1>
        <p className="muted">
          The app is running but is not connected to its database yet. In Vercel, open this project&apos;s
          Settings → Environment Variables and add <b>NEXT_PUBLIC_SUPABASE_URL</b> and{" "}
          <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</b>, then redeploy.
        </p>
      </div>
    </main>
  );
}
