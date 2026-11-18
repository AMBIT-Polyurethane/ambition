// Each product category's icon and color (the order screen, Edit order and New order use the same ones).

type Look = { color: string; paths: string[] };

const DRUM = ["M5 5a7 3 0 1 0 14 0a7 3 0 1 0 -14 0", "M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5", "M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"];

export const LOOKS: Record<string, Look> = {
  iso: { color: "#6EA8FF", paths: DRUM },
  foam: { color: "#FF7A59", paths: DRUM },
  fiberglass: { color: "#F5C451", paths: ["m12 2 10 5-10 5L2 7Z", "m2 12 10 5 10-5", "m2 17 10 5 10-5"] },
  gunfoam: { color: "#5FD17A", paths: ["M9 8h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z", "M10 8V4h4v4", "M14 4h4"] },
  guns: { color: "#6EA8FF", paths: ["M3 9h12l3-3h3v7h-3l-3-3", "M7 9v11h4V9"] },
  sealants: { color: "#FF7EB6", paths: ["M9 2h6l-1 4h-4Z", "M9 6h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z", "M7 12h10"] },
  intumescent: { color: "#FF9E3D", paths: ["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5Z"] },
  roof: { color: "#5AC8FA", paths: ["m3 11 9-7 9 7", "M5 10v10h14V10", "M10 20v-5h4v5"] },
  tools: { color: "#4FD1C5", paths: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"] },
  fasteners: { color: "#C4C4CC", paths: ["M8 2h8v4H8z", "M10 6v12l2 4 2-4V6", "M10 10h4M10 14h4"] },
  tape: { color: "#FDBA74", paths: ["M4 12a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M8 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M18 12h4"] },
  supplies: { color: "#A3E635", paths: ["M21 8 12 3 3 8v8l9 5 9-5Z", "m3 8 9 5 9-5", "M12 13v8"] },
  plastic: { color: "#22D3EE", paths: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M3 9h18M3 15h18M9 3v18M15 3v18"] },
  cleaning: { color: "#A78BFA", paths: ["M12 3 13.8 7.2 18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z", "m19 15 .8 1.7 1.7.8-1.7.8L19 20l-.8-1.7-1.7-.8 1.7-.8Z"] },
  ppe: { color: "#F87171", paths: ["M2 18h20", "M4 18v-2a8 8 0 0 1 16 0v2", "M10 9V5h4v4"] },
  other: { color: "#A1A1AA", paths: ["M21 8 12 3 3 8v8l9 5 9-5Z", "m3 8 9 5 9-5", "M12 13v8"] },
};

/** Which look a product gets, from its category (live and older category ids) and SKU. */
export function lookFor(category: string | null | undefined, sku?: string | null, name?: string | null): keyof typeof LOOKS {
  const c = (category ?? "").toLowerCase();
  const s = (sku ?? "").toUpperCase();
  if (/^ISO\b|^ISO-|^ALPHA-ISO|HUNTSMAN-ISO/.test(s) || /\bISO\b.*A-?Side|\bpMDI\b|Alpha AP ISO/i.test(name ?? "")) return "iso";
  if (c.includes("foam") && !c.includes("gun")) return "foam";
  if (c.includes("gun-foam") || c === "gunfoam") return "gunfoam";
  if (c.includes("gun")) return "guns";
  if (c.includes("fiberglass") || c.includes("batts")) return "fiberglass";
  if (c.includes("intumescent")) return "intumescent";
  if (c.includes("roof")) return "roof";
  if (c.includes("seal") || c.includes("adhes")) return "sealants";
  if (c.includes("tool")) return "tools";
  if (c.includes("fasten")) return "fasteners";
  if (c.includes("tape")) return "tape";
  if (c.includes("plastic") || c.includes("net")) return "plastic";
  if (c.includes("clean")) return "cleaning";
  if (c.includes("ppe") || c.includes("protect") || c.includes("safety")) return "ppe";
  if (c.includes("ins")) return "supplies";
  if (/^AMB|^ALPHA|^AMBI/.test(s)) return "foam";
  return "other";
}

/** The colored square with the category's icon. */
export function CatIcon({ look, size = 40 }: { look: keyof typeof LOOKS; size?: number }) {
  const l = LOOKS[look] ?? LOOKS.other;
  return (
    <span className="cat-ic" style={{ width: size, height: size, color: l.color, borderRadius: Math.round(size * 0.3) }} aria-hidden="true">
      <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {l.paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  );
}
