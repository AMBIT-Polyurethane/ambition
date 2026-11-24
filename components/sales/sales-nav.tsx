import Link from "next/link";

/** The tabs across the top of every Sales page. */
export function SalesNav({ on, all, admin }: { on: "hub" | "pipeline" | "dashboard" | "import"; all: boolean; admin: boolean }) {
  const tabs = [
    { key: "hub", href: "/sales", label: "My hub" },
    { key: "pipeline", href: "/sales/pipeline", label: "New-customer pipeline" },
    all && { key: "dashboard", href: "/sales/dashboard", label: "Sales dashboard" },
    admin && { key: "import", href: "/sales/import", label: "Import history" },
  ].filter(Boolean) as { key: string; href: string; label: string }[];
  return (
    <nav className="chips wrap crm-nav" aria-label="Sales">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`chip sm${t.key === on ? " on" : ""}`} aria-current={t.key === on ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
