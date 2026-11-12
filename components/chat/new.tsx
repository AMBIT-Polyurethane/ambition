"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, LoaderCircle, Lock, Search, Users, X } from "lucide-react";
import { initials } from "@/lib/format";
import { chatCreateChannel, chatStartDm } from "@/app/(app)/chat/actions";
import type { Staff } from "@/lib/chat";

const ROLE: Record<string, string> = { admin: "Admin", crm: "CRM", sales_rep: "Sales rep", tech: "Tech", warehouse: "Warehouse", accounting: "Accounting" };

/** Start a direct message (anyone), or make a channel (admins). */
export function NewChat({ staff, isAdmin }: { staff: Staff[]; isAdmin: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"dm" | "channel">("dm");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return staff.filter((s) => !t || `${s.name} ${ROLE[s.role ?? ""] ?? ""} ${s.branch ?? ""}`.toLowerCase().includes(t));
  }, [staff, q]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const go = async () => {
    setErr(null);
    setBusy(true);
    const r = mode === "dm" ? await chatStartDm(picked) : await chatCreateChannel({ name, about, private: priv, members: picked });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push(`/chat/${r.id}`);
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <h1 className="howto-h1">{mode === "dm" ? "New message" : "New channel"}</h1>
      {isAdmin ? (
        <div className="seg">
          <button type="button" className={mode === "dm" ? "on" : ""} onClick={() => setMode("dm")}><Users size={15} /> Direct message</button>
          <button type="button" className={mode === "channel" ? "on" : ""} onClick={() => setMode("channel")}><Hash size={15} /> Channel (a group)</button>
        </div>
      ) : null}
      {mode === "channel" ? (
        <div className="card col" style={{ gap: 12 }}>
          <label className="field"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="OKC warehouse, Texas sales, Rig service…" /></label>
          <label className="field"><span className="label">What it&apos;s for</span><input className="input" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Loading, receiving and pickups at OKC" /></label>
          <label className="check"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> <Lock size={14} /> Private: only the people below (and admins) can see it</label>
          <span className="tiny muted">Open channels: every employee can find and join them. Pick who&apos;s in it to start:</span>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Pick one person, or a few for a small group message.</p>
      )}
      {picked.length ? (
        <div className="chat-people">
          {picked.map((id) => {
            const s = staff.find((x) => x.id === id);
            return <button key={id} type="button" className="chat-person" onClick={() => toggle(id)}>{s?.name} <X size={12} /></button>;
          })}
        </div>
      ) : null}
      <div className="xr-search">
        <Search size={15} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, roles or locations" />
      </div>
      <div className="list chat-pick">
        {shown.map((s) => (
          <label key={s.id} className="item" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
            <span className="chat-av sm" style={{ background: "var(--s3)" }}>{initials(s.name)}</span>
            <span className="grow col" style={{ gap: 1 }}><span className="t">{s.name}</span><span className="s">{[ROLE[s.role ?? ""], s.branch?.toUpperCase()].filter(Boolean).join(" · ")}</span></span>
          </label>
        ))}
      </div>
      {err ? <div className="alert err small">{err}</div> : null}
      <button type="button" className="btn block" disabled={busy || (mode === "dm" ? !picked.length : !name.trim())} onClick={go}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} {mode === "dm" ? (picked.length > 1 ? "Start group message" : "Start message") : "Make the channel"}
      </button>
    </div>
  );
}
