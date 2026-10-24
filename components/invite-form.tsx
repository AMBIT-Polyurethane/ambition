"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, CircleAlert, CircleCheck, Copy, Mail, MessageSquare, RefreshCw, UserPlus } from "lucide-react";
import { createAccount, resendInvite } from "@/app/(app)/admin/users/invite-actions";
import { CustomerPicker } from "@/components/customer-picker";
import { Submit } from "@/components/forms";
import { PERMS, ROLES, type Perm } from "@/lib/access";
import type { InviteResult } from "@/lib/invites";
import type { OrderCustomer } from "@/lib/customers";
import type { Branch } from "@/lib/types";

// Admin → Accounts → Create an account.

export function InviteForm({ customers, branches }: { customers: OrderCustomer[]; branches: Branch[] }) {
  const [state, action] = useActionState<InviteResult, FormData>(createAccount, null);
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<"contractor" | "employee">("contractor");
  const [picked, setPicked] = useState(false); // the admin chose the type themselves
  const [companyId, setCompanyId] = useState("");
  const [list, setList] = useState(customers);
  const [branchId, setBranchId] = useState("");
  const [job, setJob] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());

  const ambit = email.trim().toLowerCase().endsWith("@ambitpu.com");
  const admin = job === "admin";

  if (state?.ok) return <InviteShare r={state} />;

  const chooseKind = (k: "contractor" | "employee") => {
    setKind(k);
    setPicked(true);
  };
  const pickJob = (key: string) => {
    setJob(key);
    const preset = ROLES.find((r) => r.key === key);
    setPerms(new Set(preset ? (preset.perms as readonly Perm[]) : []));
  };
  const toggle = (k: string) =>
    setPerms((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <form action={action} className="col" style={{ gap: 18 }}>
      <section className="card col" style={{ gap: 14 }}>
        <div className="eyebrow">1 · Who is it?</div>
        <label className="field">
          <span className="label">Email</span>
          <input
            className="input"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              // An @ambitpu.com address is almost always an employee.
              if (!picked && email.trim().toLowerCase().endsWith("@ambitpu.com")) setKind("employee");
            }}
            placeholder="name@company.com"
            required
          />
        </label>
        <div className="grid2">
          <label className="field">
            <span className="label">Name</span>
            <input className="input" name="full_name" autoComplete="off" placeholder="First and last name" />
          </label>
          <label className="field">
            <span className="label">Cell phone (optional)</span>
            <input className="input" name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="To text them the link" />
          </label>
        </div>
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <div className="eyebrow">2 · What kind of account?</div>
        <div className="seg" role="radiogroup" aria-label="Account type">
          <button type="button" role="radio" aria-checked={kind === "contractor"} className={kind === "contractor" ? "on" : ""} onClick={() => chooseKind("contractor")}>
            Contractor
          </button>
          <button type="button" role="radio" aria-checked={kind === "employee"} className={kind === "employee" ? "on" : ""} onClick={() => chooseKind("employee")}>
            AMBIT employee
          </button>
        </div>
        <input type="hidden" name="kind" value={kind} />

        {kind === "contractor" ? (
          <>
            <div className="field">
              <span className="label">Their company</span>
              <CustomerPicker
                customers={list}
                value={companyId}
                onChange={(id) => {
                  setCompanyId(id);
                  const c = list.find((x) => x.id === id);
                  if (c?.default_branch_id && !branchId) setBranchId(c.default_branch_id);
                }}
                onAdded={(c) => setList((l) => (l.some((x) => x.id === c.id) ? l : [...l, c].sort((a, b) => a.name.localeCompare(b.name))))}
                branches={branches}
                defaultBranch={branchId || undefined}
              />
              <input type="hidden" name="company_id" value={companyId} />
              <span className="tiny faint">They&apos;ll order for this company and see its order history.</span>
            </div>
          </>
        ) : (
          <>
            {email && !ambit ? (
              <div className="alert warn small" style={{ margin: 0 }}>
                AMBIT employee accounts need an @ambitpu.com email. For anyone else, pick Contractor.
              </div>
            ) : null}
            <label className="field">
              <span className="label">Job role</span>
              <select className="select" name="job_role" value={job} onChange={(e) => pickJob(e.target.value)} required>
                <option value="">Pick a role…</option>
                {ROLES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </label>
            {job ? (
              <fieldset className="access-boxes" disabled={admin}>
                <legend className="label">What they can use {admin ? "(admins get everything)" : "(change any box)"}</legend>
                {PERMS.map((p) => (
                  <label key={p.key} className="check small">
                    <input type="checkbox" name="perms" value={p.key} checked={admin || perms.has(p.key)} onChange={() => toggle(p.key)} />
                    <span>
                      {p.label}
                      {p.hint ? <span className="faint"> · {p.hint}</span> : null}
                    </span>
                  </label>
                ))}
                <span className="tiny faint">Everyone on the AMBIT team also sees product docs, tech bulletins, Academy, the directory and branches.</span>
              </fieldset>
            ) : null}
          </>
        )}

        <label className="field">
          <span className="label">{kind === "employee" ? "Their AMBIT location" : "Their usual AMBIT location"}</span>
          <select className="select" name="branch_id" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Not set</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}, {b.state}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <div className="eyebrow">3 · Send the invite</div>
        <label className="field">
          <span className="label">Add a note to the email (optional)</span>
          <textarea className="textarea" name="note" rows={2} maxLength={600} placeholder="Welcome aboard! Call me if you have any questions." />
        </label>
        <p className="tiny faint" style={{ margin: 0 }}>
          They get an email with a button to create their password. Their account is ready as soon as they do. No approval step.
        </p>
      </section>

      {state && !state.ok ? (
        <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{state.error}</span></div>
      ) : null}
      <Submit className="btn block" pendingText="Creating…">
        <UserPlus size={18} /> Create account &amp; send invite
      </Submit>
    </form>
  );
}

/** After creating or re-sending: did the email go, plus ways to send the link yourself. */
export function InviteShare({ r, compact }: { r: Extract<InviteResult, { ok: true }>; compact?: boolean }) {
  const [copied, setCopied] = useState<"link" | "msg" | null>(null);
  const copy = async (what: "link" | "msg") => {
    const text = what === "link" ? r.link : r.text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };
  const who = r.name ? `${r.name} (${r.email})` : r.email;
  const sent = r.emailStatus === "sent";
  const mailto = `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.text)}`;
  const digits = (r.phone ?? "").replace(/[^\d+]/g, "");
  const sms = `sms:${digits}?&body=${encodeURIComponent(r.text)}`;

  return (
    <div className="col" style={{ gap: 14 }}>
      {!compact ? (
        <div className="alert ok" role="status">
          <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            {r.existing ? (
              <>
                <b>{who}</b> already had a login, so it&apos;s been updated with these settings. They can sign in right now.
              </>
            ) : (
              <>
                Account created for <b>{who}</b>. It&apos;s ready the moment they set their password.
              </>
            )}
          </span>
        </div>
      ) : null}

      {sent ? (
        <div className="card small">
          <Mail size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          We emailed {r.existing ? "them a sign-in link" : "their invite"} to <b>{r.email}</b>.
          {r.existing ? null : " The link works once and for 30 days."}
        </div>
      ) : (
        <div className="alert warn small" style={{ margin: 0 }}>
          <span>
            {r.emailStatus === "not_configured"
              ? "The app can't send email yet (email setup is still on the to-do list), so send the invite yourself with one of the buttons below."
              : `The email didn't go through${r.emailError ? ` (${r.emailError.slice(0, 120)})` : ""}. Send the invite yourself with one of the buttons below.`}
          </span>
        </div>
      )}

      <div className="card col" style={{ gap: 10 }}>
        <span className="label">{r.existing ? "Sign-in link" : "Their private invite link"}</span>
        <div className="row" style={{ gap: 8 }}>
          <input className="input sm grow" readOnly value={r.link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button type="button" className="btn sm dark" onClick={() => copy("link")}>
            {copied === "link" ? <Check size={15} /> : <Copy size={15} />} {copied === "link" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn sm" href={mailto}><Mail size={15} /> Email it from my email</a>
          <a className="btn sm dark" href={sms}><MessageSquare size={15} /> Text it</a>
          <button type="button" className="btn sm dark" onClick={() => copy("msg")}>
            {copied === "msg" ? <Check size={15} /> : <Copy size={15} />} {copied === "msg" ? "Copied" : "Copy the whole message"}
          </button>
        </div>
        <span className="tiny faint">Only send this link to {r.email}. Anyone with it could set up that account.</span>
      </div>

      {!compact ? (
        <div className="row wrap" style={{ gap: 10 }}>
          <a href="/admin/users/new" className="btn sm dark"><UserPlus size={15} /> Create another account</a>
          <Link href={r.existing ? "/admin/users?tab=customer" : "/admin/users?tab=invited"} className="btn sm ghost">Back to Accounts</Link>
        </div>
      ) : null}
    </div>
  );
}

/** "Send again" on the Invited list: new link, new email, and the share buttons right there. */
export function ResendInvite({ id, children }: { id: string; children?: React.ReactNode }) {
  const [state, action] = useActionState<InviteResult, FormData>(resendInvite, null);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 14, alignItems: "center" }}>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <Submit className="btn sm dark" pendingText="Sending…"><RefreshCw size={14} /> Send again</Submit>
        </form>
        {children}
      </div>
      {state && !state.ok ? <span className="tiny red">{state.error}</span> : null}
      {state?.ok ? <InviteShare r={state} compact /> : null}
    </div>
  );
}
