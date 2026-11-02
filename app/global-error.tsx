"use client";

import { useEffect } from "react";
import { reloadOnce, staleKind } from "@/lib/stale-app";

/**
 * Last-resort screen when even the app's frame can't draw. Without this, the browser shows a nearly
 * blank black page. Styled inline because the app's styles may not have loaded.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const kind = staleKind(error);
  useEffect(() => {
    console.error(error);
    if (kind === "chunk") reloadOnce();
  }, [error, kind]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#0a0a0b", color: "#f4f4f5", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 14 }}>
          <div style={{ fontWeight: 900, letterSpacing: 2, fontSize: 22 }}>AMBIT <span style={{ color: "#E33527" }}>A.I.</span></div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{kind ? "AMBIT A.I. was just updated" : "Something went wrong"}</h1>
          <p style={{ margin: 0, color: "#a1a1aa", lineHeight: 1.5 }}>
            {kind === "action"
              ? "This page was opened before the update, so that last change didn't save. Tap Reload to get the new version, then do it again."
              : kind === "chunk"
                ? "Loading the new version…"
                : "Tap Reload to try again. If it keeps happening, check your connection or tell an admin what you were doing."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ justifySelf: "center", background: "#E33527", color: "#fff", border: 0, borderRadius: 999, padding: "12px 28px", fontWeight: 800, letterSpacing: 1, fontSize: 14, cursor: "pointer" }}
          >
            RELOAD
          </button>
          <a href="/" style={{ color: "#a1a1aa", fontSize: 14 }}>Go home</a>
        </div>
      </body>
    </html>
  );
}
