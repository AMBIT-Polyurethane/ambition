"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Circle } from "lucide-react";
import { pwCheck, type PwCheck } from "@/lib/password";

const WORDS = {
  en: { len: "8+ characters", upper: "Uppercase (A)", lower: "Lowercase (a)", digit: "Number (1)", symbol: "Symbol (! # $)" },
  es: { len: "8+ caracteres", upper: "Mayúscula (A)", lower: "Minúscula (a)", digit: "Número (1)", symbol: "Símbolo (! # $)" },
  zh: { len: "至少 8 个字符", upper: "大写字母 (A)", lower: "小写字母 (a)", digit: "数字 (1)", symbol: "符号 (! # $)" },
} as const;

/** A live checklist under a new-password box: each part turns green as it's met. Put it right after the input. */
export function PwRules({ name = "password", lang = "en", tone = "light" }: { name?: string; lang?: "en" | "es" | "zh"; tone?: "light" | "dark" }) {
  const ref = useRef<HTMLUListElement>(null);
  const [c, setC] = useState<PwCheck>(pwCheck(""));
  useEffect(() => {
    const form = ref.current?.closest("form");
    const input = form?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) return;
    const on = () => setC(pwCheck(input.value));
    input.addEventListener("input", on);
    on();
    return () => input.removeEventListener("input", on);
  }, [name]);
  const w = WORDS[lang] ?? WORDS.en;
  return (
    <ul ref={ref} className={`pw-rules ${tone}`} aria-live="polite">
      {(["len", "upper", "lower", "digit", "symbol"] as const).map((k) => (
        <li key={k} className={c[k] ? "ok" : undefined}>
          {c[k] ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />} {w[k]}
        </li>
      ))}
    </ul>
  );
}
