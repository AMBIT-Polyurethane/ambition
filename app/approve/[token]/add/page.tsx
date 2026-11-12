import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { orderNo } from "@/lib/format";
import { AddItems, type Option } from "./add-items";

export const metadata: Metadata = { title: "Add items to your order", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type View = { state: string; order_no: number; company: string; branch: string | null; items: Option[] } | null;

/** From the approval email: the customer adds popular items to the order before approving it (no sign-in). */
export default async function AddPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("order_addon_options", { p_token: token });
  const v = data as View;
  const [{ data: br }] = await Promise.all([v?.branch ? supabase.from("branches").select("name").eq("id", v.branch).maybeSingle() : Promise.resolve({ data: null })]);
  return (
    <div className="theme-light approve-page">
      <main className="shell no-tabs" style={{ maxWidth: 640 }}>
        <header className="row between" style={{ paddingTop: 6 }}>
          <img src="/brand/logo-dark.png" alt="AMBIT Polyurethane" style={{ height: 34, width: "auto" }} />
          <span className="tiny faint">(817) 677-1200</span>
        </header>
        {!v ? (
          <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>This link isn&apos;t valid. Ask your AMBIT rep to send the order again, or call AMBIT at (817) 677-1200.</span></div>
        ) : v.state !== "pending" ? (
          <>
            <div className="alert warn"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>
              {v.state === "approved" ? "This order is already approved, so items can't be added here. Call your AMBIT rep to add to it." : v.state === "expired" ? "This link has expired. Ask your AMBIT rep to send it again." : v.state === "cancelled" ? "This order was cancelled." : "Your AMBIT rep is updating this order. Watch for a new email."}
            </span></div>
            <Link href={`/approve/${token}`} className="btn dark block">Back to the order</Link>
          </>
        ) : (
          <>
            <div>
              <div className="eyebrow" style={{ color: "var(--red-text)" }}>Add to {orderNo(v.order_no)}</div>
              <h1 className="h1" style={{ marginTop: 6 }}>Need anything else?</h1>
              <div className="muted">{v.company} · {br?.name ? `from ${(br as { name: string }).name}` : "AMBIT"}</div>
            </div>
            <AddItems token={token} options={v.items} start={sp.add ?? null} branchName={(br as { name: string } | null)?.name ?? "AMBIT"} />
          </>
        )}
        <p className="tiny faint center" style={{ margin: "8px 0 0" }}>AMBIT Polyurethane · orders@ambitpu.com · www.AMBITPU.com</p>
      </main>
    </div>
  );
}
