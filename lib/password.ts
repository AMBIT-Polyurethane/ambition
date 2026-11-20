// The password rule (matches Supabase: lowercase, uppercase, digits and symbols, 8 or more characters).
// Used by every form where someone makes or changes a password, on the page and again on the server.

export const PW_MIN = 8;
const SYMBOL = /[!@#$%^&*()_+\-=[\]{};':"\\|<>?,./`~]/;

export type PwCheck = { len: boolean; lower: boolean; upper: boolean; digit: boolean; symbol: boolean };

export function pwCheck(pw: string): PwCheck {
  return { len: pw.length >= PW_MIN, lower: /[a-z]/.test(pw), upper: /[A-Z]/.test(pw), digit: /\d/.test(pw), symbol: SYMBOL.test(pw) };
}

/** True when the password meets every part of the rule. */
export const pwOk = (pw: string) => Object.values(pwCheck(pw)).every(Boolean);

export const PW_RULE_EN = "Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol (like ! or #).";
