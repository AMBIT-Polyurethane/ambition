"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print window ("Save as PDF" is in there too). */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn sm" onClick={() => window.print()}>
      <Printer size={16} /> {label}
    </button>
  );
}
