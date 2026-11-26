import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can, hubAllows, hubLock } from "@/lib/access";
import { todayCentral } from "@/lib/sale";
import { TopBar, Empty } from "@/components/ui";
import { HubNav } from "@/components/inventory/hub-nav";
import { inventorySheets } from "@/lib/inventory/view";
import { GROUPS, groupOf } from "@/lib/inventory/lots";
import { LotLedger, type LedgerLot, type LedgerProduct, type WaitingFix } from "@/components/inventory/lot-ledger";

export const metadata = { title: "Foam lots" };
export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;
const REASON: Record<string, string> = { count: "count", damaged: "damaged", used: "used here" };

type Change = {
  id: number; kind: "product" | "dates" | "adjust"; status?: string; reason?: string | null; lot_no: string | null; from_lot_id: number | null;
  from_sku: string | null; to_sku: string | null; qty: number | null; old_exp: string | null; new_exp: string | null; old_mfg: string | null; new_mfg: string | null;
  note: string | null; by_name: string | null; created_at: string; decided_by_name?: string | null; decide_note?: string | null;
};

/**
 * Inventory > Foam lots (0115, 0116): the location's FOAM LOTS tab in the app. Fix a count, change drums to another
 * product, fix dates; every change goes onto the spreadsheet within 2 minutes and is kept with who and why.
 */
export default async function FoamLotsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const admin = profile.role === "admin" || can(profile, "item_variance");
  if (!(admin || can(profile, "inventory"))) redirect("/");
  const [sheets, { data: branchRows }] = await Promise.all([inventorySheets(supabase), supabase.from("branches").select("id, name, state").order("sort")]);
  const lock = hubLock(profile);
  const live = sheets.filter((s) => s.enabled).sort((a, b) => (a.branch_id === profile.branch_id ? -1 : b.branch_id === profile.branch_id ? 1 : 0));
  const branchName = (id: string) => {
    const b = ((branchRows ?? []) as { id: string; name: string; state: string }[]).find((x) => x.id === id);
    return b ? `${b.name}, ${b.state}` : id.toUpperCase();
  };
  if (!live.length) {
    return (
      <main className="shell">
        <TopBar title="Foam lots" back="/inventory" />
        <Empty icon="boxes" title="No location has live inventory yet" />
      </main>
    );
  }
  const want = sp.b ?? lock ?? profile.branch_id ?? null;
  const branch = (live.find((s) => s.branch_id === want) ?? live[0]).branch_id;
  const today = todayCentral();
  const soonDay = new Date(Date.parse(`${today}T12:00:00Z`) + 60 * 864e5).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const [{ data: lotRows }, { data: lineRows }, { data: holdRows }, { data: invRows }, { data: lotProds }, changesRes, waitRes, weekRes] = await Promise.all([
    supabase
      .from("inventory_lots")
      .select("id, product_id, sku, lot_no, mfg, exp, use_by, starting, shipped_out, shipped_in, adj, out_unsynced, remaining, in_unsynced, adj_unsynced, sheet_pending, sort, on_sheet, products(name, unit)")
      .eq("branch_id", branch)
      .or("on_sheet.eq.true,add_to_sheet.eq.true")
      .range(0, 4999),
    supabase.from("inventory_lines").select("lot_id, qty").eq("branch_id", branch).eq("state", "reserved").not("lot_id", "is", null).range(0, 9999),
    supabase.from("inventory_holds").select("lot_id, qty, until").eq("branch_id", branch).is("released_at", null).gte("until", today),
    supabase.from("inventory").select("product_id").eq("branch_id", branch).eq("on_sheet", true).range(0, 4999),
    supabase.from("inventory_lots").select("product_id").range(0, 9999),
    supabase.from("inventory_lot_changes").select("*").eq("branch_id", branch).order("created_at", { ascending: false }).limit(30),
    supabase.from("inventory_lot_changes").select("id, lot_no, from_sku, qty, reason, note, by_name, created_at").eq("branch_id", branch).eq("status", "waiting").order("created_at"),
    supabase.from("inventory_lot_changes").select("id", { count: "exact", head: true }).eq("branch_id", branch).gte("created_at", weekAgo),
  ]);
  const needs0115 = Boolean(changesRes.error);
  const needs0116 = !needs0115 && Boolean(waitRes.error);

  const promisedBy = new Map<number, number>();
  const heldBy = new Map<number, number>();
  for (const l of (lineRows ?? []) as { lot_id: number; qty: number }[]) promisedBy.set(l.lot_id, (promisedBy.get(l.lot_id) ?? 0) + Number(l.qty));
  for (const h of (holdRows ?? []) as { lot_id: number; qty: number }[]) heldBy.set(h.lot_id, (heldBy.get(h.lot_id) ?? 0) + Number(h.qty));
  type Row = {
    id: number; product_id: string; sku: string; lot_no: string | null; mfg: string | null; exp: string | null; use_by: string | null;
    starting: number; shipped_out: number; shipped_in: number; adj: number; out_unsynced: number;
    remaining: number; in_unsynced: number; adj_unsynced: number; sheet_pending: number; sort: number; on_sheet: boolean;
    products: { name: string; unit: string | null } | null;
  };
  const rows = (lotRows ?? []) as unknown as Row[];
  // Same order as FOAM LOTS: the groups, each product where it first shows up, then the rows.
  const firstOf = new Map<string, number>();
  for (const l of rows) firstOf.set(l.product_id, Math.min(firstOf.get(l.product_id) ?? Infinity, l.sort));
  const gi = (sku: string) => GROUPS.indexOf(groupOf(sku));
  const lots: LedgerLot[] = rows
    .sort((a, z) => gi(a.sku) - gi(z.sku) || firstOf.get(a.product_id)! - firstOf.get(z.product_id)! || a.product_id.localeCompare(z.product_id) || a.sort - z.sort || a.id - z.id)
    .map((l) => {
      const left = r2(Number(l.remaining) + Number(l.in_unsynced) + Number(l.adj_unsynced));
      const promised = r2(Number(l.sheet_pending) + (promisedBy.get(l.id) ?? 0));
      const held = r2(heldBy.get(l.id) ?? 0);
      const g = groupOf(l.sku);
      const useBy = l.use_by ?? l.exp;
      return {
        id: l.id, product_id: l.product_id, sku: l.sku, name: l.products?.name ?? l.sku, unit: l.products?.unit ?? null,
        lot_no: l.lot_no || null, mfg: l.mfg, exp: l.exp,
        expired: Boolean(useBy && useBy < today), soon: Boolean(useBy && useBy >= today && useBy <= soonDay),
        starting: r2(Number(l.starting)), out: r2(Number(l.shipped_out) + Number(l.out_unsynced)), inn: r2(Number(l.shipped_in) + Number(l.in_unsynced)),
        adj: r2(Number(l.adj) + Number(l.adj_unsynced)), sending: r2(Number(l.adj_unsynced)),
        left, promised, held, free: l.on_sheet ? Math.max(0, r2(left - promised - held)) : 0,
        group: g.band.replace(/\s{2,}/g, " "), band: g.fill, bandText: g.font, adding: !l.on_sheet,
      };
    });

  // Products drums can move to: counted by lot (somewhere) and on this location's COUNT SHEET.
  const onSheet = new Set(((invRows ?? []) as { product_id: string }[]).map((r) => r.product_id));
  const lotted = new Set(((lotProds ?? []) as { product_id: string }[]).map((r) => r.product_id));
  const ids = [...onSheet].filter((id) => lotted.has(id));
  const { data: prodRows } = ids.length
    ? await supabase.from("products").select("id, sku, name, unit, active, stock_of").in("id", ids).order("sku")
    : { data: [] };
  const products = ((prodRows ?? []) as (LedgerProduct & { active: boolean; stock_of: string | null })[]).filter((p) => p.active || p.stock_of);
  const changes = (needs0115 ? [] : changesRes.data ?? []) as Change[];
  const waiting = (waitRes.error ? [] : waitRes.data ?? []) as WaitingFix[];

  // Same rules as the database: admins / Item variance fix any amount; inventory people up to 2 drums (a
  // warehouse manager only at their own location); changing products and dates stays with admins.
  const here = hubAllows(profile, branch);
  const fixLevel = needs0115 || needs0116 ? null : admin ? "full" : can(profile, "inventory") && here ? "limited" : null;
  const canChange = admin && here && !needs0115;

  return (
    <main className="shell wide">
      <TopBar title="Foam lots" back={`/inventory?b=${branch}`} />
      <HubNav profile={profile} active="lots" branch={branch} />
      {live.length > 1 ? (
        <div className="chips" role="tablist" aria-label="Location">
          {live.map((s) => (
            <Link key={s.branch_id} href={`/inventory/lots?b=${s.branch_id}`} className={`chip${s.branch_id === branch ? " on" : ""}`}>
              {branchName(s.branch_id)}{lock && s.branch_id === lock ? " (yours)" : ""}
            </Link>
          ))}
        </div>
      ) : null}
      {needs0115 || needs0116 ? (
        <div className="alert warn small" role="note"><span>Foam lots needs database update {needs0115 ? "0115 and 0116" : "0116"} first (Supabase › SQL Editor). Until then it&apos;s look only.</span></div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        Every lot at {branchName(branch)}. Fix a count, write off a damaged drum, change drums to another product, or fix a date right here; every change
        is kept with who and why. <a href={`/inventory/lots/export?b=${branch}`}>Download as Excel</a>
      </p>
      {fixLevel === "limited" ? <p className="tiny faint" style={{ margin: 0 }}>You fix up to 2 drums at a time. More than that goes to an admin to OK, and they get an email.</p> : null}
      {!fixLevel && !needs0115 && !needs0116 ? <p className="tiny faint" style={{ margin: 0 }}>Look only{lock && lock !== branch ? `: lots at ${branchName(branch)} are fixed by that location` : ""}.</p> : null}
      {lots.length ? (
        <LotLedger
          branchName={branchName(branch)} lots={lots} products={products} fixLevel={fixLevel} canChange={canChange}
          canDecide={admin && !needs0116} waiting={waiting} changesWeek={weekRes.count ?? 0} pick={Number(sp.lot) || null}
        />
      ) : (
        <p className="small muted" style={{ margin: 0 }}>No foam lots at this location yet.</p>
      )}
      <section className="card col" style={{ gap: 6 }} aria-label="Changes made">
        <b>Changes made · {branchName(branch)}</b>
        {changes.length ? (
          <ul className="lotchg-log">
            {changes.map((c) => (
              <li key={c.id}>
                <span className="small">
                  {c.kind === "product" ? (
                    <><b>{String(Number(c.qty))}</b> of lot <LotLink c={c} branch={branch} />: {c.from_sku} → <b>{c.to_sku}</b></>
                  ) : c.kind === "adjust" ? (
                    <><b>{Number(c.qty) > 0 ? "+" : ""}{String(Number(c.qty))}</b> on lot <LotLink c={c} branch={branch} /> ({c.from_sku}, {REASON[c.reason ?? ""] ?? "fix"})
                      {c.status === "waiting" ? <span className="pill2 sm warn" style={{ marginLeft: 6 }}>waiting for an admin</span> : c.status === "denied" ? <span className="pill2 sm" style={{ marginLeft: 6 }}>turned down</span> : null}</>
                  ) : (
                    <>Lot <LotLink c={c} branch={branch} /> ({c.from_sku}): {c.new_exp && c.new_exp !== c.old_exp ? <>expires <b>{usDate(c.new_exp)}</b> (was {c.old_exp ? usDate(c.old_exp) : "blank"})</> : null}{c.new_mfg && c.new_mfg !== c.old_mfg ? <> made <b>{usDate(c.new_mfg)}</b> (was {c.old_mfg ? usDate(c.old_mfg) : "blank"})</> : null}</>
                  )}
                </span>
                <span className="tiny faint">
                  {c.by_name ?? "AMBIT"} · {when(c.created_at)}{c.note ? ` · ${c.note}` : ""}
                  {c.decided_by_name ? ` · ${c.status === "denied" ? "turned down" : "OK'd"} by ${c.decided_by_name}${c.decide_note ? ` (${c.decide_note})` : ""}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>No lot changes here yet.</p>
        )}
      </section>
    </main>
  );
}

function LotLink({ c, branch }: { c: Change; branch: string }) {
  const label = <b>{c.lot_no || "(no lot #)"}</b>;
  return c.from_lot_id ? <Link href={`/inventory/lots/${c.from_lot_id}?b=${branch}`}>{label}</Link> : label;
}
function usDate(iso: string) {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
}
function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
