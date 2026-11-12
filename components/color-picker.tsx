"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Palette, RotateCcw } from "lucide-react";
import { AMBIT_RED, PRESETS, colorsCss, readColors, type UserColors } from "@/lib/theme-colors";
import { saveColors } from "@/app/(app)/profile/actions";

/** Profile > Colors: a preset (AMBIT, Blush, Lavender...) or any color from the wheel, plus a soft background. */
export function ColorPicker({ current }: { current: UserColors | null }) {
  const router = useRouter();
  const [accent, setAccent] = useState(current?.accent ?? AMBIT_RED);
  const [soft, setSoft] = useState(current?.soft ?? false);
  const [preset, setPreset] = useState<string | null>(current?.preset ?? (current ? null : "ambit"));
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wheel = useRef<HTMLInputElement>(null);

  // Live preview: the page changes as you pick.
  useEffect(() => {
    let tag = document.getElementById("user-colors") as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "user-colors";
      document.head.appendChild(tag);
    }
    tag.textContent = colorsCss(readColors({ accent, soft, preset }));
  }, [accent, soft, preset]);

  const pick = (p: (typeof PRESETS)[number]) => {
    setAccent(p.accent);
    setSoft(p.soft);
    setPreset(p.key);
    setSaved(false);
  };
  async function save() {
    setBusy(true);
    setErr(null);
    const isDefault = accent.toUpperCase() === AMBIT_RED && !soft;
    const res = await saveColors(isDefault ? null : { accent, soft, preset });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="section">
      <div className="eyebrow">Colors</div>
      <div className="card col" style={{ gap: 12 }}>
        <div className="color-swatches" role="radiogroup" aria-label="Color presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={preset === p.key}
              className={`swatch${preset === p.key ? " on" : ""}`}
              onClick={() => pick(p)}
              title={p.name}
            >
              <span className="sw-dot" style={{ background: p.soft ? `linear-gradient(135deg, ${p.accent} 0 55%, color-mix(in srgb, ${p.accent} 12%, #fff) 55%)` : p.accent }}>
                {preset === p.key ? <Check size={15} strokeWidth={3} /> : null}
              </span>
              <span className="tiny">{p.name}</span>
            </button>
          ))}
          <button type="button" className={`swatch${preset === null ? " on" : ""}`} onClick={() => wheel.current?.click()} title="Any color">
            <span className="sw-dot wheel">{preset === null ? <Check size={15} strokeWidth={3} /> : <Palette size={15} />}</span>
            <span className="tiny">Any color</span>
          </button>
          <input
            ref={wheel}
            type="color"
            className="sr-only"
            value={accent.toLowerCase()}
            onChange={(e) => (setAccent(e.target.value.toUpperCase()), setPreset(null), setSaved(false))}
            aria-label="Pick any color"
          />
        </div>
        <label className="hue">
          <span className="label">Color wheel</span>
          <input
            type="range"
            min={0}
            max={359}
            value={hueOf(accent)}
            onChange={(e) => (setAccent(fromHue(Number(e.target.value))), setPreset(null), setSaved(false))}
            aria-label="Slide through every color"
          />
        </label>
        <label className="check small">
          <input type="checkbox" checked={soft} onChange={(e) => (setSoft(e.target.checked), setSaved(false))} /> Soft background (a light wash of the color behind everything)
        </label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" disabled={busy || saved} onClick={save}>{busy ? "Saving…" : saved ? "Saved" : "Save my colors"}</button>
          {accent.toUpperCase() !== AMBIT_RED || soft ? (
            <button type="button" className="btn sm dark" onClick={() => pick(PRESETS[0])}><RotateCcw size={14} /> Back to AMBIT red</button>
          ) : null}
        </div>
        {err ? <div className="alert err small"><CircleAlert size={16} style={{ flex: "none" }} /><span>{err}</span></div> : null}
        <p className="tiny faint" style={{ margin: 0 }}>
          Only you see your colors, on every phone and computer you sign in on. The AMBIT logo and layout stay the same. Soft colors like Blush and
          Lavender look their best with Appearance set to Light.
        </p>
      </div>
    </section>
  );
}

/** Hue (0-359) of a color, and a bright, readable color at a hue (for the slider). */
function hueOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
function fromHue(h: number) {
  // HSL(h, 68%, 50%)
  const s = 0.68, l = 0.5;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
