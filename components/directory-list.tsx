"use client";

import { useState } from "react";
import { Mail, Phone, Search } from "lucide-react";
import { initials } from "@/lib/format";

export type Person = { id: string; full_name: string | null; email: string; phone: string | null; title: string | null; branch: string | null };

export function DirectoryList({ people }: { people: Person[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = people.filter((p) => !needle || `${p.full_name ?? ""} ${p.email} ${p.title ?? ""} ${p.branch ?? ""}`.toLowerCase().includes(needle));
  return (
    <>
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search name, title or branch" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search directory" />
      </div>
      <div className="list">
        {shown.map((p) => (
          <div key={p.id} className="item">
            <div className="avatar sm">{initials(p.full_name, p.email)}</div>
            <div className="grow">
              <div className="t ellipsis">{p.full_name ?? p.email}</div>
              <div className="s ellipsis">{[p.title, p.branch].filter(Boolean).join(" · ") || p.email}</div>
            </div>
            {p.phone ? (
              <a className="iconbtn" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${p.full_name ?? p.email}`}><Phone size={18} /></a>
            ) : null}
            <a className="iconbtn" href={`mailto:${p.email}`} aria-label={`Email ${p.full_name ?? p.email}`}><Mail size={18} /></a>
          </div>
        ))}
        {shown.length === 0 ? <div className="item muted small">No one matches.</div> : null}
      </div>
    </>
  );
}
