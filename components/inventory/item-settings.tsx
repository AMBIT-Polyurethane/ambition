"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, CircleCheck, LoaderCircle, Pencil } from "lucide-react";
import { saveItemSettings } from "@/app/(app)/inventory/item-actions";

const t = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(Math.round(n * 100) / 100));
const digits = (v: string) => v.replace(/[^\d.]/g, "");

/** Stock > an item > Settings: Reorder at, Max, vendor, lead time. Saved here, written onto the COUNT SHEET. */
export function ItemSettings({ branch, product, unit, rop, max, vendor, lead, setBy }: {
  branch: string; product: string; unit: string; rop: number | null; max: number | null; vendor: string | null; lead: number | null; setBy?: string | null;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ rop: t(rop), max: t(max), vendor: vendor ?? "", lead: lead === null ? "" : String(lead) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const badMax = v.rop !== "" && v.max !== "" && Number(v.max) > 0 && Number(v.max) < Number(v.rop);
  const save = () =>
    go(async () => {
      setMsg(null);
      const r = await saveItemSettings({ branch, product, rop: v.rop, max: v.max, vendor: v.vendor, lead: v.lead });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: r.msg });
      setEdit(false);
      router.refresh();
    });

  if (!edit) {
    return (
      <div className="itm-set" aria-label="Item settings">
        <dl className="itm-set-v">
          <div><dt>Reorder at</dt><dd>{rop === null ? "–" : t(rop)}</dd></div>
          <div><dt>Max</dt><dd>{max === null ? "–" : t(max)}</dd></div>
          <div><dt>Vendor</dt><dd>{vendor || "–"}</dd></div>
          <div><dt>Lead time</dt><dd>{lead === null ? "–" : `${lead} business day${lead === 1 ? "" : "s"}`}</dd></div>
        </dl>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="b2 quiet sm" onClick={() => (setV({ rop: t(rop), max: t(max), vendor: vendor ?? "", lead: lead === null ? "" : String(lead) }), setEdit(true), setMsg(null))}><Pencil size={14} /> Change settings</button>
          {setBy ? <span className="tiny faint">Reorder point set by {setBy}</span> : null}
        </div>
        {msg ? <Note msg={msg} /> : null}
      </div>
    );
  }
  return (
    <div className="itm-set" aria-label="Change item settings">
      <div className="itm-set-f">
        <label className="field"><span className="label">Reorder at ({unit})</span>
          <input className="input sm" inputMode="decimal" value={v.rop} onChange={(e) => setV({ ...v, rop: digits(e.target.value) })} />
        </label>
        <label className="field"><span className="label">Max ({unit})</span>
          <input className="input sm" inputMode="decimal" value={v.max} onChange={(e) => setV({ ...v, max: digits(e.target.value) })} />
        </label>
        <label className="field itm-set-wide"><span className="label">Vendor</span>
          <input className="input sm" value={v.vendor} maxLength={120} onChange={(e) => setV({ ...v, vendor: e.target.value })} placeholder="Who we buy it from" />
        </label>
        <label className="field"><span className="label">Lead time (business days)</span>
          <input className="input sm" inputMode="numeric" value={v.lead} onChange={(e) => setV({ ...v, lead: e.target.value.replace(/\D/g, "") })} />
        </label>
      </div>
      <span className="tiny faint">Blank leaves it blank. Max is what a reorder fills up to. These go onto the COUNT SHEET within 2 minutes.</span>
      {badMax ? <span className="small err-text">Max has to be at least the reorder point.</span> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn sm" disabled={pending || badMax} onClick={save}>{pending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save settings</button>
        <button type="button" className="btn sm dark" disabled={pending} onClick={() => setEdit(false)}>Cancel</button>
      </div>
      {msg ? <Note msg={msg} /> : null}
    </div>
  );
}

function Note({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>
      {msg.ok ? <CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />}<span>{msg.text}</span>
    </div>
  );
}
