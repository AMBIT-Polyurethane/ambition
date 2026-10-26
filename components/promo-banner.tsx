"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { money } from "@/lib/format";
import { themeOf, type PromoSlide } from "@/lib/promo-themes";

// The banner at the top of Home. Slides move on their own every few seconds and stop
// for a while whenever someone swipes, taps or points at them. Phones show one slide at a time;
// computers show two or three side by side (globals.css, "Home banner") with arrows to move along.

const EVERY_MS = 5000;
const HOLD_MS = 9000;

function Price({ p }: { p: NonNullable<PromoSlide["price"]> }) {
  if (p.account) return <span className="pr-acct">Priced to your account</span>;
  if (p.now === null) return null;
  const [d, c] = p.now.toFixed(2).split(".");
  return (
    <span className="pr">
      <span className="pr-now" aria-label={money(p.now)}>
        <span className="cur">$</span>
        {Number(d).toLocaleString("en-US")}
        <span className="ct">.{c}</span>
      </span>
      <span className="pr-unit">/ {p.unit}</span>
      {p.was ? <s className="pr-was" aria-label={`was ${money(p.was)}`}>{money(p.was)}</s> : null}
    </span>
  );
}

// The distribution centers map (public/promos/map-south.svg) and where its pins sit, in % of the map.
const DEFAULT_MAP = "/promos/map-south.svg";
const MAP_PINS = [
  { name: "Oklahoma City", x: 31, y: 14, side: "r" },
  { name: "Arlington", x: 33, y: 34, side: "r" },
  { name: "San Marcos", x: 30, y: 55, side: "r" },
  { name: "Mobile", x: 62, y: 49, side: "t" },
  { name: "Jacksonville", x: 82, y: 52, side: "bl" },
];

/** The product picture. Wide pictures (a bag of insulation) get more room. */
function Art({ src }: { src: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [wide, setWide] = useState(false);
  const check = () => {
    const i = ref.current;
    if (i && i.naturalWidth && i.naturalHeight) setWide(i.naturalWidth / i.naturalHeight > 1.25);
  };
  useEffect(() => {
    if (ref.current?.complete) check();
  }, [src]);
  return (
    <span className={`art${wide ? " wide" : ""}`} aria-hidden="true">
      <img ref={ref} src={src} alt="" draggable={false} onLoad={check} />
    </span>
  );
}

export function PromoSlideCard({ s }: { s: PromoSlide }) {
  const t = themeOf(s.theme);
  const sale = !!s.price?.sale;
  const extra = s.eyebrow && !(sale && /sale/i.test(s.eyebrow)) ? s.eyebrow : null;
  const map = s.kind === "locations" && (!s.image || s.image.endsWith(DEFAULT_MAP));
  const body = (
    <>
      {map ? (
        <span className="map" aria-hidden="true">
          <img src={DEFAULT_MAP} alt="" draggable={false} />
          {MAP_PINS.map((p) => (
            <span key={p.name} className={`city ${p.side}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>{p.name}</span>
          ))}
        </span>
      ) : s.image ? (
        <Art src={s.image} />
      ) : null}
      <span className="txt">
        <span className="tags">
          {sale ? <span className="tag sale">Sale</span> : null}
          {extra ? <span className="tag">{extra}</span> : null}
        </span>
        <span className="pt">{s.title}</span>
        {s.subtitle ? <span className="ps">{s.subtitle}</span> : null}
        {s.price ? <Price p={s.price} /> : null}
        {!map && s.cities?.length ? (
          <span className="cities">
            {s.cities.map((c) => (
              <span key={c}><MapPin size={11} strokeWidth={2.6} />{c}</span>
            ))}
          </span>
        ) : null}
      </span>
      {s.href ? (
        <span className="go" aria-hidden="true"><ChevronRight size={18} strokeWidth={2.6} /></span>
      ) : null}
    </>
  );
  const cls = `promo k-${s.kind}`;
  const style = { background: t.bg, ["--glow" as string]: t.glow };
  const label = [s.title, s.price?.sale ? "on sale" : null, s.price?.now != null ? money(s.price.now) : null].filter(Boolean).join(", ");
  if (!s.href) return <div className={cls} style={style}>{body}</div>;
  return s.external ? (
    <a className={cls} style={style} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={label}>{body}</a>
  ) : (
    <Link className={cls} style={style} href={s.href} aria-label={label}>{body}</Link>
  );
}

export function PromoBanner({ slides }: { slides: PromoSlide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const holdUntil = useRef(0);
  const hovering = useRef(false);
  const [at, setAt] = useState(0);
  // How many slides fit side by side (1 on a phone, 2 or 3 on a computer), and so the last
  // position the row can scroll to.
  const [perView, setPerView] = useState(1);
  const last = Math.max(0, slides.length - perView);
  const lastRef = useRef(last);
  lastRef.current = last;

  const kids = () => Array.from(track.current?.children ?? []) as HTMLElement[];
  const nearest = () => {
    const el = track.current;
    const k = kids();
    if (!el || !k.length) return 0;
    const x = el.scrollLeft;
    let best = 0;
    k.forEach((c, i) => {
      if (Math.abs(c.offsetLeft - k[0].offsetLeft - x) < Math.abs(k[best].offsetLeft - k[0].offsetLeft - x)) best = i;
    });
    return Math.min(best, lastRef.current);
  };
  const go = useCallback((i: number, smooth = true) => {
    const el = track.current;
    const k = kids();
    if (!el || !k[i]) return;
    el.scrollTo({ left: k[i].offsetLeft - k[0].offsetLeft, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const hold = () => {
    holdUntil.current = Date.now() + HOLD_MS;
  };

  // How many fit, measured again whenever the window changes size.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) return;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const w = first.getBoundingClientRect().width;
      setPerView(w > 0 ? Math.max(1, Math.round((el.clientWidth + gap) / (w + gap))) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);

  // Which slide is showing (for the dots).
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setAt(nearest()));
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [perView]);

  // Move along one slide every few seconds, back to the start after the last one (not for people
  // who turned off motion on their phone, and not when every slide already fits on screen).
  useEffect(() => {
    if (last < 1) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden || hovering.current || Date.now() < holdUntil.current) return;
      const cur = nearest();
      go(cur >= lastRef.current ? 0 : cur + 1);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [last, go]);

  const step = (d: number) => {
    hold();
    const cur = nearest();
    go(d > 0 ? (cur >= last ? 0 : cur + 1) : cur <= 0 ? last : cur - 1);
  };

  if (!slides.length) return null;
  return (
    <section className="promo-wrap" aria-roledescription="carousel" aria-label="Deals and news from AMBIT">
      <div
        ref={track}
        className="promo-track"
        onPointerDown={hold}
        onTouchStart={hold}
        onWheel={hold}
        onFocus={hold}
        onMouseEnter={() => (hovering.current = true)}
        onMouseLeave={() => {
          hovering.current = false;
          hold();
        }}
      >
        {slides.map((s, i) => (
          <div key={s.id} className="promo-cell" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
            <PromoSlideCard s={s} />
          </div>
        ))}
      </div>
      {last > 0 ? (
        <>
          <button type="button" className="promo-nav prev" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft size={20} strokeWidth={2.4} />
          </button>
          <button type="button" className="promo-nav next" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight size={20} strokeWidth={2.4} />
          </button>
        </>
      ) : null}
      {last > 0 ? (
        <div className="promo-dots" role="tablist" aria-label="Choose a slide">
          {slides.slice(0, last + 1).map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === at}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              className={i === at ? "on" : ""}
              onClick={() => {
                hold();
                go(i);
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
