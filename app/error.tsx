"use client";

import { BrandImg } from "@/components/brand";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth">
      <div className="col" style={{ gap: 16, marginTop: 80, alignItems: "center", textAlign: "center" }}>
        <BrandImg art="atom-mark" width={80} height={80} />
        <h1 className="h1">Something went wrong</h1>
        <p className="muted">Check your connection and try again.</p>
        <button className="btn" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
