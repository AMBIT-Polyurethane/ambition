// Call lists (0113): Win-back (past customers) and Cold leads (BBB / ConstructConnect), one set per rep.

export type CallList = "winback" | "cold";
export type CallStatus = "new" | "no_answer" | "voicemail" | "talked" | "callback" | "not_interested" | "wrong_number" | "won";
export type Outcome = Exclude<CallStatus, "new">;

export type Call = {
  id: number;
  list: CallList;
  rep_id: string | null;
  rep_name: string | null;
  company_id: string | null;
  lead_id: string | null;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  source: string | null;
  kind_guess: string | null;
  priority: string | null;
  last_invoice: string | null;
  sales_12mo: number | null;
  prev_rep: string | null;
  sheet_note: string | null;
  status: CallStatus;
  next_on: string | null;
  touches: number;
  last_touch_at: string | null;
  last_touch_by: string | null;
  last_note: string | null;
};
export type CallLog = { id: number; call_id: number; outcome: Outcome; note: string | null; next_on: string | null; by_name: string | null; at: string };

export const CALL_COLS =
  "id, list, rep_id, rep_name, company_id, lead_id, name, contact_name, phone, email, street, city, state, zip, source, kind_guess, priority, last_invoice, sales_12mo, prev_rep, sheet_note, status, next_on, touches, last_touch_at, last_touch_by, last_note";

/** The buttons on each row, in order. The last one is the good one. */
export function outcomes(list: CallList): { key: Outcome; label: string; needs?: "date" | "note" }[] {
  return [
    { key: "no_answer", label: "No answer" },
    { key: "voicemail", label: "Voicemail" },
    { key: "talked", label: "Talked", needs: "note" },
    { key: "callback", label: "Call back…", needs: "date" },
    { key: "not_interested", label: list === "cold" ? "Not a fit" : "Not interested", needs: "note" },
    { key: "wrong_number", label: "Wrong number" },
    { key: "won", label: list === "cold" ? "Interested" : "Wants to order", needs: "note" },
  ];
}

export function statusText(c: Pick<Call, "list" | "status" | "next_on">): { label: string; tone: string } {
  switch (c.status) {
    case "new": return { label: "Not called yet", tone: "grey" };
    case "no_answer": return { label: "No answer", tone: "grey" };
    case "voicemail": return { label: "Left a voicemail", tone: "grey" };
    case "talked": return { label: "Talked", tone: "info" };
    case "callback": return { label: c.next_on ? `Call back ${shortDay(c.next_on)}` : "Call back", tone: "warn" };
    case "not_interested": return { label: c.list === "cold" ? "Not a fit" : "Not interested", tone: "grey" };
    case "wrong_number": return { label: "Wrong number", tone: "red" };
    case "won": return { label: c.list === "cold" ? "Interested: in the pipeline" : "Wants to order", tone: "ok" };
  }
}

/** Finished: nothing more to do on this one. */
export const isDone = (c: Pick<Call, "status">) => c.status === "won" || c.status === "not_interested" || c.status === "wrong_number";
/** A call-back that's due (or overdue) today. */
export const isDue = (c: Pick<Call, "status" | "next_on">, today: string) => !isDone(c) && !!c.next_on && c.next_on <= today;

export function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "14 months" since a date, for "last order". */
export function gone(iso: string | null, today: string): string {
  if (!iso) return "No date on file";
  const a = new Date(`${iso.slice(0, 10)}T12:00:00`), b = new Date(`${today}T12:00:00`);
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0);
  if (m < 1) return "Under a month";
  return m === 1 ? "1 month" : `${m} months`;
}
