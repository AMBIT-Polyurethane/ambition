"use client";

import { useEffect } from "react";
import { BrandImg } from "@/components/brand";
import { reloadOnce, staleKind } from "@/lib/stale-app";

/**
 * Something on a page failed. The usual reason with an app this new: it was updated while the page was
 * open, so the old page's Save button or code no longer exists. Then say so plainly and reload into the
 * new version, instead of a dead end. Anything else: a clear message and a real reload.
 */
export default function ErrorPage({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const kind = staleKind(error);
  useEffect(() => {
    console.error(error);
    // Moving to another page with old code: nothing was being saved, so just load the new version.
    if (kind === "chunk") reloadOnce();
  }, [error, kind]);

  return (
    <main className="auth">
      <div className="col" style={{ gap: 16, marginTop: 80, alignItems: "center", textAlign: "center", maxWidth: 420, marginInline: "auto" }}>
        <BrandImg art="atom-mark" width={80} height={80} />
        {kind ? (
          <>
            <h1 className="h1">AMBIT A.I. was just updated</h1>
            <p className="muted">
              {kind === "action"
                ? "This page was opened before the update, so that last change didn't save. Tap Reload to get the new version, then do it again."
                : "Loading the new version…"}
            </p>
          </>
        ) : (
          <>
            <h1 className="h1">Something went wrong</h1>
            <p className="muted">Tap Reload to try again. If it keeps happening, check your connection or tell an admin what you were doing.</p>
          </>
        )}
        <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        <a href="/" className="linkbtn small">Go home</a>
      </div>
    </main>
  );
}
