import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// SSNs, bank account and driver's license numbers on forms: encrypted with AES-256-GCM before they reach the
// database, with a key that lives only in Vercel (FORMS_SECRET_KEY). The database never sees them in the clear.

function key(): Buffer {
  const raw = (process.env.FORMS_SECRET_KEY ?? "").trim();
  if (!raw) throw new Error("FORMS_SECRET_KEY isn't set in Vercel yet, so private numbers can't be saved.");
  const b = /^[A-Za-z0-9+/=]{43,44}$/.test(raw) ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  return b.length === 32 ? b : createHash("sha256").update(raw).digest();
}
export const secretsReady = () => Boolean((process.env.FORMS_SECRET_KEY ?? "").trim());

export function seal(values: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(values), "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

export function open(sealed: string | null | undefined): Record<string, string> {
  if (!sealed) return {};
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) return {};
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8"));
}

/** A link a customer can open without signing in: long, random, unguessable. */
export const newToken = () => randomBytes(24).toString("base64url");
