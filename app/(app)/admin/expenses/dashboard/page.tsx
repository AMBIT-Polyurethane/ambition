import { CircleAlert } from "lucide-react";
import { requireExpenseApprover } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { todayCentral } from "@/lib/sale";
import { PERIODS, addDays, shiftMonth, type PeriodKey } from "@/lib/expense-kinds";
import { DashFilters } from "@/components/expenses/dash";
import { ExpenseDashboard, type Kpis } from "@/components/expenses/dashboard";

export const metadata = { title: "Expense dashboard" };
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function period(p: PeriodKey, today: string, from?: string, to?: string): { from: string; to: string } {
  const m = today.slice(0, 7);
  if (p === "month") return { from: `${m}-01`, to: today };
  if (p === "last") return { from: `${shiftMonth(m, -1)}-01`, to: addDays(`${m}-01`, -1) };
  if (p === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (p === "12m") return { from: `${shiftMonth(m, -11)}-01`, to: today };
  if (p === "custom" && from && to && DAY.test(from) && DAY.test(to) && from <= to) return { from, to: to > today ? today : to };
  return { from: `${shiftMonth(m, -2)}-01`, to: today };
}

// Approvers only (the database refuses anyone else too).
export default async function ExpenseDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireExpenseApprover();
  const today = todayCentral();
  const p = (PERIODS.some(([k]) => k === sp.p) ? sp.p : "q") as PeriodKey;
  const { from, to } = period(p, today, sp.from, sp.to);
  const branch = sp.b && /^[a-z0-9_-]{1,20}$/i.test(sp.b) ? sp.b : null;
  const user = sp.u && /^[0-9a-f-]{36}$/i.test(sp.u) ? sp.u : null;

  const [res, { data: branches }, { data: staff }] = await Promise.all([
    supabase.rpc("expense_kpis", { p_from: from, p_to: to, p_branch: branch, p_user: user }),
    supabase.from("branches").select("id, name").eq("active", true).order("sort"),
    supabase.from("profiles").select("id, full_name, email, demo").or("status.eq.active,demo.eq.true").in("role", ["employee", "admin"]).order("full_name"),
  ]);
  const anyDemo = ((staff ?? []) as { demo?: boolean }[]).some((x) => x.demo);
  const k = res.data as Kpis | null;
  const label = PERIODS.find(([x]) => x === p)?.[1] ?? "";
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <main className="shell wide">
      <TopBar title="Expense dashboard" back="/admin/expenses" />
      <div className="col" style={{ gap: 4 }}>
        <DashFilters
          branches={(branches ?? []) as { id: string; name: string }[]}
          people={((staff ?? []) as { id: string; full_name: string | null; email: string; demo?: boolean }[]).map((x) => ({ id: x.id, name: `${x.full_name || x.email}${x.demo ? " (demo)" : ""}` }))}
          from={from}
          to={to}
        />
        <span className="tiny muted">
          {label === "Pick dates" ? "" : `${label}: `}
          {fmt(from)} – {fmt(to)}. Compared with the same number of days before ({fmt(k?.prev_from ?? from)} – {fmt(k?.prev_to ?? from)}).
        </span>
      </div>
      {anyDemo ? (
        <div className="alert info small" style={{ margin: 0 }}>
          <span>
            Includes demo data (made-up employees). Delete it in <a href="/admin/expenses?tab=setup">Admin → Expense reports → Setup</a> before real employees start.
          </span>
        </div>
      ) : null}
      {res.error || !k ? (
        <div className="alert err small">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>{res.error?.message ?? "Couldn't load the dashboard."}</span>
        </div>
      ) : (
        <ExpenseDashboard k={k} month={to.slice(0, 7)} />
      )}
    </main>
  );
}
