"use client";

import { useState } from "react";
import { DocForm } from "@/components/doc-form";

export function NewDoc() {
  const [key, setKey] = useState(0);
  return <DocForm key={key} onDone={() => setKey((k) => k + 1)} />;
}
