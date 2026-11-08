// Reading a card statement download (Chase: Accounts > the card > Download account activity > CSV).
// Chase's file: Card, Transaction Date, Post Date, Description, Category, Type, Amount, Memo. Purchases are
// negative there; payments and returns are positive. Other banks' columns are close enough that this reads
// them too (Date / Debit / Credit / Card Member...).

export type StatementLine = {
  card: string | null; // last 4
  member: string | null; // the cardholder's name, when the bank says
  txn_date: string; // YYYY-MM-DD
  post_date: string | null;
  description: string;
  bank_category: string | null;
  kind: "purchase" | "return" | "fee" | "payment" | "other";
  amount: number; // positive = money spent
  /** Same line in the same file: how many came before it (two identical coffees on one day). */
  seq: number;
};

export type StatementRead = { lines: StatementLine[]; cards: string[]; hasCard: boolean; from: string | null; to: string | null; skipped: number; problem: string | null };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function day(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}
function num(s: string): number | null {
  const v = s.trim().replace(/[$,\s]/g, "");
  if (!v) return null;
  const neg = /^\(.*\)$/.test(v);
  const n = Number(v.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const find = (head: string[], ...names: RegExp[]) => {
  for (const re of names) {
    const i = head.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export function readStatement(text: string): StatementRead {
  const rows = parseCsv(text);
  const empty: StatementRead = { lines: [], cards: [], hasCard: false, from: null, to: null, skipped: 0, problem: null };
  if (rows.length < 2) return { ...empty, problem: "That file is empty." };
  // The header is the first row that names a date and a description.
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /description|merchant|payee|details/i.test(c)));
  if (hi < 0) return { ...empty, problem: "That doesn't look like a card statement download (no Date and Description columns). In Chase, choose Download account activity, then CSV." };
  const head = rows[hi].map((h) => h.trim().toLowerCase());
  const iDate = find(head, /^transaction date$/, /^trans\.? date$/, /^date$/, /date/);
  const iPost = find(head, /^post(ing)? date$/);
  const iDesc = find(head, /^description$/, /merchant/, /payee/, /description/);
  const iAmt = find(head, /^amount$/, /amount/);
  const iDebit = find(head, /^debit/);
  const iCredit = find(head, /^credit/);
  const iType = find(head, /^type$/, /transaction type/);
  const iCat = find(head, /^category$/);
  const iCard = find(head, /^card$/, /^card ?(no|number|#|ending)/, /last ?4/, /^account ?(#|no|number)?\.?$/);
  const iMember = find(head, /card ?member/, /cardholder/, /^name$/);
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && iDebit < 0)) return { ...empty, problem: "Couldn't find the Date, Description and Amount columns in that file." };

  type Raw = Omit<StatementLine, "seq" | "kind" | "amount"> & { amt: number; type: string };
  const raw: Raw[] = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const d = day(r[iDate] ?? "");
    let amt: number | null = iAmt >= 0 ? num(r[iAmt] ?? "") : null;
    if (amt === null && iDebit >= 0) {
      const de = num(r[iDebit] ?? "");
      const cr = iCredit >= 0 ? num(r[iCredit] ?? "") : null;
      amt = de ? -Math.abs(de) : cr ? Math.abs(cr) : null;
    }
    const desc = (r[iDesc] ?? "").trim().replace(/\s+/g, " ");
    if (!d || amt === null || !desc) {
      skipped++;
      continue;
    }
    const cardRaw = iCard >= 0 ? (r[iCard] ?? "").replace(/\D/g, "") : "";
    raw.push({
      card: cardRaw.length >= 4 ? cardRaw.slice(-4) : null,
      member: iMember >= 0 ? (r[iMember] ?? "").trim() || null : null,
      txn_date: d,
      post_date: iPost >= 0 ? day(r[iPost] ?? "") : null,
      description: desc.slice(0, 300),
      bank_category: iCat >= 0 ? (r[iCat] ?? "").trim().slice(0, 80) || null : null,
      amt,
      type: iType >= 0 ? (r[iType] ?? "").trim().toLowerCase() : "",
    });
  }
  if (!raw.length) return { ...empty, skipped, problem: "No charges were found in that file." };

  // Which way round are purchases? Chase: negative. Some banks: positive.
  const sales = raw.filter((x) => x.type === "sale" || x.type === "purchase");
  const vote = raw.filter((x) => !/payment|thank you|autopay/i.test(x.description));
  const negSpend = sales.length ? sales.filter((x) => x.amt < 0).length >= sales.length / 2 : vote.filter((x) => x.amt < 0).length >= vote.filter((x) => x.amt > 0).length;

  const seen = new Map<string, number>();
  const lines: StatementLine[] = raw.map((x) => {
    const spent = Math.round((negSpend ? -x.amt : x.amt) * 100) / 100;
    const t = x.type;
    const looksPayment = /payment|thank you|autopay|automatic pay/i.test(x.description);
    const kind: StatementLine["kind"] =
      t === "sale" || t === "purchase" || t === "debit"
        ? "purchase"
        : t === "return" || t === "refund"
          ? "return"
          : t === "payment"
            ? "payment"
            : t === "fee" || t === "interest"
              ? "fee"
              : t === "adjustment"
                ? "other"
                : spent > 0
                  ? /\bfee\b|interest charge/i.test(x.description) ? "fee" : "purchase"
                  : looksPayment
                    ? "payment"
                    : "return";
    const key = `${x.card}|${x.txn_date}|${x.post_date}|${x.description}|${spent}`;
    const seq = seen.get(key) ?? 0;
    seen.set(key, seq + 1);
    return { card: x.card, member: x.member, txn_date: x.txn_date, post_date: x.post_date, description: x.description, bank_category: x.bank_category, kind, amount: spent, seq };
  });
  const dates = lines.map((l) => l.txn_date).sort();
  return {
    lines,
    cards: [...new Set(lines.map((l) => l.card).filter((c): c is string => Boolean(c)))].sort(),
    hasCard: iCard >= 0 && lines.some((l) => l.card),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    skipped,
    problem: null,
  };
}

/** The same line always gets the same fingerprint, so uploading a file twice adds nothing twice. */
export const lineKey = (l: StatementLine, card: string | null) => `csv|${card ?? ""}|${l.txn_date}|${l.post_date ?? ""}|${l.description.toUpperCase()}|${l.amount.toFixed(2)}|${l.seq}`;

/** "SQ *JOE'S COFFEE 0123 AUSTIN TX" -> "Joe's Coffee". Good enough to show on a phone. */
export function merchantName(desc: string): string {
  let d = desc.replace(/^(SQ|TST|SP|PY|PAYPAL|DD|IN|PP)\s*\*\s*/i, "").replace(/\s{2,}.*$/, "");
  d = d.replace(/\s+#?\d{3,}.*$/, "").replace(/[,\s]+[A-Z]{2}$/, "").replace(/\*.*$/, "").replace(/[,\s]+$/, "").trim();
  if (!d) d = desc;
  return d
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/'S\b/g, "'s")
    .slice(0, 60);
}
