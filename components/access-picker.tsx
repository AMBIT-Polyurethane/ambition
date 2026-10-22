"use client";

import { useState } from "react";
import { PERMS, ROLES, type Perm } from "@/lib/access";

type Props = {
  role: "customer" | "employee" | "admin";
  jobRole: string | null;
  perms: string[];
  ambit: boolean;
  isMe: boolean;
};

/**
 * Admin > Accounts: account type, job role and the checkboxes for what someone sees.
 * Picking a job role ticks that role's boxes; the boxes can then be changed one by one.
 */
export function AccessPicker({ role: startRole, jobRole: startJob, perms: startPerms, ambit, isMe }: Props) {
  const [role, setRole] = useState(startRole);
  const [job, setJob] = useState(startRole === "admin" ? "admin" : startJob ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(startRole === "admin" ? PERMS.map((p) => p.key) : startPerms));

  const pickJob = (key: string) => {
    setJob(key);
    const preset = ROLES.find((r) => r.key === key);
    if (preset) setPerms(new Set(preset.perms as readonly Perm[]));
    if (key === "admin") setRole("admin");
    else if (role === "admin") setRole("employee");
  };
  const pickType = (r: Props["role"]) => {
    setRole(r);
    if (r === "admin") pickJob("admin");
    else if (job === "admin") {
      setJob("");
      setPerms(new Set());
    }
  };
  const toggle = (k: string) =>
    setPerms((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const staff = role !== "customer";

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label className="field">
          <span className="label">Account type</span>
          <select className="select sm" name="role" value={role} onChange={(e) => pickType(e.target.value as Props["role"])} disabled={isMe}>
            <option value="customer">Contractor</option>
            <option value="employee" disabled={!ambit}>AMBIT staff{ambit ? "" : " (needs @ambitpu.com)"}</option>
            <option value="admin" disabled={!ambit}>Admin{ambit ? "" : " (needs @ambitpu.com)"}</option>
          </select>
          {isMe ? <input type="hidden" name="role" value={role} /> : null}
        </label>
        {staff ? (
          <label className="field">
            <span className="label">Job role</span>
            <select className="select sm" name="job_role" value={job} onChange={(e) => pickJob(e.target.value)} disabled={role === "admin"}>
              <option value="">Pick a role…</option>
              {ROLES.filter((r) => r.key !== "admin" || role === "admin").map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            {role === "admin" ? <input type="hidden" name="job_role" value="admin" /> : null}
          </label>
        ) : null}
      </div>

      {staff ? (
        <fieldset className="access-boxes" disabled={role === "admin"}>
          <legend className="label">What they see {role === "admin" ? "(admins see everything)" : ""}</legend>
          {PERMS.map((p) => (
            <label key={p.key} className="check small">
              <input type="checkbox" name="perms" value={p.key} checked={perms.has(p.key)} onChange={() => toggle(p.key)} />
              <span>
                {p.label}
                {p.hint ? <span className="faint"> · {p.hint}</span> : null}
              </span>
            </label>
          ))}
          <span className="tiny faint">Everyone on the AMBIT team also sees product docs, tech bulletins, Academy, the directory and branches.</span>
        </fieldset>
      ) : null}
      {staff && !job && role !== "admin" ? <span className="tiny warn-text">Pick a job role so they see the right things.</span> : null}
    </div>
  );
}
