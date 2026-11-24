"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { makeBrief, makeCustomerRead } from "@/app/(app)/sales/actions";
import type { Brief, CustomerRead } from "@/lib/crm-ai";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

/** The rep's AI briefing: written the first time they open the hub each day, then saved. */
export function BriefCard({ rep, initial, at, aiReady }: { rep: string | null; initial: Brief | null; at: string | null; aiReady: boolean }) {
  const [brief, setBrief] = useState(initial);
  const [stamp, setStamp] = useState(at);
  const [err, setErr] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const ran = useRef(false);
  const run = () =>
    go(async () => {
      setErr(null);
      const r = await makeBrief(rep);
      if (r.ok) {
        setBrief(r.brief);
        setStamp(r.at);
      } else setErr(r.error);
    });
  useEffect(() => {
    if (!initial && aiReady && !ran.current) {
      ran.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card2 crm-ai" aria-label="Today's briefing">
      <div className="card2-h">
        <b><Sparkles size={17} aria-hidden /> Today&apos;s briefing</b>
        {aiReady ? (
          <button type="button" className="b2 quiet sm" onClick={run} disabled={pending}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {pending ? "Reading…" : "Refresh"}
          </button>
        ) : null}
      </div>
      <div className="crm-ai-b">
        {!aiReady ? (
          <p className="small muted" style={{ margin: 0 }}>AI isn&apos;t set up on this server yet.</p>
        ) : !brief ? (
          <p className="small muted" style={{ margin: 0 }}>{pending ? "Reading your customers, follow-ups and pipeline…" : err ? "" : "No briefing yet."}</p>
        ) : (
          <>
            <p className="crm-ai-head">{brief.headline}</p>
            {brief.actions.length ? (
              <ol className="crm-ai-acts">
                {brief.actions.map((a, i) => (
                  <li key={i}>
                    <span className="n">{i + 1}</span>
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      {a.customer_id ? <Link href={`/sales/customers/${a.customer_id}`} className="t">{a.title} <ArrowRight size={14} aria-hidden /></Link> : <b className="t">{a.title}</b>}
                      <span className="small muted">{a.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            {brief.wins.length ? (
              <div className="crm-ai-wins">
                {brief.wins.map((w, i) => <span key={i}>{w}</span>)}
              </div>
            ) : null}
            {stamp ? <span className="tiny faint">Written {when(stamp)} from the numbers in A.I. Check before you act on it.</span> : null}
          </>
        )}
        {err ? <div className="alert err small" role="alert">{err}</div> : null}
      </div>
    </section>
  );
}

/** The AI read on one customer: where they stand, the next move, what to say, what else they could buy. */
export function CustomerReadCard({ company, initial, at, aiReady }: { company: string; initial: CustomerRead | null; at: string | null; aiReady: boolean }) {
  const [read, setRead] = useState(initial);
  const [stamp, setStamp] = useState(at);
  const [err, setErr] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const ran = useRef(false);
  const run = () =>
    go(async () => {
      setErr(null);
      const r = await makeCustomerRead(company);
      if (r.ok) {
        setRead(r.read);
        setStamp(r.at);
      } else setErr(r.error);
    });
  useEffect(() => {
    if (!initial && aiReady && !ran.current) {
      ran.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card2 crm-ai" aria-label="AI read on this customer">
      <div className="card2-h">
        <b><Sparkles size={17} aria-hidden /> AI read</b>
        {aiReady ? (
          <button type="button" className="b2 quiet sm" onClick={run} disabled={pending}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {pending ? "Reading…" : "Refresh"}
          </button>
        ) : null}
      </div>
      <div className="crm-ai-b">
        {!aiReady ? (
          <p className="small muted" style={{ margin: 0 }}>AI isn&apos;t set up on this server yet.</p>
        ) : !read ? (
          <p className="small muted" style={{ margin: 0 }}>{pending ? "Reading their orders, products and notes…" : err ? "" : "No read yet."}</p>
        ) : (
          <>
            <p className="crm-ai-head">{read.summary}</p>
            <div className="crm-next"><b>Next step</b><span>{read.next_step}</span></div>
            {read.talking_points.length ? (
              <div className="col" style={{ gap: 4 }}>
                <span className="eyebrow">On the next call</span>
                <ul className="crm-ai-list">{read.talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
            {read.opportunities.length ? (
              <div className="col" style={{ gap: 4 }}>
                <span className="eyebrow">They could also buy</span>
                <ul className="crm-ai-list">{read.opportunities.map((o, i) => <li key={i}><b>{o.item}</b>: {o.why}</li>)}</ul>
              </div>
            ) : null}
            {stamp ? <span className="tiny faint">Written {when(stamp)} from this customer&apos;s history in A.I.</span> : null}
          </>
        )}
        {err ? <div className="alert err small" role="alert">{err}</div> : null}
      </div>
    </section>
  );
}
