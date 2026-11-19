"use client";

import { useState, useTransition } from "react";
import { Copy, LoaderCircle, Send } from "lucide-react";
import { sendPartnerInvite } from "@/app/store/desk-actions";

/** Jeremiah sends the store owner the link to make their own login (nobody at AMBIT makes it for them). */
export function OwnerInvite({ slug, email: start, owner, sentTo, sentAt }: { slug: string; email: string; owner: string; sentTo: string | null; sentAt: string | null }) {
  const [email, setEmail] = useState(start);
  const [pending, run] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="col" style={{ gap: 8 }}>
      <b className="small">{sentTo ? `Invite sent to ${sentTo} on ${new Date(sentAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. ${owner} hasn't made the login yet.` : `${owner} doesn't have a login yet.`}</b>
      <span className="small muted">This emails {owner} a private link. {owner} makes the password. The link works for 30 days.</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Owner's email" style={{ flex: 1, minWidth: 220 }} />
        <button
          type="button"
          className="btn sm"
          disabled={pending || !email.includes("@")}
          onClick={() =>
            run(async () => {
              const r = await sendPartnerInvite(slug, "owner", null, email);
              setRes(r.ok ? { ok: true, text: r.message ?? "Sent.", link: r.link } : { ok: false, text: r.error });
            })
          }
        >
          {pending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} aria-hidden="true" />} {sentTo ? "Send a new invite" : `Send ${owner.split(" ")[0]} the invite`}
        </button>
      </div>
      {res ? (
        <div className={`alert ${res.ok ? "ok" : "err"} small`} style={{ margin: 0 }}>
          {res.text}
          {res.link ? (
            <button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(res.link!); setCopied(true); }}>
              <Copy size={14} aria-hidden="true" /> {copied ? "Copied" : "Copy the link"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
