import Link from "next/link";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { HubNav } from "@/components/inventory/hub-nav";
import { dateTime } from "@/lib/format";
import { purchasingContact, reorderRef } from "@/lib/inventory/reorder";
import { savePurchasingContact } from "../reorder-actions";

export const metadata = { title: "Reorder requests" };
export const dynamic = "force-dynamic";

type Req = { id: number; branch_id: string; requested_by_name: string | null; note: string | null; status: "open" | "ordered" | "cancelled"; handled_by_name: string | null; handled_at: string | null; handled_note: string | null; email_status: string | null; created_at: string };

const TABS = [
  { key: "open", label: "Waiting on purchasing" },
  { key: "ordered", label: "Ordered" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export default async function ReordersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const status = TABS.some((t) => t.key === sp.s) ? (sp.s as Req["status"]) : "open";
  let q = supabase.from("reorder_requests").select("id, branch_id, requested_by_name, note, status, handled_by_name, handled_at, handled_note, email_status, created_at").eq("status", status).order("created_at", { ascending: false }).limit(200);
  if (sp.b) q = q.eq("branch_id", sp.b);
  const [{ data, error }, { data: branches }, buyer, counts] = await Promise.all([
    q,
    supabase.from("branches").select("id, name, state").order("sort"),
    purchasingContact(supabase),
    supabase.from("reorder_requests").select("status, branch_id").eq("status", "open").limit(2000),
  ]);
  const ready = !error || !/reorder_requests|schema cache|does not exist/i.test(error.message);
  const reqs = (data ?? []) as Req[];
  const ids = reqs.map((r) => r.id);
  const { data: lineRows } = ids.length
    ? await supabase.from("reorder_request_lines").select("request_id, name, qty, unit").in("request_id", ids).order("id")
    : { data: [] };
  const lines = new Map<number, { name: string; qty: number; unit: string | null }[]>();
  for (const l of (lineRows ?? []) as { request_id: number; name: string; qty: number; unit: string | null }[]) {
    if (!lines.has(l.request_id)) lines.set(l.request_id, []);
    lines.get(l.request_id)!.push(l);
  }
  const bName = (id: string) => {
    const b = ((branches ?? []) as { id: string; name: string; state: string }[]).find((x) => x.id === id);
    return b ? `${b.name}, ${b.state}` : id.toUpperCase();
  };
  const openCount = ((counts.data ?? []) as { branch_id: string }[]).filter((r) => !sp.b || r.branch_id === sp.b).length;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ b: sp.b, s: status, ...o })) if (v) p.set(k, v);
    return `/inventory/reorders?${p.toString()}`;
  };
  const n = (v: number) => (Number.isInteger(Number(v)) ? String(Number(v)) : String(Math.round(Number(v) * 100) / 100));

  return (
    <main className="shell wide">
      <TopBar title="Reorder requests" back={`/inventory/stock${sp.b ? `?b=${sp.b}` : ""}`} howTo="reorder-points" />
      <HubNav profile={profile} active="reorders" branch={sp.b} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <p className="small muted" style={{ margin: "0 0 4px" }}>
        Admins and CRMs send these from the Stock screen (Reorder → check items → how many). They go to <b>{buyer.name}</b> ({buyer.email}), who marks
        each one Ordered once it&apos;s bought.
      </p>

      {!ready ? (
        <Empty icon="boxes" title="Reorder requests need the 0064 database update">Ask Jeremiah to run it.</Empty>
      ) : (
        <>
          <div className="chips" role="tablist" aria-label="Location">
            <Link className={`chip sm${!sp.b ? " on2" : ""}`} href={qs({ b: undefined })}>Every location</Link>
            {((branches ?? []) as { id: string; name: string }[]).map((b) => (
              <Link key={b.id} className={`chip sm${sp.b === b.id ? " on2" : ""}`} href={qs({ b: b.id })}>{b.name}</Link>
            ))}
          </div>
          <div className="chips" role="tablist" aria-label="Status">
            {TABS.map((t) => (
              <Link key={t.key} className={`chip${status === t.key ? " on" : ""}`} href={qs({ s: t.key })}>
                {t.label}{t.key === "open" && openCount ? ` · ${openCount}` : ""}
              </Link>
            ))}
          </div>
          {reqs.length === 0 ? (
            <Empty icon="boxes" title={status === "open" ? "Nothing waiting on purchasing" : "None yet"}>
              {status === "open" ? "To ask for stock: Stock → Reorder → check the items → Next." : null}
            </Empty>
          ) : (
            <div className="list">
              {reqs.map((r) => {
                const ls = lines.get(r.id) ?? [];
                return (
                  <Link key={r.id} href={`/inventory/reorders/${r.id}`} className="item">
                    <Send size={18} className="chev" style={{ flex: "none" }} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row between" style={{ gap: 8 }}>
                        <span className="t ellipsis">{reorderRef(r.id)} · {bName(r.branch_id)}</span>
                        <span className={`pill ${r.status === "open" ? "warn" : r.status === "ordered" ? "ok" : "grey"}`}>{ls.length} {ls.length === 1 ? "item" : "items"}</span>
                      </div>
                      <div className="s ellipsis">{ls.slice(0, 4).map((l) => `${n(l.qty)} ${l.name}`).join(" · ")}{ls.length > 4 ? ` · +${ls.length - 4} more` : ""}</div>
                      <div className="tiny faint">
                        {r.requested_by_name} · {dateTime(r.created_at)}
                        {r.status !== "open" && r.handled_by_name ? ` · ${r.status === "ordered" ? "ordered" : "cancelled"} by ${r.handled_by_name}${r.handled_note ? `: ${r.handled_note}` : ""}` : ""}
                        {r.status === "open" && r.email_status && r.email_status !== "sent" ? " · not emailed" : ""}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {profile.role === "admin" ? (
            <details className="card" style={{ marginTop: 14 }}>
              <summary className="linkbtn small">Who reorder requests go to</summary>
              <form action={savePurchasingContact} className="col" style={{ gap: 8, marginTop: 10 }}>
                <div className="grid2">
                  <input className="input sm" name="name" defaultValue={buyer.name} placeholder="Name" aria-label="Name" />
                  <input className="input sm" name="email" type="email" required defaultValue={buyer.email} placeholder="Email" aria-label="Email" />
                </div>
                <Submit className="btn sm" pendingText="Saving…">Save</Submit>
              </form>
            </details>
          ) : null}
        </>
      )}
    </main>
  );
}
