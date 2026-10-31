"use client";

import { useRef, useState } from "react";
import { Camera, ImageOff, Trash2 } from "lucide-react";
import type { FieldTrip, Photo } from "@/lib/ops/field/types";
import { nowIso, useField } from "./bits";

const KINDS = [
  { k: "before", l: "Before", hint: "The area before you spray" },
  { k: "after", l: "After", hint: "Finished work, depth gauge in the shot" },
  { k: "issue", l: "Issues", hint: "Anything wrong: damage, off-ratio foam, pull-away" },
] as const;

/** Before, after and issue photos. Kept on the phone and uploaded when there's signal. */
export function PhotosTab({ trip, day }: { trip: FieldTrip; day: string }) {
  const { queue, editable, photoUrl, addPhoto } = useField();
  const can = editable(trip);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const rows = trip.photos.filter((p) => !p.date || p.date === day);

  const add = async (kind: Photo["kind"], files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    setBusy(kind);
    for (const f of Array.from(files).slice(0, 12)) {
      const e = await addPhoto(trip, f, kind, day);
      if (e) setErr(e);
    }
    setBusy(null);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      {err ? <div className="alert err small" role="alert"><span>{err}</span></div> : null}
      {KINDS.map((k) => {
        const list = rows.filter((p) => p.kind === k.k);
        return (
          <section key={k.k} className="card col" style={{ gap: 10 }}>
            <div className="row between" style={{ gap: 8 }}>
              <span className="col tight">
                <b>{k.l} <span className="faint small">({list.length})</span></b>
                <span className="tiny faint">{k.hint}</span>
              </span>
              {can ? (
                <>
                  <input
                    ref={(el) => { inputs.current[k.k] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    hidden
                    onChange={(e) => { add(k.k, e.target.files); e.target.value = ""; }}
                  />
                  <button type="button" className="btn sm" disabled={busy !== null} onClick={() => inputs.current[k.k]?.click()}>
                    <Camera size={15} /> {busy === k.k ? "Saving…" : "Take photo"}
                  </button>
                </>
              ) : null}
            </div>
            {list.length ? (
              <div className="fld-photos">
                {list.map((p) => {
                  const url = photoUrl(p.id, p.path);
                  return (
                    <figure key={p.id} className="fld-photo">
                      {url ? <img src={url} alt={k.l} loading="lazy" /> : <span className="fld-photo-ph"><ImageOff size={18} /></span>}
                      {can ? (
                        <button type="button" className="fld-photo-x" aria-label="Delete photo" onClick={() => { if (confirm("Delete this photo?")) queue({ t: "photo", trip: trip.id, at: nowIso(), id: p.id, date: p.date, kind: p.kind, path: p.path, deleted: true }); }}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </figure>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
      <span className="tiny faint">Photos are made smaller on the phone and upload when there&apos;s signal. Customers never see them unless you send them.</span>
    </div>
  );
}
