# AMBITION

The AMBIT Polyurethane app for AMBIT employees and contractor customers: order requests, product docs and
bulletins, AMBIT Academy, internal forms, company directory, and an admin area.

- **Front end + server:** Next.js 15 (App Router), hosted on Vercel
- **Logins + database + file storage:** Supabase (Postgres with row-level security)
- **Email:** Resend (needs DNS records on ambitpu.com) or Microsoft 365 via Graph
- **Installable:** works as a phone app via "Add to Home Screen" (PWA manifest + icons)

## How access works

| Who | How they sign in | What they get |
| --- | --- | --- |
| AMBIT employees | "Sign in with Microsoft" (@ambitpu.com, AMBIT's Microsoft tenant only) | Active **employee** immediately. Turned off in Microsoft 365 = can't sign in. |
| Contractors | Request access (email + password) | **Pending** until an admin approves and links them to a company |
| Admins | Either | Everything above plus Admin (accounts, customers, products, links, docs, courses, branches) |

All rules are enforced in the database (`supabase/migrations/0001_schema.sql`), not just in the app.
Prices are always read from the products table when an order is placed.

## Ordering

Pick items → review → choose branch pickup, job site or drop ship → **Send order to AMBIT**.
The order is saved, then emailed to `ORDERS_EMAIL` (orders@ambitpu.com) with a copy to the person who placed it.
Spray foam and fiberglass categories show "Based on customer pricing"; everything else shows list price.
No checkout, payments or inventory: AMBIT handles invoices and POs as usual.

## First-time setup

1. **Supabase → SQL Editor → New query.** Paste all of `supabase/setup.sql` and click **Run**.
2. **Supabase → Authentication → Sign In / Providers → Email:** turn **off** "Confirm email" until custom
   email (SMTP) is set up. Supabase's built-in email only reaches members of your Supabase team.
3. **Supabase → Authentication → URL Configuration:**
   - Site URL: your Vercel address, e.g. `https://ambition-xxxx.vercel.app`
   - Redirect URLs: add `https://ambition-xxxx.vercel.app/**` (and later `https://app.ambitpu.com/**`)
4. **Vercel → Add New → Project →** import the `ambition` GitHub repo. Before deploying, add the environment
   variables from `.env.example` (at minimum the two `NEXT_PUBLIC_SUPABASE_*` values and `NEXT_PUBLIC_SITE_URL`).
   The values are in Supabase → Project Settings → API Keys.
5. Open the app, **Request contractor access** with your own email, then in Supabase SQL Editor run:
   ```sql
   select public.make_admin('you@ambitpu.com');
   ```
   Refresh the app: you're an admin.
6. **Admin → Products → Import CSV** with your product list (template in `public/templates/`).
   Tick "Hide products that are not in this file" to remove the sample items.
7. **Admin → Customers → Import CSV** with your customer list (name, account_no, branch, phone, email).
8. **Admin → Home screen links & forms:** paste the Jotform links (price request, travel, complaint, spray job log).
9. **Admin → Docs & bulletins:** upload TDS / SDS / ESR / TSB PDFs or paste links.
10. **Admin → Branches:** add addresses and phone numbers.

## Microsoft sign-in (IT)

In Microsoft Entra admin center → App registrations → New registration:
- Name: AMBITION · Supported accounts: **this organizational directory only**
- Redirect URI (Web): `https://<project-ref>.supabase.co/auth/v1/callback`
- Certificates & secrets → New client secret → copy the **Value**
- Token configuration → Add optional claim → ID → `email`, `xms_edov`

Then in Supabase → Authentication → Sign In / Providers → **Azure**: enable, paste the Application (client) ID and
secret, and set **Azure Tenant URL** to `https://login.microsoftonline.com/<directory-tenant-id>`.
Finally set `NEXT_PUBLIC_MICROSOFT_SIGNIN=true` in Vercel and redeploy.

Recommended on the Supabase Pro plan: Authentication → Sessions → time-box sessions (for example 7 days), so a
departed employee's phone is signed out within a week. Admins can also turn anyone off instantly in Admin → Accounts.

## Email

Pick one:

- **Resend:** create an account, add the domain `ambitpu.com`, add the DNS records it shows, then set
  `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `AMBITION <ambition@ambitpu.com>`). The same Resend account can
  be used as custom SMTP for Supabase (Authentication → Emails → SMTP), which turns on confirmation and
  password-reset emails for contractors.
- **Microsoft 365 (Graph):** IT adds the application permission `Mail.Send` (admin consent) to the same app
  registration, ideally limited to the orders mailbox, then set `MS_TENANT_ID`, `MS_CLIENT_ID`,
  `MS_CLIENT_SECRET`, `MS_SENDER_MAILBOX`.

With neither set, orders are still saved and show under Orders with "Email sending isn't set up yet".

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the Supabase values
npm run dev
```

## Project map

```
app/(auth)/        sign in, request access, forgot password + server actions
app/(app)/         signed-in screens (home, order, orders, docs, academy, directory, profile, admin)
app/auth/          OAuth/email-link callback and sign out
components/        UI pieces (order builder, tab bar, CSV import, doc upload)
lib/               Supabase clients, session/role helpers, email, formatting
supabase/          database schema, starter data and storage rules
```
