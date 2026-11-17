import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, CircleCheck, Mail } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { KINDS, KIND_ORDER, buildCheckEmail, loadCheck, ownerEmails, ownersOf, type CheckRow } from "@/lib/data-check";
import { mergeLots, sendCheckEmail } from "./actions";

export const metadata = { title: "Data check" };
export const dynamic = "force-dynamic";

/** Admins: everything that needs fixing across every location, who it's on, and their email (0080). */
export default async function DataCheckPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin") redirect("/");
  const { rows, error } = await loadCheck(supabase);

  // Lot numbers for the Merge buttons.
  const lotIds = [...new Set(rows.flatMap((r) => (r.kind === "lot_duplicate" ? [r.lot_id, r.other_lot] : [])).filter((x): x is number => !!x))];
  const { data: lotRows } = lotIds.length ? await supabase.from("inventory_lots").select("id, lot_no, remaining").in("id", lotIds) : { data: [] };
  const lotNo = new Map(((lotRows ?? []) as { id: number; lot_no: string; remaining: number }[]).map((l) => [l.id, l]));

  // By person / team.
  const owners = new Map<string, CheckRow[]>();
  for (const r of rows) for (const o of ownersOf(r)) owners.set(o, [...(owners.get(o) ?? []), r]);
  const people = [...owners.entries()].sort((a, b) => b[1].length - a[1].length);
  const emails = new Map(await Promise.all(people.map(async ([o]) => [o, await ownerEmails(supabase, o)] as const)));

  const href = (r: CheckRow) =>
    r.order_id ? `/orders/${r.order_id}` : r.kind === "receiving_waiting" ? `/inventory/incoming?b=${r.branch}` : r.branch ? `/inventory/stock?b=${r.branch}` : null;

  return (
    <main className="shell wide">
      <TopBar title="Data check" back="/admin" />
      <p className="small muted" style={{ margin: 0 }}>
        Everything in the app that needs fixing, across every location, as of right now. Fix each one where it links to; it drops off this list when
        it&apos;s fixed. Each person or team below gets an email of just their list when you press Send (read it first).
      </p>
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err || error ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err ?? error}</span></div> : null}
      {!error && !rows.length ? <Empty icon="shield" title="Nothing to fix">Every lot, order and receiving report checks out.</Empty> : null}

      {rows.length ? (
        <div className="chips" aria-label="Summary">
          {KIND_ORDER.filter((k) => rows.some((r) => r.kind === k)).map((k) => (
            <a key={k} href={`#k-${k}`} className={`chip ${KINDS[k].tone === "err" ? "on" : ""}`}>
              {KINDS[k].label} · {rows.filter((r) => r.kind === k).length}
            </a>
          ))}
        </div>
      ) : null}

      {people.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b>Who it&apos;s on</b>
          {people.map(([owner, list]) => {
            const to = emails.get(owner) ?? [];
            const mail = buildCheckEmail(owner, list, profile.full_name ?? "AMBIT", "");
            return (
              <details key={owner} className="dc-person">
                <summary>
                  <b>{owner}</b> <span className="pill warn">{list.length}</span>{" "}
                  <span className="tiny faint">{to.length ? to.map((p) => p.email).join(", ") : "no email on file"}</span>
                </summary>
                <div className="dc-mail">
                  <span className="tiny faint">Subject: {mail.subject}</span>
                  <pre className="dc-text">{mail.text}</pre>
                </div>
                {to.length ? (
                  <form action={sendCheckEmail}>
                    <input type="hidden" name="owner" value={owner} />
                    <Submit className="btn sm dark" pendingText="Sending…"><Mail size={15} /> Send to {to.length === 1 ? to[0].name : `${to.length} people`}</Submit>
                  </form>
                ) : (
                  <span className="tiny faint">Add their email in Admin &gt; Accounts to send this.</span>
                )}
              </details>
            );
          })}
        </section>
      ) : null}

      {KIND_ORDER.filter((k) => rows.some((r) => r.kind === k)).map((k) => (
        <section key={k} id={`k-${k}`} className="section">
          <div className="eyebrow">{KINDS[k].label} · {rows.filter((r) => r.kind === k).length}</div>
          <div className="list">
            {rows.filter((r) => r.kind === k).map((r, i) => {
              const link = href(r);
              const a = r.lot_id ? lotNo.get(r.lot_id) : undefined;
              const b = r.other_lot ? lotNo.get(r.other_lot) : undefined;
              return (
                <div key={`${k}-${i}`} className={`item col dc-row ${KINDS[k].tone}`} style={{ alignItems: "stretch", gap: 4 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <b className="small">{link ? <Link href={link}>{r.title}</Link> : r.title}</b>
                    {r.branch ? <span className="pill">{r.branch.toUpperCase()}</span> : null}
                  </div>
                  <span className="tiny muted">{r.detail}</span>
                  <span className="tiny faint">On: {ownersOf(r).join(", ")}</span>
                  {k === "lot_duplicate" && a && b ? (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {[
                        [a, b],
                        [b, a],
                      ].map(([keep, extra]) => (
                        <form key={keep.id} action={mergeLots}>
                          <input type="hidden" name="keep" value={keep.id} />
                          <input type="hidden" name="extra" value={extra.id} />
                          <Submit className="btn sm ghost" pendingText="Merging…">Keep &ldquo;{keep.lot_no}&rdquo;, merge &ldquo;{extra.lot_no}&rdquo; into it</Submit>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
