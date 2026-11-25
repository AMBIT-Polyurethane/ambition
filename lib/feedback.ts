// Feedback to Jeremiah (0117): what admins send, and where each one stands.

export const KINDS = [
  { k: "idea", label: "Idea", hint: "Something to build or change" },
  { k: "question", label: "Question", hint: "How something works, or why" },
  { k: "concern", label: "Concern", hint: "A risk you see coming" },
  { k: "problem", label: "Problem", hint: "Something wrong or in the way" },
] as const;
export type Kind = (typeof KINDS)[number]["k"];

export const AREAS = ["Orders", "Pricing", "Sales", "Customers & credit", "Inventory", "Forms", "AMBIT-OPS", "Chat", "Reports", "People & access", "Other"] as const;

export const STATUSES = [
  { k: "new", label: "New", pill: "pill2 sm info" },
  { k: "reading", label: "Looking at it", pill: "pill2 sm warn" },
  { k: "planned", label: "Planned", pill: "pill2 sm ok" },
  { k: "done", label: "Done", pill: "pill2 sm ok" },
  { k: "not_now", label: "Not now", pill: "pill2 sm" },
] as const;
export type Status = (typeof STATUSES)[number]["k"];
export const statusOf = (k: string) => STATUSES.find((s) => s.k === k) ?? STATUSES[0];
export const kindLabel = (k: string) => KINDS.find((x) => x.k === k)?.label ?? "Feedback";

export type FeedbackRow = {
  id: number; kind: Kind; area: string | null; subject: string; body: string; by_id: string | null; by_name: string | null;
  status: Status; reply: string | null; reply_by_name: string | null; replied_at: string | null; seen_reply_at: string | null; created_at: string;
};
