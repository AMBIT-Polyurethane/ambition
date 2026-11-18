"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, CircleAlert, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Help } from "@/components/help";
import { money, rate } from "@/lib/format";
import { scorePr } from "@/app/(app)/price-requests/native-actions";
import type { PrScore } from "@/lib/prf-score";

const REC = { approve: { text: "Approve", cls: "ok" }, counter: { text: "Counter", cls: "warn" }, deny: { text: "Deny", cls: "err" } } as const;
const tone = (n: number) => (n >= 70 ? "ok" : n >= 55 ? "warn" : "err");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Price approvers: what this request is worth to AMBIT, scored against every price request in the last 90 days. */
export function ScoreCard({ id, initial }: { id: number; initial: PrScore | null }) {
  const [s, setS] = useState<PrScore | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, go] = useTransition();
  const run = () =>
    go(async () => {
      setError(null);
      const r = await scorePr(id);
      if (r.ok) setS(r.score);
      else setError(r.error);
    });
  useEffect(() => {
    if (!initial) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) {
    return (
      <section className="card2 score2" aria-label="Quality score">
        <div className="card2-b col" style={{ gap: 10 }}>
          <span className="up2-who" style={{ color: "var(--text3)" }}>Quality score</span>
          {error ? (
            <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{error}</span></div>
          ) : (
            <span className="row" style={{ gap: 10, color: "var(--text2)" }}><LoaderCircle size={18} className="spin" /> Comparing it with the last 90 days of price requests…</span>
          )}
          {error ? <button type="button" className="b2 sm quiet" onClick={run} disabled={busy} style={{ alignSelf: "flex-start" }}>Try again</button> : null}
        </div>
      </section>
    );
  }
  const t = tone(s.score);
  const parts: [string, number, string][] = [
    ["Price", s.parts.price, "Asked prices against list, the floor, and every request for the same item in the last 90 days. 40% of the score."],
    ["Volume", s.parts.volume, "Sets a month and rigs. 30% of the score."],
    ["Customer", s.parts.customer, "Sales in the last 12 months, how often they order, anything past due. New customers start in the middle. 15%."],
    ["Details", s.parts.details, "A real note, who they buy from now, volume on each line. 15%."],
  ];
  const lines = s.metrics.lines.filter((l) => l.peers > 0 || l.list !== null);
  return (
    <section className="card2 score2" aria-label="Quality score">
      <div className="card2-b col" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 16, alignItems: "center" }}>
          <div className={`ring2 ${t}`} style={{ ["--p" as string]: `${s.score}` }} role="img" aria-label={`Score ${s.score} out of 100, grade ${s.grade}`}>
            <span><b>{s.score}</b><i>{s.grade}</i></span>
          </div>
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            <span className="row" style={{ gap: 8 }}>
              <span className="up2-who" style={{ color: "var(--text3)" }}>Quality score</span>
              <Help>What this request is worth to AMBIT, from 0 to 100. The app scores price, volume, customer and details from every price request in the last 90 days; the AI reads the same numbers and the requests and gives the final score.</Help>
            </span>
            {s.ai ? <span style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px" }}>{s.ai.headline}</span> : <span className="up2-sub">The app&apos;s own score (the AI didn&apos;t answer).</span>}
            {s.ai ? (
              <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className={`pill2 ${REC[s.ai.recommendation].cls}`}>{REC[s.ai.recommendation].text}</span>
                {s.ai.est_monthly ? <span className="pill2">≈ {money(s.ai.est_monthly)} a month</span> : null}
              </span>
            ) : null}
          </div>
        </div>
        {s.ai?.recommendation === "counter" && s.ai.counter ? <div className="alert warn small"><Sparkles size={15} style={{ flex: "none", marginTop: 2 }} /><span>{s.ai.counter}</span></div> : null}

        <div className="bars2">
          {parts.map(([k, v, h]) => (
            <div key={k} className="bar2">
              <span className="row" style={{ gap: 6 }}>{k} <Help>{h}</Help></span>
              <span className="bar2-t"><span className={`bar2-f ${tone(v)}`} style={{ width: `${v}%` }} /></span>
              <b>{v}</b>
            </div>
          ))}
        </div>

        {s.ai && (s.ai.strengths.length || s.ai.concerns.length) ? (
          <div className="col" style={{ gap: 6 }}>
            {s.ai.strengths.map((x, i) => <span key={`s${i}`} className="pt2 ok"><Check size={15} /> {x}</span>)}
            {s.ai.concerns.map((x, i) => <span key={`c${i}`} className="pt2 warn"><TriangleAlert size={15} /> {x}</span>)}
          </div>
        ) : null}

        {lines.length ? (
          <div className="col" style={{ gap: 0 }}>
            <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 750, color: "var(--text3)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
              Last 90 days <Help>Other price requests for the same item: the middle price asked, the middle price approved, and how this ask ranks (higher is better for AMBIT).</Help>
            </span>
            {lines.map((l) => (
              <div key={l.id} className="cmp2">
                <span className="cmp2-n">{l.name}</span>
                <span className="cmp2-v">
                  <b>{rate(l.asked)}</b>
                  {l.peers ? <> · middle ask {l.medAsked !== null ? rate(l.medAsked) : "–"}{l.medApproved !== null ? ` · approved ${rate(l.medApproved)}` : ""} · {l.peers} request{l.peers === 1 ? "" : "s"}</> : " · first request for this"}
                  {l.underList !== null ? ` · ${l.underList > 0 ? `${l.underList}% under list` : "at/over list"}` : ""}
                </span>
                {l.belowFloor ? <span className="pill2 err">Below floor</span> : l.rank !== null ? <span className={`pill2 ${tone(l.rank)}`}>Better than {l.rank}%</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="tiny faint">{s.metrics.context.requests90} other request{s.metrics.context.requests90 === 1 ? "" : "s"} in the last 90 days · scored {when(s.scored_at)}</span>
          <button type="button" className="b2 sm quiet" onClick={run} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Score again</button>
        </div>
        {error ? <div className="alert err small" role="alert"><span>{error}</span></div> : null}
      </div>
    </section>
  );
}
