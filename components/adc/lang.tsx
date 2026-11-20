"use client";

import { createContext, useContext } from "react";
import { LANGS, dict, type AdcDict, type Lang } from "@/lib/adc-i18n";

const C = createContext<Lang>("en");

export function AdcLangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <C.Provider value={lang}>{children}</C.Provider>;
}

/** The shopper's language and the store's words in it. */
export function useAdc(): { lang: Lang; t: AdcDict } {
  const lang = useContext(C);
  return { lang, t: dict(lang) };
}

/** EN · ES · 中文 in the header: switches and comes back to the same page. */
export function AdcLangSwitch() {
  const { lang } = useAdc();
  const go = (l: Lang) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/adc/lang?l=${l}&next=${encodeURIComponent(next)}`;
  };
  return (
    <span className="adc-langs" role="group" aria-label="Language / Idioma / 语言">
      {LANGS.map((l) => (
        <a key={l.id} href={`/adc/lang?l=${l.id}`} onClick={go(l.id)} className={lang === l.id ? "on" : undefined} aria-current={lang === l.id ? "true" : undefined} title={l.name} hrefLang={l.id} lang={l.id}>
          {l.label}
        </a>
      ))}
    </span>
  );
}
