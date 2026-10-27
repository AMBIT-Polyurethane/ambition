// What shows the instant someone taps a link, while the next screen is being put together on the server.
// Shapes only (no text), so it reads as "loading" without a spinner, and works in both themes.

export function PageSkeleton({ variant = "list" }: { variant?: "list" | "home" | "dash" | "detail" }) {
  return (
    <main className="shell skel-page" aria-busy="true" aria-label="Loading">
      <div className="skel-top">
        <span className="skel circle" />
        <span className="skel line" style={{ width: "38%", height: 18 }} />
      </div>
      {variant === "home" ? (
        <>
          <span className="skel line" style={{ width: "60%", height: 26 }} />
          <span className="skel block" style={{ height: 52 }} />
          <div className="skel-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="skel tile" />
            ))}
          </div>
          <span className="skel block" style={{ height: 120 }} />
        </>
      ) : variant === "dash" ? (
        <>
          <div className="skel-row">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="skel block" style={{ height: 84 }} />
            ))}
          </div>
          <div className="skel-two">
            <span className="skel block" style={{ height: 240 }} />
            <span className="skel block" style={{ height: 240 }} />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="skel block" style={{ height: 64 }} />
          ))}
        </>
      ) : variant === "detail" ? (
        <>
          <span className="skel block" style={{ height: 150 }} />
          <span className="skel block" style={{ height: 260 }} />
          <span className="skel block" style={{ height: 110 }} />
        </>
      ) : (
        <>
          <span className="skel block" style={{ height: 46 }} />
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="skel block" style={{ height: 68 }} />
          ))}
        </>
      )}
    </main>
  );
}
