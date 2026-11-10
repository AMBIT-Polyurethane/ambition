"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAcademyLang } from "@/app/(app)/academy/actions";
import type { AcademyLang } from "@/lib/academy-i18n";

/** English / Español buttons: remembers the choice for this person, then opens the lesson (or course) in that language. */
export function LangSwitch({ lang, enHref, esHref }: { lang: AcademyLang; enHref: string; esHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (l: AcademyLang) => {
    if (l === lang) return;
    start(async () => {
      await setAcademyLang(l);
      router.push(l === "es" ? esHref : enHref);
      router.refresh();
    });
  };
  return (
    <div className="seg sm lang-switch" role="group" aria-label="Language / Idioma">
      <button type="button" className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} disabled={pending} onClick={() => go("en")}>English</button>
      <button type="button" className={lang === "es" ? "on" : ""} aria-pressed={lang === "es"} disabled={pending} onClick={() => go("es")}>Español</button>
    </div>
  );
}
