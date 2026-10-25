import Link from "next/link";
import { Check, CircleAlert, CircleCheck, ExternalLink, RefreshCw, X } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { CopyButton } from "@/components/copy-button";
import { currentOrigin } from "@/lib/origin";
import { dateTime } from "@/lib/format";
import { MS_ENV, msConnection, msMissing } from "@/lib/microsoft";
import { serviceReady } from "@/lib/supabase/service";
import { ago, inventorySheets } from "@/lib/inventory/view";
import { syncNow } from "@/app/(app)/inventory/actions";
import { disconnectMicrosoft, saveSheet } from "./actions";

export const metadata = { title: "Inventory admin" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type LogRow = { id: number; at: string; branch_id: string | null; kind: string; sku: string | null; message: string; qty_before: number | null; qty_after: number | null; by_name: string | null };

export default async function InventoryAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const origin = await currentOrigin();
  const redirectUri = `${origin}/api/microsoft/callback`;
  const missing = msMissing();
  const keyOk = serviceReady();
  const [sheets, conn, { data: branchRows }, { data: logRows, error: logErr }] = await Promise.all([
    inventorySheets(supabase),
    keyOk ? msConnection() : Promise.resolve(null),
    supabase.from("branches").select("id, name, state").order("sort"),
    supabase.from("inventory_log").select("*").order("at", { ascending: false }).limit(80),
  ]);
  const branches = (branchRows ?? []) as { id: string; name: string; state: string }[];
  const name = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? `${b.name}, ${b.state}` : id.toUpperCase();
  };
  const notSetUp = branches.filter((b) => !sheets.some((s) => s.branch_id === b.id));
  const logs = (logRows ?? []) as LogRow[];
  const ready = !missing.length && keyOk;

  return (
    <main className="shell wide">
      <TopBar title="Inventory" back="/admin" right={<Link href="/inventory" className="btn sm dark">Open counts</Link>} />

      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      {logErr ? <div className="alert warn small">Run supabase/migrations/0018_inventory.sql in Supabase first (SQL Editor).</div> : null}

      {/* ------------------------------------------------ 1. Microsoft */}
      <section className="section">
        <div className="eyebrow">Microsoft connection</div>
        <div className="card col">
          <ul className="setup-list">
            {[...MS_ENV, "SUPABASE_SECRET_KEY"].map((k) => {
              const ok = k === "SUPABASE_SECRET_KEY" ? keyOk : !missing.includes(k);
              return (
                <li key={k} className={ok ? "ok" : ""}>
                  {ok ? <Check size={16} /> : <X size={16} />}
                  <code>{k}</code>
                  <span className="tiny faint">{ok ? "set in Vercel" : "not set in Vercel yet"}</span>
                </li>
              );
            })}
          </ul>
          <div className="col tight">
            <span className="label">Redirect URI (paste this in Microsoft Entra)</span>
            <div className="code-box">
              <span className="grow">{redirectUri}</span>
              <CopyButton text={redirectUri} />
            </div>
          </div>
          {conn ? (
            <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
              <div className="col tight">
                <b>Connected as {conn.account.name || conn.account.email}</b>
                <span className="tiny faint">{conn.account.email} · by {conn.connected_by} · {dateTime(conn.connected_at)}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <a className="btn sm dark" href="/api/microsoft/connect">Reconnect</a>
                <form action={disconnectMicrosoft}>
                  <Submit className="btn sm ghost" pendingText="…">Disconnect</Submit>
                </form>
              </div>
            </div>
          ) : ready ? (
            <div className="col tight">
              <a className="btn ms" href="/api/microsoft/connect">Connect Microsoft</a>
              <span className="tiny faint">Sign in with the Microsoft account that owns the spreadsheet (or one it&apos;s shared with, with edit access).</span>
            </div>
          ) : (
            <div className="alert info small">Add the settings marked with an X in Vercel (Settings → Environment Variables), redeploy, then come back here to connect.</div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ 2. Spreadsheets */}
      <section className="section">
        <div className="eyebrow">Spreadsheets</div>
        {sheets.map((s) => (
          <div key={s.branch_id} className="card col">
            <div className="row between" style={{ gap: 12, alignItems: "flex-start" }}>
              <div className="col tight" style={{ minWidth: 0 }}>
                <b>{name(s.branch_id)}</b>
                <span className="tiny faint ellipsis">{s.file_name ?? "File name shows after the first sync"}</span>
                <span className="tiny faint">
                  {s.enabled ? (s.last_ok_at ? `Last matched ${ago(s.last_ok_at)}` : "Not synced yet") : "Off"}
                  {s.last_summary?.items ? ` · ${s.last_summary.items} items on the sheet` : ""}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <a className="iconbtn" href={s.share_url} target="_blank" rel="noopener noreferrer" aria-label="Open the spreadsheet"><ExternalLink size={18} /></a>
                {s.enabled && conn ? (
                  <form action={syncNow}>
                    <input type="hidden" name="branch" value={s.branch_id} />
                    <input type="hidden" name="to" value="admin" />
                    <Submit className="btn sm" pendingText="Syncing…"><RefreshCw size={15} /> Sync now</Submit>
                  </form>
                ) : null}
              </div>
            </div>
            {s.last_error ? <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{s.last_error}</span></div> : null}
            {s.last_summary?.duplicates?.length ? (
              <div className="alert info small">These SKUs are on the COUNT SHEET twice (only the first is used): {s.last_summary.duplicates.join(", ")}</div>
            ) : null}
            <form action={saveSheet} className="col">
              <input type="hidden" name="branch" value={s.branch_id} />
              <label className="field">
                <span className="label">Spreadsheet link (Share → Copy link)</span>
                <input className="input sm" name="url" defaultValue={s.share_url} required />
              </label>
              <div className="row between">
                <label className="check"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> The app keeps stock in step with this spreadsheet</label>
                <Submit className="btn sm dark">Save</Submit>
              </div>
            </form>
          </div>
        ))}
        {notSetUp.length ? (
          <details className="card">
            <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>Add another location&apos;s spreadsheet</summary>
            <form action={saveSheet} className="col" style={{ marginTop: 12 }}>
              <label className="field">
                <span className="label">Location</span>
                <select className="select sm" name="branch" required defaultValue="">
                  <option value="" disabled>Pick one</option>
                  {notSetUp.map((b) => <option key={b.id} value={b.id}>{b.name}, {b.state}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="label">Spreadsheet link</span>
                <input className="input sm" name="url" required placeholder="https://…sharepoint.com/…" />
              </label>
              <input type="hidden" name="enabled" value="on" />
              <Submit className="btn sm">Add</Submit>
            </form>
          </details>
        ) : null}
      </section>

      {/* ------------------------------------------------ 3. What happened */}
      <section className="section">
        <div className="eyebrow">What happened</div>
        {logs.length === 0 ? (
          <div className="card muted small">Nothing yet. Changes from the spreadsheet and the app show here.</div>
        ) : (
          <div className="list inv-log">
            {logs.map((l) => (
              <div key={l.id} className="item" style={{ alignItems: "flex-start" }}>
                <div className="grow col tight" style={{ minWidth: 0 }}>
                  <span>
                    {l.kind === "error" || l.kind === "conflict" ? <span className={`pill ${l.kind === "error" ? "red" : "warn"}`} style={{ marginRight: 6 }}>{l.kind === "error" ? "Problem" : "Both changed"}</span> : null}
                    {l.sku ? <b>{l.sku} </b> : null}
                    {l.message}
                  </span>
                  <span className="when">
                    {dateTime(l.at)} · {!l.by_name || l.by_name === "AMBITION" ? "AMBIT A.I." : l.by_name}
                    {l.branch_id ? ` · ${l.branch_id.toUpperCase()}` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
