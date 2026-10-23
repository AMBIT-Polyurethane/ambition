"use client";

import { useEffect, useRef, useState } from "react";

/** A signature picture from Jotform; if Jotform won't hand it over, says it was signed instead of a broken image. */
export function SigImage({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // It may have failed before the page finished loading.
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return <span>Signed electronically (the signature is saved in Jotform)</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} className="sig-img" src={src} alt={`Signature: ${label}`} onError={() => setFailed(true)} />;
}
