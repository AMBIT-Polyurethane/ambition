import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, Shirt, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { MerchEditor, type MerchRow } from "@/components/merch-admin";
import { deleteMerch, moveMerch, showMerch } from "./actions";

export const metadata = { title: "Merch" };
export const dynamic = "force-dynamic";

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Admin → Merch: add shirts, hats and more to the ADC store. They show as Coming soon (look only). */
export default async function MerchAdminPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("merch_items").select("*").order("sort").order("created_at");
  const rows = (data ?? []) as MerchRow[];
  return (
    <main className="shell">
      <TopBar title="Merch" back="/admin" />
      <p className="muted small" style={{ margin: 0 }}>
        Shirts, hats and more for the ADC store. Everything shows with a <b>Coming soon</b> tag: people can look and leave their email, but can&apos;t order yet.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link href="/adc/merch" target="_blank" rel="noopener noreferrer" className="b2 quiet sm"><ExternalLink size={16} /> See it on the store</Link>
      </div>
      {error ? <div className="alert warn small">Merch needs database update 0097. Run update-0097 in Supabase, then come back.</div> : null}

      <MerchEditor item={null} />

      {rows.length ? (
        <div className="merch-list">
          {rows.map((m, i) => (
            <div key={m.id} className={`card2 merch-row${m.active ? "" : " off"}`}>
              <span className="merch-ph">{m.image_url ? <img src={m.image_url} alt="" /> : <Shirt size={26} aria-hidden="true" />}</span>
              <span className="merch-b">
                <b>{m.name}</b>
                <span className="small muted">{m.price !== null ? usd(Number(m.price)) : "No price yet"}{m.sizes ? ` · ${m.sizes}` : ""}{m.active ? "" : " · hidden"}</span>
                {m.description ? <span className="tiny faint">{m.description}</span> : null}
              </span>
              <span className="merch-act">
                <MerchEditor item={m} />
                <form action={showMerch}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="on" value={m.active ? "0" : "1"} />
                  <button type="submit" className="b2 quiet sm" aria-label={m.active ? "Hide" : "Show"}>{m.active ? <><EyeOff size={15} /> Hide</> : <><Eye size={15} /> Show</>}</button>
                </form>
                <form action={moveMerch}>
                  <input type="hidden" name="id" value={m.id} />
                  <button type="submit" name="dir" value="up" className="b2 quiet sm icon" disabled={i === 0} aria-label="Move up"><ArrowUp size={15} /></button>
                  <button type="submit" name="dir" value="down" className="b2 quiet sm icon" disabled={i === rows.length - 1} aria-label="Move down"><ArrowDown size={15} /></button>
                </form>
                {!m.active ? (
                  <form action={deleteMerch}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="b2 quiet sm danger" aria-label="Delete"><Trash2 size={15} /> Delete</button>
                  </form>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : !error ? (
        <div className="muted small">No merch yet. Add your first shirt or hat above.</div>
      ) : null}
    </main>
  );
}
