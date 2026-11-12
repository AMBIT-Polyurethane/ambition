"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle, Search, Sparkles } from "lucide-react";
import { chatAsk, chatSearch } from "@/app/(app)/chat/actions";

type Hit = Awaited<ReturnType<typeof chatSearch>>[number];
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** Find anything in chat: plain search, or ask AMBIT Intelligence a question ("when is the Covestro truck coming?"). */
export function AskChat({ aiReady }: { aiReady: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<null | "find" | "ask">(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (mode: "find" | "ask") => {
    if (!q.trim()) return;
    setBusy(mode);
    setErr(null);
    setAnswer(null);
    if (mode === "find") setHits(await chatSearch(q));
    else {
      const r = await chatAsk(q);
      if (r.ok) {
        setAnswer(r.answer);
        setHits(r.refs);
      } else setErr(r.error);
    }
    setBusy(null);
  };
  return (
    <div className="chat-ask card col" style={{ gap: 10 }}>
      <b className="row" style={{ gap: 8 }}><Sparkles size={16} style={{ color: "var(--red)" }} /> Find anything in chat</b>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => (e.preventDefault(), go(aiReady ? "ask" : "find"))}>
        <div className="xr-search grow">
          <Search size={15} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={aiReady ? "Ask: when did Kim say the Covestro truck is coming?" : "Search messages"} />
        </div>
        {aiReady ? (
          <button type="submit" className="btn sm" disabled={Boolean(busy)}>{busy === "ask" ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Ask</button>
        ) : null}
        <button type="button" className="btn sm dark" disabled={Boolean(busy)} onClick={() => go("find")}>{busy === "find" ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />} Search</button>
      </form>
      {err ? <span className="small" style={{ color: "var(--err-text)" }}>{err}</span> : null}
      {answer ? <div className="chat-answer small">{answer}</div> : null}
      {hits ? (
        hits.length ? (
          <div className="col" style={{ gap: 6 }}>
            {hits.map((h) => (
              <Link key={h.id} href={`/chat/${h.channel_id}?m=${h.parent_id ?? h.id}${h.parent_id ? `&t=${h.parent_id}` : ""}`} className="chat-hit">
                <span className="tiny muted">{h.channel} · {h.by_name} · {when(h.created_at)}</span>
                <span className="small ellipsis2">{h.body}</span>
              </Link>
            ))}
          </div>
        ) : (
          <span className="small muted">Nothing found.</span>
        )
      ) : null}
    </div>
  );
}
