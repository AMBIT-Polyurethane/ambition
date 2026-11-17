"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CircleAlert, Eraser, PenLine } from "lucide-react";
import { signPackingSlip } from "@/app/(app)/orders/actions";

export type SignRow = {
  key: string;
  sku: string;
  name: string;
  qty: string;
  /** Each lot to load on this line (inventory line id). `check`: it has a lot # to check on the drums. */
  lots: { id: number; qty: string; text: string; check: boolean }[];
};

/** A box to sign in with a finger, a stylus or a mouse. Hands back a PNG (data URL), or null once cleared. */
function SignaturePad({ label, onChange }: { label: string; onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(0);
  const [empty, setEmpty] = useState(true);
  // A fixed drawing size, so the saved picture is the same whatever the screen.
  const W = 720;
  const H = 220;

  const ctx = () => {
    const c = ref.current?.getContext("2d");
    if (c) {
      c.lineCap = "round";
      c.lineJoin = "round";
      c.strokeStyle = "#111111";
      c.lineWidth = 3.2;
    }
    return c;
  };
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = at(e);
    const c = ctx();
    if (c && last.current) {
      c.beginPath();
      c.arc(last.current.x, last.current.y, 1.4, 0, Math.PI * 2);
      c.fillStyle = "#111111";
      c.fill();
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = at(e);
    const c = ctx();
    if (c && last.current) {
      c.beginPath();
      c.moveTo(last.current.x, last.current.y);
      c.lineTo(p.x, p.y);
      c.stroke();
      inked.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    }
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    // A real signature, not a tap.
    if (inked.current > 60 && ref.current) {
      setEmpty(false);
      onChange(ref.current.toDataURL("image/png"));
    }
  };
  const clear = useCallback(() => {
    const c = ref.current?.getContext("2d");
    c?.clearRect(0, 0, W, H);
    inked.current = 0;
    setEmpty(true);
    onChange(null);
  }, [onChange]);

  return (
    <div className="sigpad-wrap">
      <div className="row between" style={{ gap: 8 }}>
        <span className="label">{label}</span>
        <button type="button" className="linkbtn small" onClick={clear} disabled={empty}>
          <Eraser size={14} /> Clear
        </button>
      </div>
      <div className={`sigpad${empty ? " empty" : ""}`}>
        <canvas
          ref={ref}
          width={W}
          height={H}
          aria-label={label}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
        />
        {empty ? <span className="sigpad-hint"><PenLine size={16} /> Sign here with your finger</span> : null}
        <span className="sigpad-x" aria-hidden>✕</span>
      </div>
    </div>
  );
}

/** Sign the packing slip: the AMBIT employee checks every lot and signs, then the customer or driver signs. */
export function SlipSignForm({
  orderId,
  version,
  rows,
  total,
  notes,
  stopText,
  pickup,
  me,
}: {
  orderId: string;
  version: string;
  rows: SignRow[];
  total: string;
  notes: string | null;
  stopText: string;
  pickup: boolean;
  me: string;
}) {
  const lotIds = rows.flatMap((r) => r.lots.filter((l) => l.check).map((l) => l.id));
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [attest, setAttest] = useState(false);
  const [ambitName, setAmbitName] = useState(me);
  const [ambitSig, setAmbitSig] = useState<string | null>(null);
  const [custName, setCustName] = useState("");
  const [custCompany, setCustCompany] = useState("");
  const [truck, setTruck] = useState("");
  const [custSig, setCustSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const custRef = useRef<HTMLElement>(null);

  const allLots = lotIds.every((id) => checked.has(id));
  // Spray foam with no lot picked (FOAM LOTS was short): the app wouldn't know which drums left.
  const noLot = rows.some((r) => r.lots.some((l) => !l.check));
  const allLoaded = rows.every((r) => loaded.has(r.key));
  const ambitDone = !noLot && allLots && allLoaded && attest && ambitName.trim().length > 1 && Boolean(ambitSig);
  const custDone = custName.trim().length > 1 && Boolean(custSig);
  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  // When the AMBIT side is done, bring the customer's part into view (hand the phone over).
  const wasDone = useRef(false);
  useEffect(() => {
    if (ambitDone && !wasDone.current) custRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    wasDone.current = ambitDone;
  }, [ambitDone]);

  const finish = () => {
    setErr(null);
    if (!ambitDone) return setErr("Finish the AMBIT employee part first: tick every line and lot, the box, and sign.");
    if (!custDone) return setErr(`The ${pickup ? "customer or driver" : "driver"} has to print their name and sign.`);
    start(async () => {
      const r = await signPackingSlip({
        id: orderId,
        version,
        ambit_name: ambitName.trim(),
        ambit_sig: ambitSig!,
        customer_name: custName.trim(),
        customer_company: custCompany.trim(),
        truck: truck.trim(),
        customer_sig: custSig!,
        lots: [...checked],
      });
      if (r && !r.ok) setErr(r.error);
    });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card col" style={{ gap: 8 }}>
        <div className="row between"><b>Load these</b><span className="tiny faint">Tick each line as it goes on the truck</span></div>
        <div className="slip-lines">
          {rows.map((r) => (
            <div key={r.key} className={`slip-line${loaded.has(r.key) ? " on" : ""}`}>
              <label className="slip-line-main">
                <input type="checkbox" checked={loaded.has(r.key)} onChange={() => setLoaded((s) => toggle(s, r.key))} aria-label={`Loaded ${r.name}`} />
                <span className="col tight grow" style={{ minWidth: 0 }}>
                  <b className="small">{r.name}</b>
                  <span className="tiny faint">{r.sku}</span>
                </span>
                <b className="slip-qty">{r.qty}</b>
              </label>
              {r.lots.length ? (
                <div className="slip-lots">
                  {r.lots.map((l) =>
                    l.check ? (
                      <label key={l.id} className={`slip-lot${checked.has(l.id) ? " on" : ""}`}>
                        <input type="checkbox" checked={checked.has(l.id)} onChange={() => setChecked((s) => toggle(s, l.id))} />
                        <span><b>{l.qty}</b> · {l.text}</span>
                        <span className="tiny faint">{checked.has(l.id) ? "Lot # matches the drums" : "Check the lot # on the drums"}</span>
                      </label>
                    ) : (
                      <div key={l.id} className="slip-lot warn small"><b>{l.qty}</b> · {l.text}</div>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <span className="small"><b>Total to load:</b> {total}</span>
        {lotIds.length ? (
          <p className="tiny" style={{ margin: 0 }}>
            <b>Load only these lots.</b> If a drum&apos;s lot # is different, stop: the order has to be changed in the app (an admin, or Item variance on the order) before
            it&apos;s loaded and signed.
          </p>
        ) : null}
        {notes ? <p className="small muted" style={{ margin: 0 }}><b>Order notes:</b> {notes}</p> : null}
        {noLot ? (
          <div className="alert err small" role="alert">
            <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
            <span>A line has no lot picked (FOAM LOTS didn&apos;t have enough). Don&apos;t load it until the order desk picks the lot with Item variance on the order.</span>
          </div>
        ) : null}
      </section>

      <div className="slip-stop" role="note">
        <span className="slip-stop-sign" aria-hidden>STOP</span>
        <span>{stopText}</span>
      </div>

      <section className="card col sign-part ambit" style={{ gap: 10 }}>
        <div className="eyebrow red">1 · AMBIT employee · picked and loaded by</div>
        <label className="field">
          <span className="label">Print name</span>
          <input className="input" value={ambitName} onChange={(e) => setAmbitName(e.target.value)} maxLength={120} autoComplete="name" />
        </label>
        <label className="check small">
          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
          <span>I loaded only the items, quantities and lots on this packing slip, and I checked the lot # on every drum.</span>
        </label>
        <SignaturePad label="AMBIT employee signature" onChange={setAmbitSig} />
        {!allLoaded || !allLots ? <span className="tiny warn-t">Tick every line{lotIds.length ? " and every lot" : ""} above first.</span> : null}
      </section>

      <section ref={custRef} className={`card col sign-part${ambitDone ? "" : " dim"}`} style={{ gap: 10 }}>
        <div className="eyebrow">2 · {pickup ? "Customer or truck driver · picked up by" : "Truck driver · received for delivery by"}</div>
        <p className="small muted" style={{ margin: 0 }}>Hand the phone or iPad over. I received the items and quantities on this packing slip.</p>
        <label className="field">
          <span className="label">Print name</span>
          <input className="input" value={custName} onChange={(e) => setCustName(e.target.value)} maxLength={120} disabled={!ambitDone} />
        </label>
        <div className="grid2">
          <label className="field">
            <span className="label">Company / carrier</span>
            <input className="input" value={custCompany} onChange={(e) => setCustCompany(e.target.value)} maxLength={120} disabled={!ambitDone} />
          </label>
          <label className="field">
            <span className="label">Truck / trailer #</span>
            <input className="input" value={truck} onChange={(e) => setTruck(e.target.value)} maxLength={60} disabled={!ambitDone} />
          </label>
        </div>
        {ambitDone ? <SignaturePad label={pickup ? "Customer or driver signature" : "Driver signature"} onChange={setCustSig} /> : <span className="tiny faint">Opens once the AMBIT employee has signed.</span>}
      </section>

      {err ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{err}</span></div> : null}
      <button type="button" className="btn block sign-finish" disabled={pending || !ambitDone || !custDone} onClick={finish}>
        {pending ? "Saving the signed slip…" : `Finish: mark ${pickup ? "picked up" : "shipped out"}`}
      </button>
      <p className="tiny faint" style={{ margin: "-6px 0 0", textAlign: "center" }}>
        The signed packing slip is saved on the order as its signed BOL, and stock comes off the spreadsheet.
      </p>
    </div>
  );
}
