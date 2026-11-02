import "server-only";
import { AGING_DAYS, EXPIRING_DAYS, PRICE_FROM, suggestedRop, type Hub } from "@/lib/inventory/hub";

// The Inventory Hub reports: one table each, shown on screen and downloaded as CSV.

export const REPORTS = [
  { key: "reorder", label: "Reorder", hint: "Items at or under their reorder point, what to order, and suggested reorder points from what's selling." },
  { key: "expiring", label: "Expiring lots", hint: `Every lot in stock, foam and everything tracked by lot, the soonest to expire first (${EXPIRING_DAYS} days or less highlighted).` },
  { key: "aging", label: "Aging stock", hint: `Stock that hasn't sold lately: put the ${AGING_DAYS}+ day items on sale before they sit on the books.` },
  { key: "movement", label: "Movement", hint: "What sold, came in and moved between locations in the last 90 days." },
  { key: "value", label: "Stock value", hint: "What's on hand and what it would sell for (estimate), by item and group." },
  { key: "counts", label: "Counts", hint: "Spot checks and reconciliations in the last 90 days: how many lines matched and the difference." },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];

export type Cell = string | number | null;
export type Report = { key: ReportKey; title: string; head: string[]; num: boolean[]; rows: Cell[][]; flag: (boolean | "err")[]; total?: Cell[]; note?: string };

const r2 = (v: number) => Math.round(v * 100) / 100;
const usd = (v: number | null) => (v === null ? null : r2(v));

export function buildReport(hub: Hub, key: ReportKey): Report {
  const loc = (id: string) => hub.branches.find((b) => b.id === id)?.name ?? id.toUpperCase();
  const title = REPORTS.find((r) => r.key === key)?.label ?? key;

  if (key === "reorder") {
    const rows = hub.items
      .filter((i) => i.rop !== null || suggestedRop(i) !== null)
      .map((i) => {
        const low = i.rop !== null && i.net <= i.rop;
        const order = low && i.max !== null ? Math.max(0, i.max - i.net) : null;
        return { i, low, order };
      })
      .sort((a, z) => Number(z.low) - Number(a.low) || a.i.branch.localeCompare(z.i.branch) || a.i.sku.localeCompare(z.i.sku));
    return {
      key,
      title,
      head: ["Location", "SKU", "Item", "Unit", "On hand", "Pending pickup", "Net available", "Reorder point", "Max", "Order", "Sold (90 days)", "Suggested reorder point"],
      num: [false, false, false, false, true, true, true, true, true, true, true, true],
      rows: rows.map(({ i, order }) => [loc(i.branch), i.sku, i.name, i.unit, r2(i.on_hand), r2(i.pending), r2(i.net), i.rop, i.max, order, r2(i.sold90), suggestedRop(i)]),
      flag: rows.map((x) => x.low),
      note: "Reorder points and max are set on each location's COUNT SHEET (Reorder Point and Max columns). Suggested reorder point = about 3 weeks of what sold in the last 90 days.",
    };
  }

  if (key === "expiring") {
    const rows = hub.lots;
    return {
      key,
      title,
      head: ["Location", "SKU", "Product", "Lot / Batch #", "Mfg", "Exp", "Use by", "Days left", "In stock", "Value"],
      num: [false, false, false, false, false, false, false, true, true, true],
      rows: rows.map((l) => [loc(l.branch), l.sku, l.name, l.lot_no, l.mfg, l.exp, l.use_by, l.days, l.estimated ? `~${r2(l.remaining)}` : r2(l.remaining), usd(l.value)]),
      flag: rows.map((l) => (l.days !== null && l.days < 0 ? "err" : l.days !== null && l.days <= EXPIRING_DAYS)),
      total: ["Total", "", "", "", "", "", "", "", r2(rows.reduce((s, l) => s + l.remaining, 0)), usd(rows.reduce((s, l) => s + l.value, 0))],
      note: "Spray foam: use by = the Exp date, or 12 months after the Mfg date; expired foam lots are never picked for orders automatically. Other items (~): lots logged at receiving; what's left of each is estimated by assuming the oldest went out first.",
    };
  }

  if (key === "aging") {
    const rows = hub.items.filter((i) => i.on_hand > 0).sort((a, z) => z.idle - a.idle || z.value - a.value);
    return {
      key,
      title,
      head: ["Location", "SKU", "Item", "Group", "On hand", "Value", "Last sale", "Days with no sale", "Oldest lot made"],
      num: [false, false, false, false, true, true, false, true, false],
      rows: rows.map((i) => [loc(i.branch), i.sku, i.name, i.category, r2(i.on_hand), usd(i.value), i.lastSale ?? `none since ${hub.trackingStart[i.branch] ?? ""}`, i.idle, i.oldestMfg]),
      flag: rows.map((i) => i.idle >= AGING_DAYS),
      total: ["Total", "", "", "", "", usd(rows.reduce((s, i) => s + i.value, 0)), "", "", ""],
      note: `Days since the item last sold at that location (completed or open orders), or since the app started tracking there if it hasn't sold since. ${AGING_DAYS}+ days are highlighted: good candidates for a sale.`,
    };
  }

  if (key === "movement") {
    const rows = [...hub.moves].sort((a, z) => z.soldValue90 - a.soldValue90 || z.sold90 - a.sold90);
    return {
      key,
      title,
      head: ["Location", "SKU", "Item", "Unit", "Sold (30 days)", "Sold (90 days)", "Sales $ (90 days)", "Received (90 days)", "Transfers in", "Transfers out"],
      num: [false, false, false, false, true, true, true, true, true, true],
      rows: rows.map((m) => [loc(m.branch), m.sku, m.name, m.unit, r2(m.sold30), r2(m.sold90), usd(m.soldValue90), r2(m.received90), r2(m.transferIn90), r2(m.transferOut90)]),
      flag: rows.map(() => false),
      total: ["Total", "", "", "", "", "", usd(rows.reduce((s, m) => s + m.soldValue90, 0)), "", "", ""],
      note: "Sold = completed orders. Received = Receiving Reports and expected deliveries marked received.",
    };
  }

  if (key === "value") {
    const rows = hub.items.filter((i) => i.on_hand > 0).sort((a, z) => a.category.localeCompare(z.category) || z.value - a.value);
    return {
      key,
      title,
      head: ["Location", "Group", "SKU", "Item", "On hand", "Unit", "Value each", "Value from", "Value"],
      num: [false, false, false, false, true, false, true, false, true],
      rows: rows.map((i) => [loc(i.branch), i.category, i.sku, i.name, r2(i.on_hand), i.unit, i.price === null ? "no value" : usd(i.price), i.priceFrom ? PRICE_FROM[i.priceFrom] : "", usd(i.value)]),
      flag: rows.map((i) => i.price === null),
      total: ["Total", "", "", "", "", "", "", "", usd(rows.reduce((s, i) => s + i.value, 0))],
      note: "An estimate of what the stock would sell for. Value each = the item's List value (Inventory Hub > List values); if it has none, the Sell Price on the location's COUNT SHEET; else the catalog price. Highlighted items have none of these, so they aren't in the total.",
    };
  }

  // counts
  const rows = hub.counts;
  return {
    key: "counts",
    title,
    head: ["Location", "Day", "Kind", "Status", "Lines counted", "Matched", "Off", "Difference (units)", "Difference ($)", "Accuracy %"],
    num: [false, false, false, false, true, true, true, true, true, true],
    rows: rows.map((c) => [loc(c.branch), c.day, c.kind === "spot" ? "Spot check" : "Reconciliation", c.status, c.lines, c.exact, c.off, r2(c.varianceUnits), usd(c.varianceValue), c.lines ? Math.round((c.exact / c.lines) * 1000) / 10 : null]),
    flag: rows.map((c) => c.off > 0),
    note: "Difference = counted minus what the app had when it was counted.",
  };
}

/** CSV text for a report (Excel opens it). */
export function reportCsv(r: Report): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.head.map(esc).join(","), ...r.rows.map((row) => row.map(esc).join(","))];
  if (r.total) lines.push(r.total.map(esc).join(","));
  return lines.join("\r\n");
}
