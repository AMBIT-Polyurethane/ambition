import { notFound } from "next/navigation";
import { requireTakeoff } from "@/lib/takeoff/access";
import { DEFAULT_WORK_AREAS } from "@/lib/ops/defaults";
import { TakeoffWorkspace, type TFile, type TakeoffInfo } from "@/components/takeoff/workspace";
import type { TItem, TMark, TSheet } from "@/lib/takeoff/calc";

export const metadata = { title: "Takeoff" };
export const dynamic = "force-dynamic";

export default async function TakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, ws } = await requireTakeoff();
  const { data: t } = await supabase.from("takeoffs").select("id, name, customer, address, due_date, status, ops_company_id, lead_id, ops_customer_id, ai_scan").eq("id", id).maybeSingle<TakeoffInfo>();
  if (!t) notFound();
  const mine = Boolean(t.ops_company_id && ws && ws.company.id === t.ops_company_id);

  const [{ data: files }, { data: sheets }, { data: items }, { data: marks }] = await Promise.all([
    supabase.from("takeoff_files").select("id, path, file_name, size, pages").eq("takeoff_id", id).order("created_at"),
    supabase.from("takeoff_sheets").select("*").eq("takeoff_id", id).order("sort").order("page"),
    supabase.from("takeoff_items").select("*").eq("takeoff_id", id).order("sort").order("created_at"),
    supabase.from("takeoff_marks").select("id, item_id, sheet_id, points, cutout").eq("takeoff_id", id).order("created_at").range(0, 19999),
  ]);

  // Private plan files: short-lived links only this person's browser uses.
  const fileRows = (files ?? []) as { id: string; path: string; file_name: string; size: number | null; pages: number | null }[];
  const signed = fileRows.length
    ? (await supabase.storage.from("plans").createSignedUrls(fileRows.map((f) => f.path), 60 * 60 * 12)).data ?? []
    : [];
  const withUrls: TFile[] = fileRows.map((f) => ({ ...f, url: signed.find((s) => s.path === f.path)?.signedUrl ?? null }));

  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return (
    <TakeoffWorkspace
      takeoff={t}
      files={withUrls}
      sheets={((sheets ?? []) as TSheet[]).map((s) => ({ ...s, width_pt: n(s.width_pt), height_pt: n(s.height_pt), ft_per_pt: n(s.ft_per_pt) }))}
      items={((items ?? []) as TItem[]).map((i) => ({
        ...i,
        thickness_in: n(i.thickness_in),
        height_ft: n(i.height_ft),
        pitch: n(i.pitch),
        deduct_sqft: Number(i.deduct_sqft ?? 0),
      }))}
      marks={(marks ?? []) as TMark[]}
      workAreas={mine ? ws!.settings.work_areas : DEFAULT_WORK_AREAS}
      ops={mine}
    />
  );
}
