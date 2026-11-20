"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { useAdc } from "@/components/adc/lang";

/** The product's photos: the main one big, arrows and thumbnails to cycle through the rest (swipe on a phone). */
export function AdcGallery({ images, alt, children }: { images: string[]; alt: string; children?: React.ReactNode }) {
  const { t } = useAdc();
  const [i, setI] = useState(0);
  const x0 = useRef<number | null>(null);
  const n = images.length;
  const go = (d: number) => setI((cur) => (cur + d + n) % n);
  if (n <= 1) {
    return (
      <div className="adc-prod-ph">
        {n ? <img src={images[0]} alt={alt} className="adc-img" /> : null}
        {children}
      </div>
    );
  }
  return (
    <div className="adc-gal">
      <div
        className="adc-prod-ph"
        onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (x0.current === null) return;
          const dx = e.changedTouches[0].clientX - x0.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          x0.current = null;
        }}
      >
        {i === 0 ? (
          <img src={images[i]} alt={alt} className="adc-img" />
        ) : (
          // Data sheet pages: tap to open the page full size (pinch to zoom on a phone).
          <a href={images[i]} target="_blank" rel="noopener noreferrer" className="adc-gal-open" aria-label={t.zoomDoc}>
            <img src={images[i]} alt={`${alt}: ${t.photoOf(i + 1, n)}`} className="adc-img doc" />
            <span className="adc-gal-zoom"><ZoomIn size={15} aria-hidden="true" /> {t.zoomDoc}</span>
          </a>
        )}
        {i === 0 ? children : null}
        <button type="button" className="adc-gal-nav prev" onClick={() => go(-1)} aria-label={t.prevPhoto}><ChevronLeft size={22} /></button>
        <button type="button" className="adc-gal-nav next" onClick={() => go(1)} aria-label={t.nextPhoto}><ChevronRight size={22} /></button>
        <span className="adc-gal-count">{i + 1} / {n}</span>
      </div>
      <div className="adc-gal-thumbs" role="tablist">
        {images.map((src, k) => (
          <button key={src} type="button" role="tab" aria-selected={k === i} className={k === i ? "on" : undefined} onClick={() => setI(k)} aria-label={t.photoOf(k + 1, n)}>
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
