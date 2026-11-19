import Link from "next/link";
import { Icon } from "@/components/icons";

export type Tile = { key: string; href?: string; icon: string; title: string; sub?: string | null; badge?: number; soon?: string };

/** A section of big tap targets: icon, name, one short line. Used by Admin and Reports. */
export function TileSection({ title, tiles }: { title: string; tiles: Tile[] }) {
  if (!tiles.length) return null;
  return (
    <section className="tg-sec" aria-label={title}>
      <b className="tg-h">{title}</b>
      <div className="tg-grid">{tiles.map((t) => <TileCard key={t.key} t={t} />)}</div>
    </section>
  );
}

export function TileCard({ t }: { t: Tile }) {
  const inner = (
    <>
      <span className="tg-ic" aria-hidden="true"><Icon name={t.icon} size={20} /></span>
      <span className="tg-b">
        <b>{t.title}</b>
        {t.soon ? <span>Coming soon</span> : t.sub ? <span>{t.sub}</span> : null}
      </span>
      {t.badge ? <span className="tg-badge" aria-label={`${t.badge} waiting`}>{t.badge}</span> : null}
    </>
  );
  return t.href && !t.soon ? (
    <Link href={t.href} className="tg-tile">{inner}</Link>
  ) : (
    <div className="tg-tile soon" aria-disabled="true" title={t.soon}>{inner}</div>
  );
}
