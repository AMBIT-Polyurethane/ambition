import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can, hubAllows, hubLock } from "@/lib/access";
import { todayCentral } from "@/lib/sale";
import { TopBar, Empty } from "@/components/ui";
import { HubNav } from "@/components/inventory/hub-nav";
import { inventorySheets } from "@/lib/inventory/view";
import { LotChanger, type ChangeLot, type ChangeProduct, type LotChange } from "@/components/inventory/lot-changer";

export const metadata = { title: "Change lots" };
export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Inventory > Change lots (0115): move drums of a lot to another product, or fix a lot's dates, without the spreadsheet. */
export default async function ChangeLotsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const changer = profile.role === "admin" || can(profile, "item_variance");
  if (!(changer || can(profile, "inventory"))) redirect("/");
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
        <TopBar title="Change lots" back="/inventory" />
        <Empty icon="boxes" title="No inventory spreadsheet is connected yet">Lots come from a location&apos;s FOAM LOTS tab.</Empty>
      </main>
    );
  }
  const want = sp.b ?? profile.branch_id ?? null;
  const branch = (live.find((s) => s.branch_id === want) ?? live[0]).branch_id;
  const mine = changer && hubAllows(profile, branch);
  const today = todayCentral();

  const [{ data: lotRows }, { data: lineRows }, { data: holdRows }, { data: invRows }, { data: lotProds }, changesRes] = await Promise.all([
    supabase
      .from("inventory_lots")
      .select("id, product_id, sku, lot_no, mfg, exp, use_by, remaining, in_unsynced, adj_unsynced, sheet_pending, sort, on_sheet, products(name, unit, pick_rank)")
      .eq("branch_id", branch)
      .or("on_sheet.eq.true,add_to_sheet.eq.true")
      .range(0, 4999),
    supabase.from("inventory_lines").select("lot_id, qty").eq("branch_id", branch).eq("state", "reserved").not("lot_id", "is", null).range(0, 9999),
    supabase.from("inventory_holds").select("lot_id, qty, until").eq("branch_id", branch).is("released_at", null).gte("until", today),
    supabase.from("inventory").select("product_id").eq("branch_id", branch).eq("on_sheet", true).range(0, 4999),
    supabase.from("inventory_lots").select("product_id").range(0, 9999),
    supabase
      .from("inventory_lot_changes")
      .select("id, kind, lot_no, from_sku, to_sku, qty, old_exp, new_exp, old_mfg, new_mfg, note, by_name, created_at")
      .eq("branch_id", branch)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const reserved = new Map<number, number>();
  for (const l of (lineRows ?? []) as { lot_id: number; qty: number }[]) reserved.set(l.lot_id, (reserved.get(l.lot_id) ?? 0) + Number(l.qty));
  for (const h of (holdRows ?? []) as { lot_id: number; qty: number }[]) reserved.set(h.lot_id, (reserved.get(h.lot_id) ?? 0) + Number(h.qty));
  type Row = {
    id: number; product_id: string; sku: string; lot_no: string | null; mfg: string | null; exp: string | null; use_by: string | null;
    remaining: number; in_unsynced: number; adj_unsynced: number; sheet_pending: number; sort: number; on_sheet: boolean;
    products: { name: string; unit: string | null; pick_rank: number } | null;
  };
  const lots: ChangeLot[] = ((lotRows ?? []) as unknown as Row[])
    .sort((a, z) => a.sort - z.sort || a.id - z.id)
    .map((l) => {
      const left = r2(Number(l.remaining) + Number(l.in_unsynced) + Number(l.adj_unsynced));
      const busy = r2(Number(l.sheet_pending) + (reserved.get(l.id) ?? 0));
      return {
        id: l.id, product_id: l.product_id, sku: l.sku, name: l.products?.name ?? l.sku, unit: l.products?.unit ?? null,
        lot_no: l.lot_no || null, mfg: l.mfg, exp: l.exp, expired: Boolean(l.use_by && l.use_by < today),
        left, busy, free: l.on_sheet ? Math.max(0, r2(left - busy)) : 0, adding: !l.on_sheet,
      };
    });

  // Products drums can move to: counted by lot (somewhere) and on this location's COUNT SHEET.
  const onSheet = new Set(((invRows ?? []) as { product_id: string }[]).map((r) => r.product_id));
  const lotted = new Set(((lotProds ?? []) as { product_id: string }[]).map((r) => r.product_id));
  const ids = [...onSheet].filter((id) => lotted.has(id));
  const { data: prodRows } = ids.length
    ? await supabase.from("products").select("id, sku, name, unit, active, stock_of").in("id", ids).order("sku")
    : { data: [] };
  // Sellable products, or a brand's stock item (Covestro ISO … are stock of ISO).
  const products = ((prodRows ?? []) as (ChangeProduct & { active: boolean; stock_of: string | null })[]).filter((p) => p.active || p.stock_of);
  const changes = (changesRes.error ? [] : changesRes.data ?? []) as LotChange[];
  const needs0115 = Boolean(changesRes.error);

  return (
    <main className="shell wide">
      <TopBar title="Change lots" back={`/inventory?b=${branch}`} />
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
      {needs0115 ? <div className="alert warn small" role="note"><span>Change lots needs database update 0115 first (Supabase › SQL Editor).</span></div> : null}
      <p className="small muted" style={{ margin: 0 }}>
        Move drums to another product (for example Covestro ISO sold as Alpha AP ISO), or fix a lot&apos;s expiration date, right here. The app
        changes the FOAM LOTS tab for you within 2 minutes, and every change is kept below.
      </p>
      {!changer ? <p className="tiny faint" style={{ margin: 0 }}>Look only: admins (and people with the Item variance box) change lots.</p> : null}
      {changer && !mine ? <p className="tiny faint" style={{ margin: 0 }}>Look only: lots at {branchName(branch)} are changed by that location.</p> : null}
      {lots.length ? (
        <LotChanger branchName={branchName(branch)} lots={lots} products={products} canChange={mine && !needs0115} pick={Number(sp.lot) || null} />
      ) : (
        <p className="small muted" style={{ margin: 0 }}>No lots on this location&apos;s FOAM LOTS tab.</p>
      )}
      <section className="card col" style={{ gap: 6 }} aria-label="Changes made">
        <b>Changes made · {branchName(branch)}</b>
        {changes.length ? (
          <ul className="lotchg-log">
            {changes.map((c) => (
              <li key={c.id}>
                <span className="small">
                  {c.kind === "product" ? (
                    <><b>{String(Number(c.qty))}</b> of lot <b>{c.lot_no || "(no lot #)"}</b>: {c.from_sku} → <b>{c.to_sku}</b></>
                  ) : (
                    <>Lot <b>{c.lot_no || "(no lot #)"}</b> ({c.from_sku}): {c.new_exp && c.new_exp !== c.old_exp ? <>expires <b>{usDate(c.new_exp)}</b> (was {c.old_exp ? usDate(c.old_exp) : "blank"})</> : null}{c.new_mfg && c.new_mfg !== c.old_mfg ? <> made <b>{usDate(c.new_mfg)}</b> (was {c.old_mfg ? usDate(c.old_mfg) : "blank"})</> : null}</>
                  )}
                </span>
                <span className="tiny faint">{c.by_name ?? "AMBIT"} · {new Date(c.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{c.note ? ` · ${c.note}` : ""}</span>
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

function usDate(iso: string) {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
}
