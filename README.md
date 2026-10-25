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
No checkout or payments: AMBIT handles invoices and POs as usual. Locations with a live inventory spreadsheet
(Oklahoma City first) show stock on the Order screen, see "Live inventory" below.

## First-time setup

1. **Supabase → SQL Editor → New query.** Paste all of `supabase/setup.sql` and click **Run**.
2. **Supabase → Authentication → Sign In / Providers → Email:** turn **off** "Confirm email" until custom
   email (SMTP) is set up. Supabase's built-in email only reaches members of your Supabase team.
3. **Supabase → Authentication → URL Configuration:**
   - Site URL: your Vercel address, e.g. `https://ambition-xxxx.vercel.app`
   - Redirect URLs: add `https://ambition-xxxx.vercel.app/**` (and later `https://app.ambitpu.com/**`)
4. **Vercel → Add New → Project →** import the `ambition` GitHub repo. Before deploying, add the environment
   variables from `.env.example` (at minimum the two `NEXT_PUBLIC_SUPABASE_*` values and `ADMIN_NOTIFY_EMAIL`).
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

### Live inventory (Oklahoma City first)

Each location keeps its stock in its Excel workbook in OneDrive / SharePoint (tabs COUNT SHEET and PENDING ORDERS).
The app keeps itself and the workbook in step, every 2 minutes (Vercel cron, `vercel.json`) and right after anything
changes in the app:

- **New SKU on the COUNT SHEET** → added as a product (name = Description, unit = UOM, price = Sell Price, category
  from Group). After that the app is in charge of names and prices.
- **TOTAL IN STOCK** changed on the sheet → the app takes it. Changed in the app (Inventory screen: count, received,
  damaged / used) → written to the sheet with Last Counted / Counted By. Changed on both at once: a new count on the
  sheet wins, otherwise both changes are kept.
- **Orders** (branch pickup or job site from that location) reserve stock the moment they're placed: a "Pending
  Pickup" line on PENDING ORDERS (Order # ORD-1234), so PENDING PICKUP / NET AVAILABLE on the sheet include it.
  Cancelled → "Cancelled". Picked up / delivered → "Picked Up / Completed" and TOTAL IN STOCK goes down once (Notes
  say "[Stock taken …]"). The AMBIT PO # is filled in when CRM enters it. Lines marked Picked Up / Completed or
  Cancelled on the sheet (including lines typed straight into the sheet) do the same in the app.
- **Order screen:** staff see the exact number available at that location; contractors see In stock / Low stock /
  Ships from supplier.

Setup (once): Microsoft Entra app registration "AMBITION" (Web redirect URI
`https://<app>/api/microsoft/callback`, delegated permissions Files.ReadWrite.All, offline_access, User.Read, a client
secret), then in Vercel set `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and `SUPABASE_SECRET_KEY` (Supabase →
Project Settings → API Keys → Secret keys), redeploy, and in the app Admin → Inventory → Connect Microsoft. Optional:
`CRON_SECRET` (Vercel sends it with the timer; then nobody else can start a sync). Needs
`supabase/migrations/0018_inventory.sql`.

### Customer approval

Orders AMBIT staff place for a customer are emailed to the customer first, with a secure link (valid 7 days)
to approve or request changes. The order and its printable PDF go to orders@ambitpu.com only after approval.
Contractors ordering for themselves approve in the app ("Approve order"). Staff can resend the link or
record an approval taken by phone. Needs `supabase/migrations/0010_order_approval.sql`.

Approval turns on by itself once email can reach customers: Resend with a verified domain and `EMAIL_FROM`
set, or Microsoft 365 sending. Set `CUSTOMER_APPROVAL=off` to turn it off, or `on` to force it.

### Staff roles

Admin → Accounts → AMBIT staff: pick a job role (Admin, CRM, Sales rep, Tech, Warehouse manager, Accounting)
and the boxes for what that person sees. Picking a role ticks its boxes; change any box after. Home-screen
form links can be limited to a box in Admin → Links. Needs `supabase/migrations/0011_roles_and_order_desk.sql`.

### Home screen

"Your apps" grid (colored app icons; each person can reorder or hide apps under Edit, saved to their profile), the
Place an Order card with Start order and Reorder (repeats the person's last order), Jump back in (things opened
recently on this device), tech bulletins, product lines and the Academy. Needs `supabase/migrations/0014_home_apps.sql`
for saving layouts.

### Expenses (AMBIT staff)

Home → Expenses: "Add a receipt" opens the AMBIT Expense Receipt form in Jotform (filled in with who's signed in):
date, store, amount, category, what it was for, AMBIT card or personal, and a photo of the receipt. The app
reads the receipts back from Jotform and shows each month's total, categories and receipts. "Send to Corporate"
emails the month's report (a PDF with every receipt photo) to Jeremiah, Kim and Kevin (Vercel EXPENSE_REPORT_TO
changes who) and remembers it was sent; "Download PDF" works any time. Admin → Expense reports shows every
employee's month. The form's id is EXPENSE_FORM_ID (set in the code; Vercel can override it). Needs
`supabase/migrations/0017_expense_reports.sql`.

### Creating accounts (admins)

Admin → Accounts → Create an account: type the person's email, pick Contractor (and their company) or AMBIT
employee (job role and what they can use), and the app emails them a private link to create their password.
The account is set up exactly as picked the moment they do; there's no approval step. A link works once, only
for that email, for 30 days; "Send again" on the Invited tab makes a new one. Until app email is set up, the
admin gets buttons to email, text or copy the link themselves. If the person already had a login (for example
they requested access), it's updated right away instead. Needs `supabase/migrations/0016_invites.sql`.

### Home banner and sale prices

A banner at the top of Home slides through promotions on its own (every few seconds; it stops while someone
touches it). Product slides show the price from the catalog, or the sale price with the regular price crossed
out, and open that product in Order. Admin → Home banner adds, edits, reorders and hides slides. A sale price
(Admin → Products, with an optional last day) is shown in Order and charged on new orders; it also replaces
"Based on customer pricing" while it runs. Needs `supabase/migrations/0015_sales_and_banner.sql`.

### Forms hub (admins)

Admin → Forms hub lists every form in the Jotform account. Credit applications and customer account setup
forms (found by "credit" or "account setup" in the form name) wait for an admin to approve or decline, with a
credit limit, terms and a note. Any submission, and any price request, downloads as a printed PDF.
Forms that belong to a different Jotform login are added by pasting their link in the hub.
Needs `supabase/migrations/0012_delete_account_sqft_form_reviews.sql` and `0013_hub_forms.sql`.

### Batts by square foot

Fiberglass batts take a bag count or a square footage; square feet round up to whole bags. Square feet per
bag is read from the batt name ("... 240.25 S/F ...") and can be changed in Admin → Products.

### Delete my account

Profile → Delete my account removes the person's login and profile. Orders they placed stay on file.
The last active admin can't delete themselves.

### Order desk

Orders move: customer approval → CRM enters the AMBIT PO # → Accounting releases it (or puts it on credit
hold) → CRM sets the delivery or pickup date and the customer is emailed → marked delivered / picked up.
Each step shows on the order page for whoever's job it is, and in Order desk (home screen) with counts.

### Price request approvals

Admins: Home → Price approvals. Waiting requests first; each opens as a clean form with requested vs approved
prices. Saving writes the approved prices into the Jotform submission and emails the rep, so
`JOTFORM_API_KEY` must be a **Full Access** key (Jotform → Settings → API).

### Appearance

Everyone can pick Dark, Light or Auto (follows the device) in Profile → Appearance. It's remembered per device.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the Supabase values
npm run dev
```

## Project map

```
app/(auth)/        sign in, request access, forgot password + server actions
app/(app)/         signed-in screens (home, order, orders, inventory, docs, academy, directory, profile, admin)
app/api/           inventory sync timer, Microsoft connect / callback
app/auth/          OAuth/email-link callback and sign out
components/        UI pieces (order builder, tab bar, CSV import, doc upload)
lib/               Supabase clients, session/role helpers, email, formatting
supabase/          database schema, starter data and storage rules
```
