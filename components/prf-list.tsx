"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Icon } from "@/components/icons";
import { jfDate } from "@/lib/format";
import type { PrfItem } from "@/lib/jotform";

export function PrfList({ items, mineIds, admin, owners }: { items: PrfItem[]; mineIds: string[]; admin: boolean; owners: Record<string, string> }) {
  const [scope, setScope] = useState<"mine" | "all">(admin && mineIds.length === 0 ? "all" : "mine");
  const [rep, setRep] = useState("all");
  const [q, setQ] = useState("");

  const mine = useMemo(() => new Set(mineIds), [mineIds]);
  const reps = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const i of items) {
      const key = i.ownerId ?? `name:${i.repKey}`;
      const label = (i.ownerId && owners[i.ownerId]) || i.rep || "No rep picked";
      m.set(key, { label, count: (m.get(key)?.count ?? 0) + 1 });
    }
    return Array.from(m.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [items, owners]);

  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (scope === "mine" ? mine.has(i.id) : rep === "all" || (i.ownerId ?? `name:${i.repKey}`) === rep) &&
      (!needle || `${i.customer} ${i.contact} ${i.rep} ${i.id}`.toLowerCase().includes(needle)),
  );
  const showRep = admin && scope === "all";

  return (
    <>
      {admin ? (
        <div className="seg" role="tablist" aria-label="Whose requests">
          <button type="button" role="tab" aria-selected={scope === "mine"} className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>
            Mine · {mineIds.length}
          </button>
          <button type="button" role="tab" aria-selected={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            Everyone · {items.length}
          </button>
        </div>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <div className="search grow">
          <Search size={18} />
          <input className="input" type="search" placeholder="Search customer or contact" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search price requests" />
        </div>
        {showRep ? (
          <select className="select" value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Sales rep" style={{ width: "auto", maxWidth: 190 }}>
            <option value="all">All reps</option>
            {reps.map(([key, r]) => (
              <option key={key} value={key}>{r.label} ({r.count})</option>
            ))}
          </select>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="card col center" style={{ gap: 6 }}>
          <b>{needle ? "No price requests match." : scope === "mine" ? "No price requests with your name yet." : "No price requests yet."}</b>
          {!needle && scope === "mine" ? (
            <span className="small muted">Requests show up here when your name is picked in the SALES REP box. If you've sent some and they're missing, ask an admin to link your name.</span>
          ) : null}
        </div>
      ) : (
        <div className="list">
          {shown.map((i) => (
            <Link key={i.id} className="item" href={`/price-requests/${i.id}`}>
              <div className="ic"><Icon name="tag" /></div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t ellipsis">{i.customer || i.contact || "Price request"}</div>
                <div className="s ellipsis">
                  {[i.customer && i.contact ? i.contact : null, showRep ? (i.ownerId && owners[i.ownerId]) || i.rep || "No rep picked" : null, jfDate(i.created_at)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {i.status === "approved" ? (
                <span className="pill ok">Approved</span>
              ) : i.status === "pending" ? (
                <span className="pill warn">Waiting</span>
              ) : i.updated_at ? (
                <span className="pill grey">Edited</span>
              ) : null}
              <ChevronRight size={18} className="chev" />
            </Link>
          ))}
        </div>
      )}
      <div className="tiny faint center">{shown.length} request{shown.length === 1 ? "" : "s"}</div>
    </>
  );
}
