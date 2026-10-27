"use client";

import { useState } from "react";

/** "Select all": ticks every checkbox named `name` that belongs to `form` (they can sit anywhere on the page). */
export function CheckAll({ form, name, label = "All on this page" }: { form: string; name: string; label?: string }) {
  const [on, setOn] = useState(false);
  return (
    <label className="check" style={{ whiteSpace: "nowrap" }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"][form="${form}"]`).forEach((b) => {
            b.checked = e.target.checked;
          });
        }}
      />{" "}
      {label}
    </label>
  );
}
