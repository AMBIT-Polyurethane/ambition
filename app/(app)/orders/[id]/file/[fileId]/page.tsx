import { notFound } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { dateTime, orderNo } from "@/lib/format";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Order file" };
export const dynamic = "force-dynamic";

/** An order's signed BOL or invoice, shown inside the app (AMBIT staff only). Opening it in a new window from the
 *  installed app left a blank black window, so it opens here, with Back, plus links to open or download it. */
export default async function OrderFilePage({ params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const { supabase } = await requireEmployee();
  const [{ data: f }, { data: o }] = await Promise.all([
    supabase.from("order_files").select("id, kind, name, path, uploaded_by_name, created_at").eq("id", Number(fileId)).eq("order_id", id).maybeSingle<{
      id: number; kind: "invoice" | "bol"; name: string | null; path: string; uploaded_by_name: string | null; created_at: string;
    }>(),
    supabase.from("orders").select("order_no").eq("id", id).maybeSingle<{ order_no: number }>(),
  ]);
  if (!f || !o) notFound();
  const bucket = supabase.storage.from("order-files");
  const [view, dl] = await Promise.all([
    bucket.createSignedUrl(f.path, 60 * 30),
    bucket.createSignedUrl(f.path, 60 * 30, { download: f.name || true }),
  ]);
  const url = view.data?.signedUrl ?? null;
  const pdf = /\.pdf$/i.test(f.path);
  const what = f.kind === "bol" ? "Signed BOL" : "Invoice";
  return (
    <main className="shell wide">
      <TopBar title={`${what} · ${orderNo(o.order_no)}`} back={`/orders/${id}`} />
      <div className="row wrap between" style={{ gap: 8, alignItems: "center" }}>
        <span className="small muted">{[f.name, f.uploaded_by_name, dateTime(f.created_at)].filter(Boolean).join(" · ")}</span>
        {url ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <a className="btn sm dark" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open in your browser</a>
            {dl.data?.signedUrl ? <a className="btn sm dark" href={dl.data.signedUrl}><Download size={15} /> Download</a> : null}
          </div>
        ) : null}
      </div>
      {!url ? (
        <div className="alert err small">The file couldn&apos;t be opened. Try again in a minute.</div>
      ) : pdf ? (
        <>
          <iframe className="file-view pdf" src={url} title={`${what} for ${orderNo(o.order_no)}`} />
          <span className="tiny faint">Blank or not loading? Use Open in your browser above.</span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="file-view img" src={url} alt={`${what} for ${orderNo(o.order_no)}`} />
      )}
    </main>
  );
}
