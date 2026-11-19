"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X, ZoomIn } from "lucide-react";

/**
 * A product's photo on white, the same everywhere (stock, the order store, orders). Tap it to see it full screen.
 * No photo yet: a quiet camera placeholder the same size, so rows still line up.
 */
export function ProductPhoto({
  src,
  alt,
  size = 64,
  zoom = true,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  /** Square size in px; "fill" stretches to the parent's width (cards). */
  size?: number | "fill";
  zoom?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const box = size === "fill" ? undefined : { width: size, height: size };
  const cls = `pph${size === "fill" ? " fill" : ""}${className ? ` ${className}` : ""}`;
  if (!src) {
    return (
      <span className={`${cls} empty`} style={box} aria-hidden="true">
        <Camera size={size === "fill" ? 28 : Math.max(14, Math.round(Number(size) / 3.2))} />
      </span>
    );
  }
  if (!zoom) return <img className={cls} style={box} src={src} alt={alt} loading="lazy" decoding="async" />;
  return (
    <>
      <button
        type="button"
        className={`${cls} zoomable`}
        style={box}
        aria-label={`See a bigger photo of ${alt}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} loading="lazy" decoding="async" />
        <span className="pph-zoom" aria-hidden="true"><ZoomIn size={14} /></span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="pph-full" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
              <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
              <button type="button" className="pph-close" aria-label="Close the photo" onClick={() => setOpen(false)}>
                <X size={22} />
              </button>
              <span className="pph-cap">{alt}</span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
