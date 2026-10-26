import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { COMPLAINT_STATUS, SYMPTOMS } from "@/lib/complaints";
import { dateShort, dateTime } from "@/lib/format";
import { startComplaint } from "./actions";

export const metadata = { title: "Complaint reports" };
export const dynamic = "force-dynamic";

async function newReport() {
  "use server";
  const r = await startComplaint(null);
  redirect(r.id ? `/complaints/${r.id}` : `/complaints?err=${encodeURIComponent(r.error ?? "Couldn't start it.")}`);
}

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const team = can(profile, "complaints") || profile.role === "admin";
  const { data, error } = await supabase
    .from("complaint_reports")
    .select("id, report_no, status, company_name, product, lot_numbers, symptoms, created_by_name, created_at, submitted_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as {
    id: string;
    report_no: string | null;
    status: string;
    company_name: string | null;
    product: string | null;
    lot_numbers: string | null;
    symptoms: string[];
    created_by_name: string | null;
    created_at: string;
    submitted_at: string | null;
  }[];
  const label = (s: string) => SYMPTOMS.find((x) => x.id === s)?.label ?? s;

  return (
    <main className="shell">
      <TopBar title="Complaint reports" back="/" />
      {sp.msg ? <div className="alert ok small">{sp.msg}</div> : null}
      {sp.err ? <div className="alert err small">{sp.err}</div> : null}
      {error ? <div className="alert warn small">Run supabase/migrations/0021_intake_photos_reorder_tax.sql in Supabase first.</div> : null}
      <p className="muted small" style={{ margin: 0 }}>
        {team ? "Every complaint report, newest first." : "Your complaint reports."} The quickest way to start one: send photos of the problem to{" "}
        <Link href="/assistant">Ask AMBIT</Link>, then tap &ldquo;Start a complaint report&rdquo;.
      </p>
      <form action={newReport}>
        <Submit className="btn sm dark" pendingText="Starting…"><Plus size={16} /> New report by hand</Submit>
      </form>
      {rows.length ? (
        <div className="list">
          {rows.map((r) => {
            const st = COMPLAINT_STATUS[r.status] ?? COMPLAINT_STATUS.draft;
            return (
              <Link key={r.id} href={`/complaints/${r.id}`} className="item">
                <div className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{r.report_no ?? "Draft"} · {r.product ?? "Product not set"}{r.company_name ? ` · ${r.company_name}` : ""}</span>
                  <span className="s ellipsis">
                    {r.symptoms?.length ? r.symptoms.map(label).join(", ") : "No symptoms picked"}
                    {r.lot_numbers ? ` · lots ${r.lot_numbers}` : ""} · {r.created_by_name} · {r.submitted_at ? dateShort(r.submitted_at) : dateTime(r.created_at)}
                  </span>
                </div>
                <span className={st.cls}>{st.label}</span>
                <ChevronRight size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      ) : !error ? (
        <div className="alert info small">No complaint reports yet.</div>
      ) : null}
    </main>
  );
}
