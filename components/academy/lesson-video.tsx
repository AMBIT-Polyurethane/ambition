"use client";

import { useEffect, useRef, useState } from "react";
import { lookFor, type Theme } from "@/lib/theme";

type Look = "dark" | "light";

/**
 * The lesson video in the look the person uses the app in (0058): Light mode (or Auto on a phone or
 * computer set to light) plays the light copy when the lesson has one; everyone else plays the main video.
 * Changing Appearance, or the phone switching itself to dark at night, swaps the video in place and keeps
 * the spot in the lesson (and keeps playing if it was).
 */
export function LessonVideo({ dark, light, theme }: { dark: string; light: string | null; theme: Theme }) {
  // On the server only the setting is known; "Auto" waits for the browser to say light or dark.
  const [look, setLook] = useState<Look | null>(theme === "system" ? null : theme === "light" ? "light" : "dark");
  const ref = useRef<HTMLVideoElement>(null);
  const spot = useRef({ t: 0, playing: false });

  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const read = () => {
      const v = ref.current;
      if (v && v.currentSrc) spot.current = { t: v.currentTime, playing: !v.paused && !v.ended };
      setLook(lookFor(html.dataset.theme, mq.matches));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    mq.addEventListener("change", read);
    return () => {
      watch.disconnect();
      mq.removeEventListener("change", read);
    };
  }, []);

  const showing: Look = look === "light" && light ? "light" : "dark";
  const src = look == null ? null : showing === "light" ? light : dark;

  // After a swap, pick up where they were.
  const last = useRef<string | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    if (last.current && last.current !== src) {
      const { t, playing } = spot.current;
      const resume = () => {
        if (t > 0) v.currentTime = Math.min(t, Number.isFinite(v.duration) ? v.duration : t);
        if (playing) v.play().catch(() => {});
      };
      v.addEventListener("loadedmetadata", resume, { once: true });
    }
    last.current = src;
  }, [src]);

  return (
    <video
      ref={ref}
      className={`lesson-video${showing === "light" ? " light-look" : ""}`}
      data-look={showing}
      src={src ?? undefined}
      controls
      playsInline
      preload="metadata"
    />
  );
}
