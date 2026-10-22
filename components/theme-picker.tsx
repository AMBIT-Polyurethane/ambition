"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorSmartphone, Moon, Sun } from "lucide-react";
import { THEME_COLOR, THEME_COOKIE, type Theme } from "@/lib/theme";

const OPTIONS: [Theme, string, typeof Moon][] = [
  ["dark", "Dark", Moon],
  ["light", "Light", Sun],
  ["system", "Auto", MonitorSmartphone],
];

/** Profile > Appearance. Changes the look right away and remembers it on this device. */
export function ThemePicker({ current }: { current: Theme }) {
  const [theme, setTheme] = useState<Theme>(current);
  const router = useRouter();

  const choose = (t: Theme) => {
    setTheme(t);
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.theme = t;
    const light = t === "light" || (t === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", light ? THEME_COLOR.light : THEME_COLOR.dark));
    router.refresh();
  };

  return (
    <section className="section">
      <div className="eyebrow">Appearance</div>
      <div className="seg theme" role="radiogroup" aria-label="Appearance">
        {OPTIONS.map(([id, label, Ic]) => (
          <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? "on" : ""} onClick={() => choose(id)}>
            <Ic size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        {theme === "system" ? "Auto matches your phone or computer's light or dark setting." : "Saved on this device. Auto matches your phone or computer's setting."}
      </p>
    </section>
  );
}
