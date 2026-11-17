import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can, hubAllows, hubLock } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { HubNav } from "@/components/inventory/hub-nav";
import { HoldForm, type HoldCustomer, type HoldLot } from "@/components/inventory/hold-form";
import { inventorySheets } from "@/lib/inventory/view";
import { canHold, holdsAt } from "@/lib/inventory/holds";
import { extendHold, releaseHold } from "../hold-actions";

export const metadata = { title: "Holds" };
export const dynamic = "force-dynamic";

const q2 = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** Drums of a lot set aside for one customer (0071): place a hold, see what's held, change the date or release it. */
export default async function HoldsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!(can(profile, "inventory") || can(profile, "order_desk"))) redirect("/");
  const canPlace = canHold(profile);
  const [sheets, { data: branchRows }, picked] = await Promise.all([
    inventorySheets(supabase),
    supabase.from("branches").select("id, name, state").order("sort"),
    sp.c ? supabase.from("companies").select("default_branch_id").eq("id", sp.c).maybeSingle<{ default_branch_id: string | null }>() : Promise.resolve({ data: null }),
  ]);
  // Warehouse managers can look at every location's holds; they only hold or release at their own.
  const lock = hubLock(profile);
  const live = sheets
    .filter((s) => s.enabled)
    .sort((a, b) => (a.branch_id === profile.branch_id ? -1 : b.branch_id === profile.branch_id ? 1 : 0));
  const branchName = (id: string) => {
    const b = ((branchRows ?? []) as { id: string; name: string; state: string }[]).find((x) => x.id === id);
    return b ? `${b.name}, ${b.state}` : id.toUpperCase();
  };
  if (!live.length) {
    return (
      <main className="shell">
        <TopBar title="Holds" back="/inventory" />
        <Empty icon="boxes" title="No inventory spreadsheet is connected yet">Holds are for lots on a location&apos;s FOAM LOTS tab.</Empty>
      </main>
    );
  }
  const want = sp.b ?? (lock ? null : picked.data?.default_branch_id) ?? profile.branch_id ?? null;
  const branch = (live.find((s) => s.branch_id === want) ?? live[0]).branch_id;
  const mine = hubAllows(profile, branch);
  const holder = canPlace && mine;
  const today = todayCentral();

  const [holds, { data: lotRows }, { data: lineRows }, custRes, { data: endedRows }] = await Promise.all([
    holdsAt(supabase, branch),
    supabase.from("inventory_lots").select("id, sku, lot_no, use_by, remaining, sheet_pending, sort, products(name, pick_rank)").eq("branch_id", branch).eq("on_sheet", true).range(0, 4999),
    supabase.from("inventory_lines").select("lot_id, qty").eq("branch_id", branch).eq("state", "reserved").not("lot_id", "is", null).range(0, 9999),
    holder ? supabase.from("companies").select("id, name, account_no, city, state").eq("active", true).order("name").limit(5000) : Promise.resolve({ data: [] }),
    supabase
      .from("inventory_holds")
      .select("id, company_id, company_name, qty, until, released_at, released_by_name, release_note, inventory_lots(sku, lot_no)")
      .eq("branch_id", branch)
      .or(`released_at.not.is.null,until.lt.${today}`)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  // What's free on each lot: left on FOAM LOTS, less what's on orders and what's already held.
  const reserved = new Map<number, number>();
  for (const l of (lineRows ?? []) as { lot_id: number; qty: number }[]) reserved.set(l.lot_id, (reserved.get(l.lot_id) ?? 0) + Number(l.qty));
  const heldOn = new Map<number, number>();
  for (const h of holds) heldOn.set(h.lot_id, (heldOn.get(h.lot_id) ?? 0) + h.held_left);
  type LotRow = { id: number; sku: string; lot_no: string; use_by: string | null; remaining: number; sheet_pending: number; sort: number; products: { name: string; pick_rank: number } | null };
  const lots: HoldLot[] = ((lotRows ?? []) as unknown as LotRow[])
    .sort((a, z) => a.sort - z.sort || a.id - z.id)
    .map((l) => ({
      id: l.id,
      sku: l.sku,
      name: l.products?.name ?? l.sku,
      lot_no: l.lot_no || null,
      use_by: l.use_by,
      free: Math.max(0, Math.round((Number(l.remaining) - Number(l.sheet_pending) - (reserved.get(l.id) ?? 0) - (heldOn.get(l.id) ?? 0)) * 100) / 100),
      expired: Boolean(l.use_by && l.use_by < today),
    }));
  const customers = ((custRes.data ?? []) as HoldCustomer[]);
  type Ended = { id: number; company_id: string; company_name: string; qty: number; until: string; released_at: string | null; released_by_name: string | null; release_note: string | null; inventory_lots: { sku: string; lot_no: string } | null };
  const ended = (endedRows ?? []) as unknown as Ended[];
  const lotParam = Number(sp.lot) || null;

  return (
    <main className="shell wide">
      <TopBar title="Holds" back={`/inventory?b=${branch}`} />
      <HubNav profile={profile} active="holds" branch={branch} />
      {live.length > 1 ? (
        <div className="chips" role="tablist" aria-label="Location">
          {live.map((s) => (
            <Link key={s.branch_id} href={`/inventory/holds?b=${s.branch_id}`} className={`chip${s.branch_id === branch ? " on" : ""}`}>{branchName(s.branch_id)}{lock && s.branch_id === lock ? " (yours)" : ""}</Link>
          ))}
        </div>
      ) : null}
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <p className="small muted" style={{ margin: 0 }}>
        Set drums aside for one customer. Nobody else&apos;s orders get them, other customers see less available, and that customer&apos;s orders
        (and their locations&apos;) take them first. A hold ends when their orders have used it, when it&apos;s released, or on its date. Whoever
        placed it gets an email 3 days before.
      </p>

      {holder ? (
        <section className="card col" style={{ gap: 10 }}>
          <b>Hold material for a customer · {branchName(branch)}</b>
          {lots.length ? (
            <HoldForm branch={branch} lots={lots} customers={customers} lot={lotParam} company={sp.c ?? null} until={addDays(today, 30)} min={today} max={addDays(today, 180)} />
          ) : (
            <p className="small muted" style={{ margin: 0 }}>No lots on this location&apos;s FOAM LOTS tab.</p>
          )}
        </section>
      ) : canPlace && !mine ? (
        <p className="tiny faint" style={{ margin: 0 }}>Look only: holds at {branchName(branch)} are placed and released by that location.</p>
      ) : (
        <p className="tiny faint" style={{ margin: 0 }}>Admins and the order desk place and release holds.</p>
      )}

      <section className="card col" style={{ gap: 6 }}>
        <b>Held now · {branchName(branch)}</b>
        {holds.length ? (
          <div className="hold-list">
            {holds.map((h) => {
              const left = daysBetween(today, h.until);
              const used = Math.max(0, Math.round((h.qty - h.held_left) * 100) / 100);
              return (
                <div key={h.id} className="hold-item">
                  <div className="col tight" style={{ minWidth: 0 }}>
                    <span>
                      <b>{q2(h.held_left)}</b> {h.held_left === 1 ? "drum" : "drums"} of <b>{h.sku}</b> · Lot {h.lot_no || "(no lot #)"} for{" "}
                      <Link href={`/customers/${h.company_id}`}><b>{h.company_name}</b></Link>
                    </span>
                    <span className="tiny faint">
                      <span className={left <= 3 ? "hold-soon" : ""}>Until {dateShort(h.until)} ({left === 0 ? "ends today" : left === 1 ? "1 day left" : `${left} days left`})</span>
                      {used ? ` · ${q2(used)} of the ${q2(h.qty)} already on their orders` : ""}
                      {` · by ${h.by_name ?? "AMBIT"} ${dateShort(h.created_at)}`}
                      {h.note ? ` · ${h.note}` : ""}
                      {h.held_left > h.lot_remaining ? ` · only ${q2(h.lot_remaining)} left on the lot` : ""}
                    </span>
                  </div>
                  {holder ? (
                    <div className="hold-acts">
                      <form action={extendHold}>
                        <input type="hidden" name="branch" value={branch} />
                        <input type="hidden" name="id" value={h.id} />
                        <input className="input sm" type="date" name="until" defaultValue={h.until} min={today} max={addDays(today, 180)} aria-label="New date" required />
                        <Submit className="btn sm ghost" pendingText="Saving…">Change date</Submit>
                      </form>
                      <form action={releaseHold}>
                        <input type="hidden" name="branch" value={branch} />
                        <input type="hidden" name="id" value={h.id} />
                        <input className="input sm" name="note" maxLength={300} placeholder="Why (optional)" aria-label="Why it's released" />
                        <Submit className="btn sm dark" pendingText="Releasing…">Release</Submit>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Nothing is held here.</p>
        )}
      </section>

      {ended.length ? (
        <section className="card col" style={{ gap: 4 }}>
          <b className="small">Ended lately</b>
          {ended.map((h) => (
            <span key={h.id} className="tiny faint">
              {q2(Number(h.qty))} of {h.inventory_lots?.sku ?? ""} · Lot {h.inventory_lots?.lot_no || "(no lot #)"} for {h.company_name} ·{" "}
              {h.released_at ? `released by ${h.released_by_name ?? "AMBIT"} ${dateShort(h.released_at)}${h.release_note ? ` (${h.release_note})` : ""}` : `ran out ${dateShort(h.until)}`}
            </span>
          ))}
        </section>
      ) : null}
    </main>
  );
}
