"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" className="b2 sm" onClick={() => window.print()}>
      <Printer size={16} /> Print
    </button>
  );
}
