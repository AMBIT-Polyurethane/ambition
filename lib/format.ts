export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function orderNo(n: number): string {
  return `ORD-${n}`;
}

export function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}

export function firstName(name: string | null | undefined, email?: string | null): string {
  if (name && name.trim()) return name.trim().split(/\s+/)[0];
  if (email) {
    const local = email.split("@")[0].split(/[._-]/)[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "there";
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
}

export function greeting(): string {
  const h = Number(
    new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }),
  );
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const NO_PLURAL = /^(each|ea|ft|lb|lbs|oz|gal|in|sq ?ft|bf|pcs|pc|units?)$/i;

export function plural(unit: string, q: number): string {
  if (q === 1 || NO_PLURAL.test(unit) || /s$/i.test(unit)) return unit;
  if (/(x|ch|sh)$/i.test(unit)) return unit + "es";
  return unit + "s";
}

export function qtyText(qty: number, unit: string): string {
  const q = Number(qty);
  return `${q % 1 === 0 ? q.toFixed(0) : q} ${plural(unit, q)}`;
}

export const DELIVERY_LABEL: Record<string, string> = {
  pickup: "Branch pickup",
  jobsite: "Deliver to job site",
  dropship: "Drop ship",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function escapeHtml(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Search text that is safe to drop into a PostgREST or() filter.
export function searchSafe(q: string | undefined): string {
  return (q ?? "").replace(/[,()%*\\"':]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
