import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { inventoryBranches, spotChecks } from "@/lib/widgets";
import { Empty, TopBar } from "@/components/ui";
import { SpotCheckForm } from "@/components/count-input";

export const metadata = { title: "Spot checks" };

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/** Today's spot check and any weekdays missed, for one location. */
export default async function SpotPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin" && !can(profile, "inventory")) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) return <main className="shell"><TopBar title="Spot checks" back="/inventory" /><Empty icon="boxes" title="No location has live inventory yet" /></main>;
  const s = await spotChecks(supabase, branch.id);

  return (
    <main className="shell">
      <TopBar title="Spot checks" back={`/inventory?b=${branch.id}`} right={<Link href={`/inventory/counts?b=${branch.id}`} className="btn sm dark">History</Link>} />
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((b) => (
            <Link key={b.id} href={`/inventory/spot?b=${b.id}`} className={`chip${b.id === branch.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        Every weekday the app picks one item at {branch.name} to count (each item gets a turn before any repeats). Count what&apos;s on the shelf, including anything set aside for orders that haven&apos;t left. If it doesn&apos;t match the app, an admin approves the change.
      </p>
      {!s ? (
        <div className="alert warn small">Spot checks need database update 0027.</div>
      ) : (
        <>
          {s.missed.length ? (
            <div className="alert err small" role="alert">
              <CircleAlert size={18} style={{ flex: "none" }} />
              <span><b>{s.missed.length} missed spot {s.missed.length === 1 ? "check" : "checks"}.</b> Count {s.missed.length === 1 ? "it" : "them"} below.</span>
            </div>
          ) : null}
          <section className="card col" style={{ gap: 10 }}>
            <div className="eyebrow">Today</div>
            {!s.today ? (
              <span className="small muted">No spot check today (weekends are off).</span>
            ) : s.today.status === "open" ? (
              <SpotCheckForm lines={s.today.lines} day={dayLabel(s.today.day)} />
            ) : (
              <div className={`spot-done ${s.today.status === "submitted" ? "warn" : "ok"}`}>
                {s.today.status === "submitted" ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
                {s.today.lines[0]?.sku}: {s.today.status === "submitted" ? "counted, waiting for an admin to approve the difference." : "counted. Done for today."}
              </div>
            )}
          </section>
          {s.missed.map((c) => (
            <section key={c.id} className="card col" style={{ gap: 10, borderColor: "var(--err, #d03b3b)" }}>
              <div className="eyebrow" style={{ color: "var(--err-text)" }}>Missed · {dateShort(c.day)}</div>
              <SpotCheckForm lines={c.lines} day={dayLabel(c.day)} />
            </section>
          ))}
        </>
      )}
    </main>
  );
}
