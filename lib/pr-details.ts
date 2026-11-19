/** The parts of an in-app price request an approver can fix after it's answered (0092). */
export const DETAIL_KEYS = ["legal_name", "contact_first", "contact_last", "email", "phone", "street", "city", "state", "zip", "valid_until", "note"] as const;
export type PrDetails = Record<(typeof DETAIL_KEYS)[number], string>;
