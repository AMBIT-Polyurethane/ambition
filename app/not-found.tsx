import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth">
      <div className="col" style={{ gap: 16, marginTop: 80, alignItems: "center", textAlign: "center" }}>
        <img src="/brand/atom-mark.png" alt="" width={80} height={80} />
        <h1 className="h1">Page not found</h1>
        <p className="muted">That page doesn&apos;t exist or you don&apos;t have access to it.</p>
        <Link href="/" className="btn">Go home</Link>
      </div>
    </main>
  );
}
