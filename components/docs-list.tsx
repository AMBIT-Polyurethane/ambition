"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Search, Share } from "lucide-react";
import { Icon } from "@/components/icons";
import { DOC_GROUPS, LIBRARY_SHELVES, TYPE_ORDER, docProducts, hasFile, productFamilies, renewalState, typeInfo } from "@/lib/docs";
import type { DocumentRow } from "@/lib/types";

const byTypeThenSort = (a: DocumentRow, b: DocumentRow) =>
  (TYPE_ORDER[a.doc_type] ?? 99) - (TYPE_ORDER[b.doc_type] ?? 99) || a.sort - b.sort || a.title.localeCompare(b.title);

export function DocsList({ docs, initial, staff = false }: { docs: DocumentRow[]; initial: string; staff?: boolean }) {
  const start = initial.toLowerCase();
  const [group, setGroup] = useState(DOC_GROUPS.some((g) => g.id === start) ? start : "all");
  const [product, setProduct] = useState("all");
  const [q, setQ] = useState("");

  const families = useMemo(() => productFamilies(docs), [docs]);
  const groups = DOC_GROUPS.filter((g) => g.id === "all" || docs.some((d) => g.types.includes(d.doc_type)));
  const productDocsShown = !["spfa", "tsb"].includes(group);

  const needle = q.trim().toLowerCase();
  const browsing = group === "all" && product === "all" && !needle;

  const shown = useMemo(() => {
    const g = DOC_GROUPS.find((x) => x.id === group);
    return docs
      .filter(
        (d) =>
          (!g || g.id === "all" || g.types.includes(d.doc_type)) &&
          (product === "all" || docProducts(d).includes(product)) &&
          (!needle ||
            `${d.title} ${docProducts(d).join(" ")} ${d.code ?? ""} ${d.doc_type} ${typeInfo(d.doc_type).label} ${d.category ?? ""} ${d.description ?? ""}`
              .toLowerCase()
              .includes(needle)),
      )
      .sort(group === "spfa" ? (a, b) => a.sort - b.sort : byTypeThenSort);
  }, [docs, group, product, needle]);

  return (
    <>
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search docs, products, ESR or SPFA #" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
      </div>
      <div className="chips" role="tablist" aria-label="Document type">
        {groups.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={`chip${group === g.id ? " on" : ""}`} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      {families.length > 1 && productDocsShown ? (
        <div className="chips" aria-label="Product">
          <button type="button" className={`chip sm${product === "all" ? " on2" : ""}`} onClick={() => setProduct("all")}>All products</button>
          {families.map((f) => (
            <button key={f} type="button" className={`chip sm${product === f ? " on2" : ""}`} onClick={() => setProduct(product === f ? "all" : f)}>{f}</button>
          ))}
        </div>
      ) : null}

      {browsing ? (
        <Browse docs={docs} families={families} staff={staff} />
      ) : shown.length === 0 ? (
        <div className="card muted small center">No documents match.</div>
      ) : (
        <DocRows docs={shown} staff={staff} showProducts={product === "all"} />
      )}
    </>
  );
}

/** Default view: one section per product, then bulletins, other docs and the SPFA library shelves. */
function Browse({ docs, families, staff }: { docs: DocumentRow[]; families: string[]; staff: boolean }) {
  const tsb = docs.filter((d) => d.doc_type === "TSB");
  const spfa = docs.filter((d) => d.doc_type === "Industry").sort((a, b) => a.sort - b.sort);
  const loose = docs.filter((d) => !["TSB", "Industry"].includes(d.doc_type) && docProducts(d).length === 0).sort(byTypeThenSort);
  const shelves = [...LIBRARY_SHELVES, ...Array.from(new Set(spfa.map((d) => d.category ?? "Other"))).filter((c) => !LIBRARY_SHELVES.includes(c))]
    .map((shelf) => ({ shelf, docs: spfa.filter((d) => (d.category ?? "Other") === shelf) }))
    .filter((s) => s.docs.length);

  return (
    <>
      {families.map((f) => (
        <section key={f} className="section">
          <div className="eyebrow">{f}</div>
          <DocRows docs={docs.filter((d) => docProducts(d).includes(f)).sort(byTypeThenSort)} staff={staff} />
        </section>
      ))}
      {tsb.length ? (
        <section className="section">
          <div className="eyebrow">Technical service bulletins</div>
          <DocRows docs={tsb.sort((a, b) => a.sort - b.sort)} staff={staff} />
        </section>
      ) : null}
      {loose.length ? (
        <section className="section">
          <div className="eyebrow">More from AMBIT</div>
          <DocRows docs={loose} staff={staff} />
        </section>
      ) : null}
      {shelves.length ? (
        <section className="section">
          <div className="eyebrow">SPFA technical library</div>
          <div className="list">
            {shelves.map((s) => (
              <details key={s.shelf} className="shelf">
                <summary className="item">
                  <div className="ic"><Icon name="book" /></div>
                  <div className="grow">
                    <div className="t">{s.shelf}</div>
                    <div className="s">{s.docs.length} SPFA document{s.docs.length === 1 ? "" : "s"}</div>
                  </div>
                  <ChevronRight size={18} className="chev turn" />
                </summary>
                <DocRows docs={s.docs} staff={staff} nested />
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function DocRows({ docs, staff, showProducts = false, nested = false }: { docs: DocumentRow[]; staff: boolean; showProducts?: boolean; nested?: boolean }) {
  return (
    <div className={nested ? "nested" : "list"}>
      {docs.map((d) => (
        <DocRow key={d.id} d={d} staff={staff} showProducts={showProducts} />
      ))}
    </div>
  );
}

function DocRow({ d, staff, showProducts }: { d: DocumentRow; staff: boolean; showProducts: boolean }) {
  const ready = hasFile(d);
  const info = typeInfo(d.doc_type);
  const renewal = renewalState(d.renewal_on);
  const sub = !ready
    ? "Coming soon"
    : d.doc_type === "Industry"
      ? [showProducts ? d.category : null, "SPFA technical document"].filter(Boolean).join(" · ")
      : [d.revision, showProducts ? docProducts(d).join(", ") : null].filter(Boolean).join(" · ") || d.description || info.label;
  const body = (
    <>
      <div className="ic"><Icon name={info.icon} /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="t">{d.code ? <span className="code">{d.code}</span> : null}{d.title}</div>
        <div className="s ellipsis">{sub}</div>
        {staff && (renewal.state === "past" || renewal.state === "soon") ? (
          <div className={`tiny ${renewal.state === "past" ? "red" : "warn-text"}`} style={{ marginTop: 4 }}>{renewal.label} · staff only note</div>
        ) : null}
      </div>
    </>
  );
  if (!ready) {
    return (
      <div className="item doc-off" style={{ opacity: 0.55 }}>
        {body}
        <span className="pill grey">{info.short}</span>
      </div>
    );
  }
  return (
    <div className="item doc">
      <a className="doc-open" href={`/docs/open/${d.id}`} target="_blank" rel="noopener noreferrer">
        {body}
        <span className="pill grey">{info.short}</span>
      </a>
      <ShareButton d={d} />
    </div>
  );
}

const fileName = (title: string, type: string) => {
  const ext = type.includes("pdf") ? "pdf" : type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "pdf";
  return `${title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim()}.${ext}`;
};

/** Shares the actual file (so it can be texted or emailed to an inspector); falls back to the link. */
function ShareButton({ d }: { d: DocumentRow }) {
  const cached = useRef<File | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "again" | "copied">("idle");

  const share = async () => {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (!nav) return;
    try {
      if (!cached.current && typeof nav.canShare === "function") {
        setState("busy");
        const res = await fetch(`/docs/open/${d.id}`);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], fileName(d.title, blob.type), { type: blob.type || "application/pdf" });
          if (nav.canShare({ files: [file] })) cached.current = file;
        }
      }
      if (cached.current) {
        await nav.share({ files: [cached.current], title: d.title });
        setState("idle");
        return;
      }
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "AbortError") return setState("idle");
      // Safari wants a fresh tap once the file has downloaded.
      if (name === "NotAllowedError" && cached.current) return setState("again");
    }
    // No file sharing here (or the file is on another website): share or copy the public link instead.
    const link = d.url ?? `${location.origin}/docs/open/${d.id}`;
    try {
      if (typeof nav.share === "function") {
        await nav.share({ title: d.title, url: link });
        setState("idle");
      } else {
        await nav.clipboard.writeText(link);
        setState("copied");
        setTimeout(() => setState("idle"), 1800);
      }
    } catch {
      setState("idle");
    }
  };

  return (
    <button type="button" className="doc-share" onClick={share} disabled={state === "busy"} aria-label={`Share ${d.title}`} title="Share">
      {state === "again" ? <span className="tiny">Tap to share</span> : state === "copied" ? <span className="tiny">Link copied</span> : state === "busy" ? <span className="tiny">…</span> : <Share size={18} />}
    </button>
  );
}
