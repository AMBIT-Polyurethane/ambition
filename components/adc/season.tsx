import { Snowflake, Sun } from "lucide-react";
import type { Season } from "@/lib/adc-season";
import { dict, type Lang } from "@/lib/adc-i18n";

/** The little snowflake (winter blend) or sun (summer blend) on a spray foam photo. */
export function SeasonChip({ season, lang = "en", big = false }: { season: Season | null; lang?: Lang; big?: boolean }) {
  if (!season) return null;
  const t = dict(lang);
  return (
    <span className={`adc-season ${season}${big ? " big" : ""}`} title={season === "winter" ? t.winterBlend : t.summerBlend}>
      {season === "winter" ? <Snowflake size={big ? 18 : 15} strokeWidth={2.4} aria-hidden="true" /> : <Sun size={big ? 18 : 15} strokeWidth={2.4} aria-hidden="true" />}
      <span>{season === "winter" ? t.winterBlend : t.summerBlend}</span>
    </span>
  );
}

