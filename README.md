# AMBIT Intelligence (A.I.)

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
(Oklahoma City first) show stock on the Order screen, see "Live inventory" below. AMBIT staff go location →
customer ("Who's it for?") → items → review; the order screen gets a trimmed customer list (name, account #, city)
and fetches the chosen customer's address / email / phone with `customerDetails()`.

**Speed.** Every section has a `loading.tsx` (`components/page-skeleton.tsx`), so a tap shows the next screen's
outline at once (and links prefetch it). Sign-in is checked with `auth.getClaims()` (the project signs tokens with
ES256, so it's verified locally instead of a trip to the sign-in server on every request). The order page loads
its data in one parallel round; Home's Jotform check is cached for 5 minutes and never waits more than 1.2 s.

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
- Name: AMBIT Intelligence · Supported accounts: **this organizational directory only**
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
  `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `AMBIT Intelligence <orders@ambitpu.com>`). The same Resend account can
  be used as custom SMTP for Supabase (Authentication → Emails → SMTP), which turns on confirmation and
  password-reset emails for contractors.
- **Microsoft 365 (Graph):** IT adds the application permission `Mail.Send` (admin consent) to the same app
  registration, ideally limited to the orders mailbox, then set `MS_TENANT_ID`, `MS_CLIENT_ID`,
  `MS_CLIENT_SECRET`, `MS_SENDER_MAILBOX`.

With neither set, orders are still saved and show under Orders with "Email sending isn't set up yet".

### Desktop (Mac and PC)

The same app works in any computer browser at the same address. From 1024px wide the bottom tabs become a menu
down the left side and pages get wider; phones keep the tabs. Chrome and Edge show "Install on this computer" at the
bottom of the menu (its own icon and window); on a Mac in Safari use File → Add to Dock. Every feature is built
once and works on both.

### Updates and the opening animation

Phones keep a home-screen app open in the background, so it can keep showing an older version. When the app comes
back on screen it asks `/api/version` which version is live: after 30+ minutes away it reloads into the new version
by itself (with the opening animation), unless something is half typed; otherwise a small "A new version of AMBIT
A.I. is ready · Update" bar appears at the top. The installed app also replays the opening animation after 30+
minutes away. (components/splash.tsx; the opening screen is its own `<ambit-splash>` tag, never a `<div>`, so React
doesn't mistake it for the first box of the page and wipe it out.)

### AMBIT-OPS

`/ops` (Home tile and left menu "AMBIT-OPS"): the contractor operations software being built inside AMBIT
Intelligence. Takeoff is its first live module; Quoting & proposals, CRM, Dispatching, Job scheduling and Job costing
are listed as planned. Open to people with the Takeoff box for now (contractors later). New modules go under
`app/(app)/ops/`.

### Takeoff

Home → Takeoff (staff with the Takeoff box; admins always, CRM and Sales reps by default). Start a takeoff, drop in
the plan PDFs (any size up to the storage limit), and each page becomes a sheet; sheet numbers (A2.1) and the scale
written on the sheet (1/4" = 1'-0", 1" = 20') are read automatically when the PDF has text. Check or set the scale
with the Scale tool (click both ends of a known dimension and type its length) or pick it from the list. Items are
what's measured: Area (with slope for vaulted ceilings and roof decks), Walls / lengths (length × wall height, minus
openings) or Count, each with a material, thickness and R-value; spray foam shows board feet. Shortcuts: V select,
H move, S scale, A area, L linear, C count, X cutout, Enter finish, Esc cancel, Backspace undo a point, Shift for
straight lines, scroll to zoom. The report totals by item, material and sheet, prints to PDF and downloads for Excel.
Plans are stored in the private "plans" bucket. Needs `supabase/migrations/0019_takeoff.sql`.

### Ask AMBIT (AI assistant)

Home → Ask AMBIT (or the Ask AMBIT bar on Home). Answers questions about AMBIT products, building science as AMBIT
teaches it, building codes, HVAC design and how to use the app, with numbered sources under each answer.

**Where its knowledge may come from (set by Jeremiah, enforced in `lib/assistant/policy.ts`):** building science only
from AMBIT teaching (Jeremiah's TSBs and notes); codes and climate zones only from the IECC, IRC and IBC; HVAC design
only from ACCA, ASHRAE and other neutral parties; AMBIT products only from AMBIT's own TDS / SDS / ESR / CCRR /
guides / warranties; plus basic physics. Never SPFA, Spray Foam World or any foam- or HVAC-industry source. The SPFA
library in Docs is never added. Web lookups (optional) can only reach the approved sites in Admin → Ask AMBIT →
Settings, and foam-industry sites can't be added there.

- **How it answers:** it searches AMBIT's knowledge (Postgres full-text search, `ai_search`), lets Claude search more,
  optionally looks things up on the approved sites (Anthropic web search with `allowed_domains`), and streams the
  answer with citations. Without an approved source it says so and offers "Send to AMBIT's expert".
- **Admin → Ask AMBIT:** Teach (add PDFs, add AMBIT documents from Product docs, write teaching or app help, turn
  sources on/off, staff-only), Questions (the expert inbox: the answer goes back into the person's conversation, by
  email once app email works, and can be saved as teaching), Conversations (not helpful / no source / all, with
  "write a correction"), Settings (staff only or contractors too, model, daily limits, approved sites, the
  building-science teacher who alone can change teaching, extra rules).
- **Setup:** `ANTHROPIC_API_KEY` in Vercel (an API key from platform.claude.com with billing), then Redeploy. Needs
  `supabase/migrations/0020_assistant.sql`. PDF words are read in the admin's browser (pdf.js); scanned PDFs without
  text can't be used. How the app works for the assistant: `lib/assistant/app-guide.ts` (each person only gets the
  sections they can use; update it when screens change).

### AI order intake (staff)

Order → "Got the order in a text, email or note?" (or the "Paste an order" Home tile, `/order/intake`). Paste a
texted or emailed order, or snap / pick photos of a handwritten one (up to 4), then "Read the order". Claude
(`lib/intake/read.ts`, forced `record_order` tool) matches each line to AMBIT's catalog and guesses the customer
(`matchCustomers`), location, delivery, PO and date. The draft (`order_drafts`) shows each line as Sure / Check /
Not matched with a product picker; "Open in Order to finish" loads it into the normal order review (`/order?draft=`),
where it's sent like any order (customer approval still applies). Photos are made smaller on the phone and saved in
the private `photos` bucket under the person's own folder.

### Photos in Ask AMBIT and complaint reports

The camera button in Ask AMBIT adds up to 4 photos to a question (`photos/<user>/ask/`). Claude sees them next to
AMBIT's TSBs; when it looks like a product problem the answer ends with `[[COMPLAINT]]` (stripped) and shows "Start a
complaint report". That calls `startComplaint`, which fills the report from the conversation
(`lib/complaints-ai.ts`, forced `fill_report` tool; only what was said) and attaches the photos.

Complaint reports (`/complaints`, `complaint_reports`): who/where, product and lots, conditions, symptoms,
description, Ask AMBIT's notes, photos. "Submit to AMBIT" numbers it (CCR-2026-005 onward; 001–004 were filed before
the app, `complaint_submit`) and emails `ADMIN_NOTIFY_EMAIL`. The complaints team (the "Customer complaints" box) and
admins see all reports, set Reviewing / Closed and write AMBIT's review; others see their own. Print / save PDF:
`/complaints/<id>/report`.

### Smart reorder and customers due

`reorder_suggestions(company)` works out each product's usual quantity and days between orders (2+ orders).
Contractors get a Home card when something is due within a week: "You usually order 4 drums of AMBI-SEAL 5.0 Resin
every 3 weeks. Reorder for Tuesday?" → `/order?smart=1` opens the review with those items and the date (at least 2
working days out). "Everything I usually order" is `/order?smart=all`. Staff with ordering get "Due to order"
(`/orders/due`, `customers_due`): customers with 3+ orders who are well past their usual rhythm (more than 1.25× and
5+ days), with a call button and "Start order" (their usual items).

### Sales-tax exemption certificates

`companies.tax_exempt` plus `tax_certificates` (file in the private `tax-certs` bucket). State per customer
(`company_tax_state`): Not tax-exempt, Certificate current, Expires soon (≤ 60 days), Expired, No certificate on file,
Waiting to verify. Accounting (the "Credit check" box) and admins: `/tax` and `/tax/<company>` (mark exempt, add and
verify certificates; their own uploads are verified at once). Contractors: Profile → Sales-tax exemption (upload goes
to Accounting to verify; `ACCOUNTING_EMAIL` is emailed). Home warns contractors at 60 and 30 days and Accounting when
any need attention. **Orders:** for a customer marked tax-exempt whose certificate is expired, missing or unverified,
`order_credit_decision` refuses to release unless Accounting ticks "Charge sales tax on this order instead" (saved in
`orders.tax_note` and shown on the order). **Reminder emails:** daily Vercel cron `/api/tax/reminders` (13:35 UTC)
sends each certificate's 60-day, 30-day and expired reminder once, Accounting copied; nothing is sent until app email
is set up (without customer email it goes to Accounting only).

Needs `supabase/migrations/0021_intake_photos_reorder_tax.sql`.

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
- **Spray foam by lot (FOAM LOTS tab, `0023_foam_lots.sql`):** the store sells one "ISO A-Side" (`ISO`); the ISO
  brands (`ISO-COVESTRO`, `ISO-WANHUA`, `ISO-DOW`, `ISO-HUNTSMAN`) are stock-only products (`products.stock_of`,
  `pick_rank`). AMBI-SEAL 5.0 and AMBI-TITE 204 have Winter versions (`-W`). When an order is placed,
  `inventory_pick()` splits each foam line across lots (`inventory_lots`, one `inventory_lines` row per lot): brand
  rank first (Covestro 1), then the lot that expires soonest (`use_by` = Exp, or Mfg + 12 months), never an expired
  lot; short on stock = a line with no lot yet. Staff see brand / lot on the order page and the warehouse PDF
  (`?copy=customer` leaves them out; customers can't read lots at all); admins and the `item_variance` box can
  "Change lot" until pickup in the item variance table (`order_variance_lot` → `inventory_repick`). The sheet owns each lot's Starting Qty / Shipped In / Adj / dates; the app adds pickups to
  Shipped Out, fills in the formula columns on new lot rows, and writes app lines to PENDING ORDERS with the brand
  SKU and "[Lot …]" in Notes (FOAM LOTS' Pending Pickup adds those up). TOTAL IN STOCK for these products on the
  COUNT SHEET is a formula over FOAM LOTS. The app adds the tab itself the first time (from the lots in the
  database). A lot product with lots on FOAM LOTS but no COUNT SHEET row (the Winter resins) gets one right under the
  row it's a version of (AMB-SEAL-50-W under AMB-SEAL-50): cells A..(last header) are inserted and filled from that row
  (formulas moved down one row, group / UOM / pack / weight / price / vendor / lead time copied), and the group band's
  "N items" goes up (`addCountRows`). PENDING PICKUP and NET AVAILABLE are kept as formulas: a typed number or a blank
  gets the nearest row's formula back, logged (`restoreCountFormulas`). Line Wt on PENDING ORDERS uses the row's own
  Unit Weight, else the row it's a version of, and is filled in on app lines where it's blank.

Setup (once): Microsoft Entra app registration "AMBIT Intelligence" (Web redirect URI
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
for saving layouts. Staff apps carry a `folder` (`lib/home-apps.ts`: Sales tools, Employee forms, Learn & resources,
Admin tools); `homeTiles()` turns each folder with 2+ apps into one tile that opens a panel (`components/home-grid.tsx`).
Admin → Links has a "Staff home screen" choice per link (`links.folder`, 0026); left on Automatic, forms go in
Employee forms, price-request links in Sales tools, the rest in Learn & resources.

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

Orders move: customer approval → CRM enters the Sales Order # and Invoice # → Accounting releases it (or puts it on
credit hold) → CRM sets the delivery or pickup date and the customer is emailed → marked delivered / picked up with
the signed BOL attached.
Each step shows on the order page for whoever's job it is, and in Order desk (home screen) with counts.


**Sales Order #** is what the order desk enters after approval (the column is still `ambit_po`); the customer's own
number is "Customer PO #". **Cancel:** open the order → "Cancel this order" with a reason (admins, the order desk,
or whoever placed it until it has a Sales Order #; `order_cancel`), which releases its stock and marks the inventory
sheet line Cancelled. **Delete:** admins only, cancelled orders only (`order_delete`). **Spray foam by the drum:**
ISO and every resin are drums (0022); the order page, the PDF, the approval page and the emails list each resin with
the ISO drums that go with it, a dark line between those groups (`lib/order-doc/loads.ts`). Needs
`supabase/migrations/0022_sales_order_cancel_drums.sql`.

**One Order Desk** (`0026_one_order_desk.sql`): staff get a single "Order desk" menu item (`deskAccess()` in
`lib/order-desk.ts`): admins, the order desk, credit approvals and the warehouse see every order; sales reps
(Ordering only) see the orders they placed, dashboard included (`order_desk_stats` filters to `placed_by = auth.uid()`
for them). "View orders" opens `/orders`. Every dashboard tile, bar, slice and step links to `/orders` with filters:
`day`, `week`, `from`/`to` (Central-time days, placed; with `done=1` completed), `stage` (comma list), `open=1`,
`stuck=1` (waiting over a day or past the date, same rule as the dashboard via `waitingSince()`), `b` (branch or
`dropship`); the list shows what it's filtered to with Clear.

Dashboard at the top of the Order Desk (`components/desk-dashboard.tsx`, data from `order_desk_stats(p_days, p_branch)` in
`0024_order_desk_dashboard.sql`, one call): filters for time range and location (they also scope the order lists),
tiles, open orders by status (donut), orders placed per day/week, open orders by location, typical time per step
(median) and the orders waiting longest. Colors per status are fixed (validated for both themes); every chart has a
"Show the numbers" table and hover/focus tooltips.

**Invoice #, invoice file, signed BOL** (`0025_invoice_bol_variance.sql`): `order_set_numbers(p_order, p_po, p_invoice)`
needs both numbers (the old `order_set_po` now does too). Files go to the private `order-files` bucket under
`<order id>/` from the browser (`lib/order-file-upload.ts`, photos shrunk to 2400 px), then `order_add_file` puts them on
the order (`order_files`, kinds `invoice` and `bol`); `/orders/<id>/files/<file id>` opens one through a 2-minute signed
link. `order_complete` refuses without a BOL, and so do the status dropdown and the sheet sync (which now logs "finish it
in the app" instead of closing the order). **Customer Approved without Email:** at customer approval it calls
`record_order_approval` with that note; on a scheduled order `order_notify_override` sets `notify_status = 'override'`.
Both show only while the email didn't go out.

**Item variance** (permission `item_variance`, admins always; not part of any role by default): the table in
`components/item-variance.tsx` shows ordered vs loading per line. "Load a different type" → `order_item_swap` (same
category, unit and foam side; keeps `ordered_sku/ordered_name/ordered_product_id`; lines already on PENDING ORDERS are
set Cancelled there with `done_by = 'swap'` and the new type is picked again by lot). "Change lot" →
`order_variance_lot`, which wraps `inventory_repick` (now also limited to `item_variance`). Every change is a row in
`order_variances` (who, when, why, stage), shown on the order desk card before the Sales Order # and before Delivered.
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
app/(app)/         signed-in screens (home, order, orders, takeoff, inventory, docs, academy, directory, profile, admin)
app/api/           Ask AMBIT answers, inventory sync timer, Microsoft connect / callback, version check
app/auth/          OAuth/email-link callback and sign out
components/        UI pieces (order builder, tab bar, CSV import, doc upload)
lib/               Supabase clients, session/role helpers, email, formatting, assistant/ (Ask AMBIT rules, app guide, Claude loop)
supabase/          database schema, starter data and storage rules
```
