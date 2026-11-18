"use client";

import { useState, useTransition } from "react";
import { CircleAlert, LoaderCircle, Save } from "lucide-react";
import { Help } from "@/components/help";
import { OrderSheet, type SheetState } from "@/components/order-sheet";
import { OrderDetailsForm, type DetailsState } from "@/components/order-details-form";
import { saveEditOrder } from "@/app/(app)/orders/actions";

type SheetProps = Omit<React.ComponentProps<typeof OrderSheet>, "embedded" | "onState" | "orderId">;
type DetailsProps = Omit<React.ComponentProps<typeof OrderDetailsForm>, "embedded" | "onState">;

/** One Edit order: what's on it (items and lots) and who / where / when, with one Save for all of it. */
export function EditOrder({ id, items, details, start = "items" }: { id: string; items: SheetProps | null; details: DetailsProps | null; start?: "items" | "details" }) {
  const [tab, setTab] = useState<"items" | "details">(items ? (details && start === "details" ? "details" : "items") : "details");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [det, setDet] = useState<DetailsState | null>(null);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const list = [...(det?.summary ?? []).map((s) => `${s} changed`), ...(sheet?.changes ?? [])];
  const problem = det?.problem ?? sheet?.problem ?? null;
  const save = () =>
    go(async () => {
      setError(null);
      if (problem) return setError(problem);
      if (!list.length) return setError("Nothing changed yet.");
      const r = await saveEditOrder({
        id,
        note: why,
        details: det && Object.keys(det.set).length ? det.set : null,
        sheet: sheet && sheet.changes.length ? sheet.payload : null,
      });
      if (r && !r.ok) setError(r.error);
    });

  return (
    <div className="col" style={{ gap: 16, paddingBottom: 120 }}>
      {items && details ? (
        <nav className="seg2" aria-label="What to edit">
          <button type="button" className={tab === "items" ? "on" : undefined} aria-pressed={tab === "items"} onClick={() => setTab("items")}>
            Items &amp; lots{sheet?.changes.length ? <span className="seg2-n">{sheet.changes.length}</span> : null}
          </button>
          <button type="button" className={tab === "details" ? "on" : undefined} aria-pressed={tab === "details"} onClick={() => setTab("details")}>
            Customer, ship-to &amp; dates{det?.summary.length ? <span className="seg2-n">{det.summary.length}</span> : null}
          </button>
        </nav>
      ) : null}
      {items ? (
        <div hidden={tab !== "items"}>
          <OrderSheet {...items} orderId={id} embedded onState={setSheet} />
        </div>
      ) : null}
      {details ? (
        <div hidden={tab !== "details"} style={{ maxWidth: 760, width: "100%" }}>
          <OrderDetailsForm {...details} embedded onState={setDet} />
        </div>
      ) : null}

      <div className="save2" role="region" aria-label="Save">
        <div className="save2-in">
          {list.length ? (
            <details className="save2-list">
              <summary>{list.length} change{list.length === 1 ? "" : "s"}</summary>
              <ul className="edit-changes small">{list.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </details>
          ) : (
            <span className="up2-sub">Nothing changed yet</span>
          )}
          <input className="input sm save2-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="Why? (optional)" aria-label="Why (shows in the order history)" />
          <span className="row" style={{ gap: 8 }}>
            {items?.next ? <Help>{items.next}</Help> : null}
            <button type="button" className="b2" onClick={save} disabled={pending || !list.length}>
              {pending ? <LoaderCircle size={17} className="spin" /> : <Save size={17} />} {pending ? "Saving…" : "Save"}
            </button>
          </span>
        </div>
        {error || (list.length && problem) ? (
          <div className="alert err small" role="alert" style={{ marginTop: 8 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{error ?? problem}</span></div>
        ) : null}
      </div>
    </div>
  );
}
