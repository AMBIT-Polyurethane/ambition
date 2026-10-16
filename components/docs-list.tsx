"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Icon } from "@/components/icons";
import type { DocumentRow } from "@/lib/types";

const GROUPS: { id: string; label: string; types: string[] }[] = [
  { id: "all", label: "All", types: [] },
  { id: "product", label: "Product docs", types: ["TDS", "SDS", "ESR"] },
  { id: "TSB", label: "Bulletins", types: ["TSB"] },
  { id: "guides", label: "Guides & training", types: ["Guide", "Training"] },
  { id: "marketing", label: "Marketing", types: ["Marketing"] },
];

const ICON: Record<string, string> = { TSB: "bulletin", Marketing: "megaphone", Training: "book", Guide: "book" };

export function DocsList({ docs, initial }: { docs: DocumentRow[]; initial: string }) {
  const [group, setGroup] = useState(GROUPS.some((g) => g.id === initial) ? initial : "all");
  const [q, setQ] = useState("");
  const groups = GROUPS.filter((g) => g.id === "all" || docs.some((d) => g.types.includes(d.doc_type)));

  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group);
    const needle = q.trim().toLowerCase();
    return docs.filter(
      (d) =>
        (!g || g.id === "all" || g.types.includes(d.doc_type)) &&
        (!needle || `${d.title} ${d.product ?? ""} ${d.code ?? ""} ${d.doc_type}`.toLowerCase().includes(needle)),
    );
  }, [docs, group, q]);

  return (
    <>
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search docs, products, TSB #" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
      </div>
      <div className="chips">
        {groups.map((g) => (
          <button key={g.id} type="button" className={`chip${group === g.id ? " on" : ""}`} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="card muted small center">No documents match.</div>
      ) : (
        <div className="list">
          {shown.map((d) => {
            const ready = Boolean(d.url || d.storage_path);
            const inner = (
              <>
                <div className="ic"><Icon name={ICON[d.doc_type] ?? "docs"} /></div>
                <div className="grow">
                  <div className="t">{d.code ? `${d.code} ` : ""}{d.title}</div>
                  <div className="s ellipsis">{ready ? [d.product, d.description].filter(Boolean).join(" · ") || d.doc_type : "Coming soon"}</div>
                </div>
                <span className="pill grey">{d.doc_type}</span>
                {ready ? <ChevronRight size={18} className="chev" /> : null}
              </>
            );
            return ready ? (
              <a key={d.id} className="item" href={`/docs/open/${d.id}`} target="_blank" rel="noopener noreferrer">{inner}</a>
            ) : (
              <div key={d.id} className="item" style={{ opacity: 0.55 }}>{inner}</div>
            );
          })}
        </div>
      )}
    </>
  );
}
