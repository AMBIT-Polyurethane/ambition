import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { todayCentral } from "@/lib/sale";
import { TopBar } from "@/components/ui";
import { HubNav } from "@/components/inventory/hub-nav";

export const metadata = { title: "Lot history" };
export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;
const q = (n: number) => String(r2(n));
const sgn = (n: number) => (n > 0 ? `+${q(n)}` : q(n));
const us = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "–");
const REASON: Record<string, string> = { count: "Count difference", damaged: "Damaged", used: "Used here" };

type Ev = { at: string; title: React.ReactNode; detail?: string; qty?: number | null; tone?: "up" | "down" | null };

/** One lot's whole story: orders that took drums, transfers, holds, fixes and changes, and what the spreadsheet said. */
export default async function LotHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) notFound();
  const { supabase, profile } = await requireEmployee();
  if (!(profile.role === "admin" || can(profile, "item_variance") || can(profile, "inventory"))) redirect("/");

  const { data: lot } = await supabase
    .from("inventory_lots")
    .select("id, branch_id, product_id, sku, lot_no, mfg, exp, use_by, starting, shipped_out, shipped_in, adj, out_unsynced, remaining, in_unsynced, adj_unsynced, sheet_pending, on_sheet, notes, products(name, unit)")
    .eq("id", id)
    .maybeSingle();
  if (!lot) notFound();
  type Lot = {
    id: number; branch_id: string; product_id: string; sku: string; lot_no: string; mfg: string | null; exp: string | null; use_by: string | null;
    starting: number; shipped_out: number; shipped_in: number; adj: number; out_unsynced: number; remaining: number; in_unsynced: number;
    adj_unsynced: number; sheet_pending: number; on_sheet: boolean; notes: string | null; products: { name: string; unit: string | null } | null;
  };
  const l = lot as unknown as Lot;
  const lotNo = l.lot_no || "(no lot #)";
  const today = todayCentral();

  const [{ data: branch }, { data: lines }, { data: moves }, { data: holds }, changesRes, logRes] = await Promise.all([
    supabase.from("branches").select("name, state").eq("id", l.branch_id).maybeSingle(),
    supabase
      .from("inventory_lines")
      .select("order_id, qty, state, done_by, updated_at, ord:orders(order_no, company_name, created_at)")
      .eq("lot_id", id)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("inventory_transfer_lines")
      .select("qty, t:inventory_transfers(id, from_branch, to_branch, status, created_at, created_by_name, received_at, received_by_name)")
      .eq("lot_id", id)
      .limit(100),
    supabase.from("inventory_holds").select("qty, until, company_name, by_name, created_at, released_at, released_by_name, note").eq("lot_id", id).limit(100),
    supabase.from("inventory_lot_changes").select("*").or(`from_lot_id.eq.${id},to_lot_id.eq.${id}`).order("created_at", { ascending: false }).limit(100),
    l.lot_no
      ? supabase.from("inventory_log").select("id, at, kind, message, qty_before, qty_after, by_name").eq("branch_id", l.branch_id).ilike("sku", l.sku).ilike("message", `%${l.lot_no.replace(/[%_\\]/g, "")}%`).order("at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);

  const evs: Ev[] = [];
  type Line = { order_id: string; qty: number; state: string; done_by: string | null; updated_at: string; ord: { order_no: number; company_name: string; created_at: string } | null };
  for (const x of (lines ?? []) as unknown as Line[]) {
    const ord = x.ord ? <Link href={`/orders/${x.order_id}`}>ORD-{x.ord.order_no}</Link> : "An order";
    if (x.state === "reserved") evs.push({ at: x.ord?.created_at ?? x.updated_at, title: <>{ord} is waiting for pickup</>, detail: x.ord?.company_name, qty: -Number(x.qty), tone: null });
    else if (x.state === "done") evs.push({ at: x.updated_at, title: <>{ord} picked up / delivered</>, detail: `${x.ord?.company_name ?? ""}${x.done_by === "sheet" ? " · marked on the spreadsheet" : ""}`, qty: -Number(x.qty), tone: "down" });
    else evs.push({ at: x.updated_at, title: <>{ord} cancelled, drums back</>, detail: x.ord?.company_name, qty: null });
  }
  type Move = { qty: number; t: { id: number; from_branch: string; to_branch: string; status: string; created_at: string; created_by_name: string | null; received_at: string | null; received_by_name: string | null } | null };
  for (const m of (moves ?? []) as unknown as Move[]) {
    if (!m.t) continue;
    const out = m.t.from_branch === l.branch_id;
    const link = <Link href={`/inventory/transfers/${m.t.id}`}>Transfer {m.t.id}</Link>;
    evs.push({
      at: out ? m.t.created_at : m.t.received_at ?? m.t.created_at,
      title: <>{link} {out ? `to ${m.t.to_branch.toUpperCase()}` : `from ${m.t.from_branch.toUpperCase()}`}{m.t.status === "in_transit" ? " (on the way)" : m.t.status === "cancelled" ? " (cancelled)" : ""}</>,
      detail: (out ? m.t.created_by_name : m.t.received_by_name) ?? undefined,
      qty: m.t.status === "cancelled" ? null : out ? -Number(m.qty) : Number(m.qty), tone: m.t.status === "cancelled" ? null : out ? "down" : "up",
    });
  }
  type Hold = { qty: number; until: string; company_name: string; by_name: string | null; created_at: string; released_at: string | null; released_by_name: string | null; note: string | null };
  for (const h of (holds ?? []) as Hold[]) {
    evs.push({ at: h.created_at, title: <>Held for {h.company_name} until {us(h.until)}</>, detail: [h.by_name, h.note].filter(Boolean).join(" · "), qty: Number(h.qty), tone: null });
    if (h.released_at) evs.push({ at: h.released_at, title: <>Hold for {h.company_name} let go</>, detail: h.released_by_name ?? undefined, qty: null });
  }
  type Change = { id: number; kind: string; status?: string; reason?: string | null; from_lot_id: number | null; to_lot_id: number | null; from_sku: string | null; to_sku: string | null; qty: number | null;
    old_exp: string | null; new_exp: string | null; old_mfg: string | null; new_mfg: string | null; note: string | null; by_name: string | null; created_at: string; decided_by_name?: string | null };
  for (const c of (changesRes.error ? [] : changesRes.data ?? []) as Change[]) {
    const who = [c.by_name, c.note, c.decided_by_name ? `${c.status === "denied" ? "turned down" : "OK'd"} by ${c.decided_by_name}` : null].filter(Boolean).join(" · ");
    if (c.kind === "adjust") {
      evs.push({ at: c.created_at, title: <>{REASON[c.reason ?? ""] ?? "Fix"} (Adj){c.status === "waiting" ? <span className="pill2 sm warn" style={{ marginLeft: 6 }}>waiting for an admin</span> : c.status === "denied" ? <span className="pill2 sm" style={{ marginLeft: 6 }}>turned down</span> : null}</>, detail: who, qty: c.status === "done" || !c.status ? Number(c.qty) : null, tone: Number(c.qty) > 0 ? "up" : "down" });
    } else if (c.kind === "product") {
      const out = c.from_lot_id === id;
      evs.push({ at: c.created_at, title: out ? <>Changed to <b>{c.to_sku}</b></> : <>Changed from <b>{c.from_sku}</b></>, detail: who, qty: out ? -Number(c.qty) : Number(c.qty), tone: out ? "down" : "up" });
    } else {
      const bits = [c.new_exp && c.new_exp !== c.old_exp ? `expires ${us(c.new_exp)} (was ${c.old_exp ? us(c.old_exp) : "blank"})` : null, c.new_mfg && c.new_mfg !== c.old_mfg ? `made ${us(c.new_mfg)} (was ${c.old_mfg ? us(c.old_mfg) : "blank"})` : null].filter(Boolean).join(", ");
      evs.push({ at: c.created_at, title: <>Dates fixed: {bits}</>, detail: who, qty: null });
    }
  }
  // What the app wrote down that isn't one of the above (received, counts approved, the spreadsheet's own changes).
  type Log = { id: number; at: string; kind: string; message: string; qty_before: number | null; qty_after: number | null; by_name: string | null };
  for (const g of ((logRes as { data: Log[] | null }).data ?? []) as Log[]) {
    if (g.kind === "order" || /^ORD-\d+ /.test(g.message)) continue;
    if (g.kind === "adjust" && /\(Adj on FOAM LOTS\)|onto Adj on FOAM LOTS/.test(g.message)) continue;
    if (/^Lot .*(moved to|changed to|dates)/i.test(g.message) && changesRes.data?.length) continue;
    const d = g.qty_before != null && g.qty_after != null ? Number(g.qty_after) - Number(g.qty_before) : null;
    evs.push({ at: g.at, title: g.message, detail: g.by_name ?? undefined, qty: d, tone: d == null ? null : d > 0 ? "up" : "down" });
  }
  evs.sort((a, z) => z.at.localeCompare(a.at));

  const left = r2(Number(l.remaining) + Number(l.in_unsynced) + Number(l.adj_unsynced));
  const reserved = ((lines ?? []) as unknown as Line[]).filter((x) => x.state === "reserved").reduce((s, x) => s + Number(x.qty), 0);
  const held = ((holds ?? []) as Hold[]).filter((h) => !h.released_at && h.until >= today).reduce((s, h) => s + Number(h.qty), 0);
  const promised = r2(Number(l.sheet_pending) + reserved);
  const free = Math.max(0, r2(left - promised - held));
  const useBy = l.use_by ?? l.exp;
  const where = branch ? `${(branch as { name: string }).name}, ${(branch as { state: string }).state}` : l.branch_id.toUpperCase();

  return (
    <main className="shell wide">
      <TopBar title={`Lot ${lotNo}`} back={`/inventory/lots?b=${l.branch_id}`} />
      <HubNav profile={profile} active="lots" branch={l.branch_id} />
      <section className="card2" aria-label="This lot">
        <div className="card2-h">
          <span className="col tight" style={{ minWidth: 0 }}>
            <b>{l.products?.name ?? l.sku}</b>
            <span className="small faint">{l.sku} · lot {lotNo} · {where}</span>
          </span>
          <span className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className={useBy && useBy < today ? "pill2 sm err" : "pill2 sm"}>Expires {us(l.exp)}</span>
            {l.mfg ? <span className="pill2 sm">Made {us(l.mfg)}</span> : null}
            {l.on_sheet ? <Link className="b2 quiet sm" href={`/inventory/lots?b=${l.branch_id}&lot=${l.id}`}>Change this lot</Link> : null}
          </span>
        </div>
        <div className="card2-b col" style={{ gap: 10 }}>
          <div className="lothist-nums">
            <div><b>{q(l.starting)}</b><span>Starting</span></div>
            <div><b>{q(Number(l.shipped_out) + Number(l.out_unsynced))}</b><span>Shipped out</span></div>
            <div><b>{q(Number(l.shipped_in) + Number(l.in_unsynced))}</b><span>Shipped in</span></div>
            <div><b>{sgn(Number(l.adj) + Number(l.adj_unsynced))}</b><span>Adj</span></div>
            <div><b>{q(left)}</b><span>Remaining</span></div>
            <div><b>{q(promised)}</b><span>Pending pickup</span></div>
            <div><b>{q(free)}</b><span>Available{held ? ` (${q(held)} held)` : ""}</span></div>
          </div>
          {Number(l.out_unsynced) || Number(l.in_unsynced) || Number(l.adj_unsynced) ? (
            <span className="tiny faint">Some of this is still being written to the old spreadsheet (within 2 minutes).</span>
          ) : null}
          {l.notes ? <span className="small muted">Notes: {l.notes}</span> : null}
        </div>
      </section>
      <section className="card2" aria-label="History">
        <div className="card2-h"><b>History</b><span className="small faint">newest first</span></div>
        {evs.length ? (
          <ul className="lothist">
            {evs.map((e, i) => (
              <li key={i}>
                <span className="t tiny faint">{new Date(e.at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <span className="col tight" style={{ minWidth: 0 }}>
                  <span className="small">{e.title}</span>
                  {e.detail ? <span className="tiny faint">{e.detail}</span> : null}
                </span>
                <span className={`q small${e.tone ? ` ${e.tone}` : ""}`}>{e.qty == null || e.qty === 0 ? "" : sgn(e.qty)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: 0, padding: "14px 18px" }}>
            Nothing has happened to this lot in the app yet. It started with {q(l.starting)}.
          </p>
        )}
        <p className="tiny faint" style={{ margin: 0, padding: "10px 18px 14px" }}>Starting quantity {q(l.starting)} is what FOAM LOTS says the lot came in with.</p>
      </section>
    </main>
  );
}
