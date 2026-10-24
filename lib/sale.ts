// Sale prices. A product is on sale while it has a sale price, through its last day if one is set.
// Days are AMBIT's days (Central time), the same rule the database uses when it prices an order.

export function todayCentral(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function saleOn(price: number | string | null | undefined, ends: string | null | undefined, today = todayCentral()): boolean {
  if (price === null || price === undefined || price === "" || !Number.isFinite(Number(price))) return false;
  return !ends || ends >= today;
}
