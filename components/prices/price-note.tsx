"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { savePriceNote } from "@/app/(app)/prices/actions";

/** A customer's pricing notes: special prices on other items, freight and terms (from the old foam price sheet, 0107). */
export function PriceNote({ company, note, editable }: { company: string; note: string; editable: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(note);
  const [err, setErr] = useState<string | null>(null);
  const [pending, go] = useTransition();
  if (!note && !editable) return null;
  return (
    <section className="card col" style={{ gap: 8 }} aria-label="Pricing notes">
      <div className="row between" style={{ gap: 8 }}>
        <b className="small row" style={{ gap: 6 }}><NotebookPen size={15} /> Pricing notes</b>
        {editable && !edit ? <button type="button" className="linkbtn small" onClick={() => setEdit(true)}>{note ? "Edit" : "Add a note"}</button> : null}
      </div>
      {edit ? (
        <>
          <textarea id="price-note" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Special prices on other items, freight, terms" />
          {err ? <div className="alert err small">{err}</div> : null}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={pending} onClick={() => go(async () => {
              const r = await savePriceNote(company, text);
              if (!r.ok) return setErr(r.error);
              setEdit(false); setErr(null); router.refresh();
            })}>{pending ? "Saving…" : "Save note"}</button>
            <button type="button" className="btn sm ghost" onClick={() => { setEdit(false); setText(note); setErr(null); }}>Cancel</button>
          </div>
        </>
      ) : note ? <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{note}</p> : <span className="small muted">No notes yet.</span>}
    </section>
  );
}
