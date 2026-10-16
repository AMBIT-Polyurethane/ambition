import "server-only";
import { headers } from "next/headers";
import { siteUrl } from "@/lib/env";

// The address the person is using right now (works for preview deployments too).
export async function currentOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // not in a request
  }
  return siteUrl();
}

export function safeNext(next: unknown, fallback = "/"): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : fallback;
}
