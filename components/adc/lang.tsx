"use client";

import { createContext, useContext } from "react";
import { dict, type AdcDict, type Lang } from "@/lib/adc-i18n";

const C = createContext<Lang>("en");

export function AdcLangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <C.Provider value={lang}>{children}</C.Provider>;
}

/** The shopper's language and the store's words in it. */
export function useAdc(): { lang: Lang; t: AdcDict } {
  const lang = useContext(C);
  return { lang, t: dict(lang) };
}

/** "Español" / "English" in the header: switches and comes back to the same page. */
export function AdcLangSwitch() {
  const { t, lang } = useAdc();
  const go = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/adc/lang?l=${lang === "es" ? "en" : "es"}&next=${encodeURIComponent(next)}`;
  };
  return (
    <a href={`/adc/lang?l=${lang === "es" ? "en" : "es"}`} onClick={go} className="adc-lang" aria-label={t.langOtherLabel} title={t.langOtherLabel} hrefLang={lang === "es" ? "en" : "es"}>
      <span aria-hidden="true">{lang === "es" ? "EN" : "ES"}</span> {t.langOther}
    </a>
  );
}
