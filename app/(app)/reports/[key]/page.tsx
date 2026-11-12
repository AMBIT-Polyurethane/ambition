import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { canSee, inventoryLock, ordersScope, reportDef, salesScope } from "@/lib/reports";
import { BUILDERS, type Ctx } from "@/lib/reports-data";
import { inventoryBranches } from "@/lib/widgets";
import { salesRange } from "@/lib/sales-range";
import { todayCentral } from "@/lib/sale";
import { dateShort } from "@/lib/format";
import { Empty, TopBar } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { RangeFilter } from "@/components/range-filter";
import { ReportTable } from "@/components/inventory/report-table";
import { CustomerPick } from "@/components/reports/report-pickers";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: reportDef(key)?.title ?? "Report" };
}

/** One report from the Reports section: its controls (dates, location, customer or lot), the numbers, the table. */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  const def = reportDef(key);
  if (!def || def.href) notFound();
  const { supabase, profile } = await requireActive();
  if (!isEmployee(profile) || !canSee(profile, key)) redirect("/reports");
  const today = todayCentral();
  const base = `/reports/${key}`;

  if (def.soon) {
    return (
      <main className="shell">
        <TopBar title={def.title} back="/reports" />
        <Empty icon="layers" title="Coming soon">{def.blurb} {def.soon}</Empty>
      </main>
    );
  }

  // Locations: every location for sales and orders; the ones with inventory for the inventory reports (a warehouse
  // manager only ever gets their own).
  let places: { id: string; name: string }[] = [];
  let branch: string | null = null;
  if (def.location === "inventory") {
    places = await inventoryBranches(supabase, profile);
    const lock = inventoryLock(profile);
    branch = lock !== null ? places[0]?.id ?? "none" : places.find((b) => b.id === sp.b)?.id ?? null;
  } else if (def.location === "sales") {
    const { data } = await supabase.from("branches").select("id, name, sort").order("sort");
    places = (data ?? []) as { id: string; name: string }[];
    branch = places.find((b) => b.id === sp.b)?.id ?? null;
  }
  const scope = def.group === "orders" ? ordersScope(profile) : salesScope(profile);
  const rep = (def.group === "sales" || def.group === "orders") && key !== "price-sheet" && key !== "price-requests" && scope === "rep" ? profile.id : null;
  const range = def.range ? salesRange(sp, today, def.range) : null;
  const ctx: Ctx = { db: supabase, p: profile, today, from: range?.from ?? null, to: range?.to ?? null, branch, rep, sp };
  const out = await BUILDERS[key](ctx);

  // The customer list for the price sheet.
  const customers =
    key === "price-sheet"
      ? (((await supabase.from("companies").select("id, name, account_no, city").eq("active", true).order("name").limit(5000)).data ?? []) as { id: string; name: string; account_no: string | null; city: string | null }[])
      : [];
  const keep = Object.fromEntries(Object.entries({ b: branch && !inventoryLock(profile) ? branch : "", d: sp.d ?? "" }).filter(([, v]) => v)) as Record<string, string>;
  const rangeQs: Record<string, string> = {};
  if (range && range.key !== def.range) {
    if (range.key !== "custom") rangeQs.r = range.key;
    else {
      if (range.from) rangeQs.from = range.from;
      if (range.to) rangeQs.to = range.to;
    }
  }
  const href = (more: Record<string, string>) => {
    const q = new URLSearchParams({ ...rangeQs, ...keep, ...more });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return q.size ? `${base}?${q}` : base;
  };
  const placeName = branch ? places.find((b) => b.id === branch)?.name ?? branch : "All locations";
  const money = out.money ?? out.num.map(() => false);

  return (
    <main className="shell wide">
      <TopBar title={def.title} back="/reports" right={out.prompt ? undefined : <span className="no-print"><PrintButton /></span>} />
      <p className="print-only report-print-head">
        <b>AMBIT</b>
        {def.location ? ` · ${placeName}` : ""}
        {range ? ` · ${range.label}` : ""}
        {rep ? " · my customers" : ""}
        {key === "price-sheet" && sp.c ? ` · ${customers.find((x) => x.id === sp.c)?.name ?? ""}` : ""} · printed {dateShort(today)}
      </p>
      <p className="small muted no-print" style={{ margin: 0 }}>{def.blurb}{rep ? " Your own customers' orders." : ""}</p>

      {range || key === "stopped" ? (
        <div className="row report-controls no-print" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {range ? <RangeFilter base={base} current={range.key} label={range.label} from={range.from} to={range.to} today={today} keep={keep} start={def.range} title="Show" /> : null}
          {key === "stopped"
            ? [60, 90, 180].map((d) => (
                <Link key={d} href={href({ d: String(d) })} className={`chip sm${(Number(sp.d) || 90) === d ? " on" : ""}`}>No order in {d}+ days</Link>
              ))
            : null}
        </div>
      ) : null}
      {def.location && places.length > 1 && !(def.location === "inventory" && inventoryLock(profile) !== null) ? (
        <div className="chips no-print" aria-label="Location">
          <Link href={href({ b: "" })} className={`chip sm${branch ? "" : " on"}`}>All locations</Link>
          {places.map((b) => (
            <Link key={b.id} href={href({ b: b.id })} className={`chip sm${branch === b.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      {key === "price-sheet" ? <CustomerPick base={base} customers={customers} value={sp.c ?? null} /> : null}
      {key === "lot-trace" ? (
        <form action={base} method="get" className="row no-print" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input sm" name="lot" defaultValue={sp.lot ?? ""} placeholder="Lot / batch #, like PA86002861" aria-label="Lot or batch number" style={{ flex: "1 1 220px", maxWidth: 360 }} autoFocus={!sp.lot} />
          <button type="submit" className="btn sm">Trace it</button>
        </form>
      ) : null}

      {out.prompt ? (
        <div className="card small muted">{out.prompt}</div>
      ) : (
        <>
          {out.stats?.length ? (
            <div className="row tiny report-stats" style={{ gap: 6, flexWrap: "wrap" }}>
              {out.stats.map((s, i) => <span key={i} className={`pill${s.tone ? ` ${s.tone}` : ""}`}>{s.t}</span>)}
            </div>
          ) : null}
          {out.rows.length ? (
            <ReportTable
              key={`${key}-${branch ?? "all"}-${range?.from ?? ""}-${range?.to ?? ""}-${sp.c ?? ""}-${sp.lot ?? ""}-${sp.d ?? ""}`}
              head={out.head}
              num={out.num}
              money={money}
              rows={out.rows}
              flag={out.flag ?? out.rows.map(() => false)}
              total={out.total}
              cents={out.cents}
              links={out.links}
              linkCol={out.linkCol}
              fileName={`${key}${branch ? `-${branch}` : ""}${range?.from ? `-${range.from}` : ""}${range?.to ? `-to-${range.to}` : ""}${key === "lot-trace" && sp.lot ? `-${sp.lot}` : ""}.csv`}
            />
          ) : (
            <Empty icon="layers" title="Nothing to show">{range && range.key !== "all" ? `Nothing for ${range.label.toLowerCase()}${branch ? ` at ${placeName}` : ""}. Try a longer date range.` : "Nothing here yet. It fills in as the app is used."}</Empty>
          )}
          {out.note ? <p className="tiny faint" style={{ margin: 0 }}>{out.note}</p> : null}
        </>
      )}
    </main>
  );
}
