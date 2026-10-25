"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";

// A small, safe Markdown renderer for Ask AMBIT answers: paragraphs, headings, lists, tables, bold,
// italic, code, links (app paths and https only) and source markers ⟦1,2⟧. No raw HTML is ever used.

function safeHref(href: string): { href: string; internal: boolean } | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h)) return { href: h, internal: true };
  if (/^https:\/\//i.test(h)) return { href: h, internal: false };
  return null;
}

function inline(text: string, key: string, onCite?: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code, cites, links, bold, italic.
  const re = /(`[^`\n]+`)|(⟦[\d,\s]+⟧)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) {
      const nums = m[2].slice(1, -1).split(",").map((n) => Number(n.trim())).filter(Boolean);
      out.push(
        <sup key={k} className="ai-cite">
          {nums.map((n) => (
            <a
              key={n}
              href={`#src-${n}`}
              onClick={(e) => {
                if (!onCite) return;
                e.preventDefault();
                onCite(n);
              }}
            >
              {n}
            </a>
          ))}
        </sup>,
      );
    } else if (m[3]) {
      const h = safeHref(m[5]);
      const label = inline(m[4], k, onCite);
      if (!h) out.push(<Fragment key={k}>{label}</Fragment>);
      else if (h.internal) out.push(<Link key={k} href={h.href}>{label}</Link>);
      else out.push(<a key={k} href={h.href} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else if (m[6]) out.push(<strong key={k}>{inline(m[7], k, onCite)}</strong>);
    else if (m[8]) out.push(<em key={k}>{m[9] ?? m[10]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { t: "p"; lines: string[] }
  | { t: "h"; level: number; text: string }
  | { t: "ul" | "ol"; items: string[]; start?: number }
  | { t: "table"; rows: string[][] }
  | { t: "quote"; lines: string[] }
  | { t: "hr" };

function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ t: "table", rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", lines: q });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/;
    const ol = /^\s*(\d+)[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const items: string[] = [];
      const start = ordered ? Number(ol.exec(line)![1]) : undefined;
      while (i < lines.length) {
        const l = lines[i];
        const mm = ordered ? ol.exec(l) : ul.exec(l);
        if (mm) items.push(ordered ? mm[2] : mm[1]);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += " " + l.trim();
        else break;
        i++;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items, start });
      continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*[|>]/.test(lines[i])) {
      p.push(lines[i++]);
    }
    blocks.push({ t: "p", lines: p });
  }
  return blocks;
}

export function Markdown({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const blocks = parse(text);
  return (
    <div className="ai-md">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.t) {
          case "h":
            return b.level <= 2 ? <h3 key={k}>{inline(b.text, k, onCite)}</h3> : <h4 key={k}>{inline(b.text, k, onCite)}</h4>;
          case "hr":
            return <hr key={k} />;
          case "ul":
            return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`, onCite)}</li>)}</ul>;
          case "ol":
            return <ol key={k} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`, onCite)}</li>)}</ol>;
          case "quote":
            return <blockquote key={k}>{b.lines.map((l, j) => <Fragment key={j}>{j ? <br /> : null}{inline(l, `${k}-${j}`, onCite)}</Fragment>)}</blockquote>;
          case "table":
            return (
              <div key={k} className="ai-table">
                <table>
                  <thead>
                    <tr>{(b.rows[0] ?? []).map((c, j) => <th key={j}>{inline(c, `${k}-h${j}`, onCite)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.slice(1).map((r, ri) => (
                      <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}-${ri}-${j}`, onCite)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={k}>{b.lines.map((l, j) => <Fragment key={j}>{j ? <br /> : null}{inline(l, `${k}-${j}`, onCite)}</Fragment>)}</p>;
        }
      })}
    </div>
  );
}
