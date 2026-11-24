"use client";

import { usePathname, useRouter } from "next/navigation";

/** Admins: whose hub to look at. */
export function RepPicker({ reps, value, me }: { reps: { id: string; name: string }[]; value: string; me: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <select className="select sm" value={value} onChange={(e) => router.push(`${path}?rep=${e.target.value}`)} aria-label="Whose sales" style={{ width: 200 }}>
      <option value="all">Everyone</option>
      {!reps.some((r) => r.id === me) ? <option value={me}>Me</option> : null}
      {reps.map((r) => <option key={r.id} value={r.id}>{r.id === me ? `${r.name} (me)` : r.name}</option>)}
    </select>
  );
}
