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

`/ops`: the contractor's own operations software inside AMBIT Intelligence, built as one straight path: CRM (leads
and customers), quotes, proposals and e-sign (with Takeoff), jobs, the rig board and stock, then crew work orders
and invoices (Nov 26) and job costing / yield (Dec 1), for the December 2026 pilot. Database:
`0031_ops_foundation.sql`, `0032_ops_quotes.sql`, `0033_ops_schedule.sql`. Code: `app/(app)/ops/`, `lib/ops/`, `components/ops/`, the public
form in `app/lead/[token]/`, the public proposal in `app/p/[token]/`.

- **Workspaces**: a workspace is a `companies` row with `ops_enabled`. AMBIT turns it on (Admin > AMBIT-OPS
  workspaces: pick the customer, pick or invite the owner); the owner invites the team. Contractor logins are
  `role = 'customer'` with `ops_role` (owner, office, dispatcher, sales, crew_lead, crew, accounting, sub) and land on
  `/ops`; they still have the AMBIT order store, docs and Academy. Demo workspaces (`ops_demo`) are for AMBIT staff.
  AMBIT staff open a contractor's workspace only while the owner allows it (`ops_support_until`, Settings > Let AMBIT
  help); every visit goes in `ops_support_log`. RLS: `ops_company()`, `ops_role()`, `ops_is(...)`; every OPS table has
  `company_id` and is walled to the workspace. Crews and subs don't read customers, leads or products (no prices).
  Sales reps read only their own leads (`rep_id` or `created_by`).
- **Product library** (`ops_products`): seeded when OPS is turned on (`lib/ops/seed.ts`): AMBI-SEAL and AMBI-TITE sets
  always (ROOF and JACK if bought), set cost = ISO price + resin price from the contractor's latest priced AMBIT
  invoices, lb per set = 500 ISO + 450 (SEAL) or 475 (TITE); blown fiberglass always, batts if bought. Yield defaults
  16,500 BF/set open cell, 3,700 closed cell, 2,800 AMBI-ROOF (changing one needs a confirm). AMBIT costs aren't
  editable; "Refresh AMBIT costs" re-reads the invoices. Blown fiberglass has a `coverage_key` for the maker's chart
  (`lib/ops/coverage.ts`: Knauf Jet Stream Ultra, JM Climate Pro B-7700, Owens Corning L77 (May 2026 PDS),
  CertainTeed InsulSafe SP (10/25 fact sheet); attic rows by R-value, wall rows by framing); waste 0 for blown since
  the charts already give bags. Chart brands AMBIT doesn't stock are seeded inactive with no cost.
- **Settings** (`ops_settings` jsonb on companies, defaults in `lib/ops/defaults.ts`): labor (open cell $500/set,
  closed cell $450/set, blown attic $0.05, BIBS mesh $0.05 + blow $0.05 (2x4) / $0.07 (2x6), batts $0.04 R-11/13,
  $0.05 R-19, $0.06 R-30/38, intumescent $0.05 per sq ft), waste 10%, measure unit (lbs, gallons, strokes), stages,
  sources, lost reasons, work areas (EW, PW, KW, CL, RL, RJ + custom), services, logo (`ops-logos` bucket).
- **CRM**: `ops_customers`, `ops_properties`, `ops_leads` (numbers from 1001 per workspace, a stage note on every
  move, Lost needs a reason), `ops_notes` (note, call, text, email, task, stage). Pipeline board with drag and drop
  (phone: stage tabs and "Move to…"). Spreadsheet import (`ops_import_customers`, undo for 3 days with
  `ops_undo_import`), repeats by phone/email skipped.
- **Website lead form**: `/lead/<token>` (public, no sign-in; `ops_lead_form` / `ops_lead_submit`, rate-limited, a
  hidden honeypot field); `?embed=1` for an iframe. New link = new token (the old one stops).
- **Quotes** (`ops_quotes`, `ops_quote_options`, `ops_quote_lines`, `ops_packages`; `opsCan.quote` = owner, office,
  dispatcher, sales; sales see their own or their leads'). Math in `lib/ops/quote-calc.ts` (direct margin: price =
  cost / (1 − margin); labor × (1 + burden)): foam board feet = sq ft × inches, sets = BF × (1 + waste) / yield;
  blown bags from the chart row at or above the R (attic) or the framing row (walls) × area / 1000; batts = area ×
  (1 + waste) / sq ft per bag; BIBS walls add mesh labor; per option a minimum-job adjustment, tax on materials
  (or everything if `tax_labor`), deposit. Lines carry a work area; options (Good/Better/Best) and add-ons
  (`option_id` null). The server re-prices every save (`persist()` in `app/(app)/ops/quotes/actions.ts`) and calls
  `ops_quote_save`; an option under the floor margin sets `needs_approval` (owner/office `ops_quote_approve`).
  Lines from a takeoff: `linesFromTakeoff` in `lib/ops/quotes.ts` (foam product picked by season, winter Nov–Mar).
- **Proposals and e-sign**: `ops_quote_mark_sent` makes `public_token` and `valid_until`, lead → Quote sent. `/p/<token>`
  (public, in `PUBLIC_PATHS`) reads `ops_proposal` (counts views, notes the first open) and `ops_proposal_docs` (AMBIT
  TDS / ESR / CCRR / warranty for the product families on the quote). `ops_proposal_sign` checks expiry and the
  signature (PNG data URL), and the signed total comes from the saved `totals` in SQL, never from the browser; IP and
  user agent saved, lead → Won. `ops_proposal_decline` keeps the reason. PDFs: `lib/ops/proposal-pdf.tsx`
  (`/ops/quotes/<id>/pdf`, `/p/<token>/pdf`). Email via `sendEmail` with the rep as reply-to; "Just get the link"
  works without email.
- **Jobs and trips** (`ops_jobs`, `ops_job_lines`, `ops_trips`, `ops_trip_crew`): `ops_make_job(quote)` copies the signed
  option and add-ons into a job with one trip; it runs inside `ops_proposal_sign` and `ops_quote_mark_sold` (the office
  records a yes on paper / in person: `signed_method = 'office'`, `signed_note`, `signed_by_name`), and once for quotes
  signed before 0033. `ops_lines_to_trip` moves picked lines into another or a new trip (names follow the work unless
  typed: `name_auto`); empty unscheduled trips go away. `ops_trip_schedule(trip, rig, start, days, time, crew)` (copies
  the rig's regular crew when none is given), `ops_trip_unschedule`, `ops_trip_set_crew`. `end_date` is generated from
  `start_date + days - 1`. Screens: `/ops/jobs`, `/ops/jobs/<id>`, `/ops/schedule` (`board.tsx`: week grid, lanes per
  rig, HTML5 drag and drop, a day list on phones), `lib/ops/schedule.ts` (`suggestDays` = open cell sets / rig rate +
  closed cell and roofing sets / rig rate + sq ft of blown, batts, coatings and removal / rig rate, rounded up).
- **Rigs and crews** (`ops_rigs` with `does`, `oc_sets_day` 1, `cc_sets_day` 2, `sqft_day` 4000, `color`; `ops_crew`, a
  login optional; `ops_rig_crew` regular crew with a lead): `/ops/schedule/rigs`. `ops_crew_sync()` adds crew, crew
  lead and sub logins. `opsCan.dispatch` = owner, office, dispatcher; sales see the jobs from their own quotes.
- **Crews' next 7 days**: `ops_my_trips(days)` (security definer, no prices) on the crew's OPS home.
- **Stock** (`ops_stock` per place (`location` or `rig`), `item_key` = AMBIT SKU (ISO drums keyed `ISO` with `maker`) or
  `OPS:<product id>`, `lot_no`, partial `qty`; `ops_stock_moves` log; `ops_stock_min` reorder points). Changes only
  through `ops_stock_add`, `ops_stock_count`, `ops_stock_move`. AMBIT deliveries: trigger `ops_orders_delivered` on
  `orders` → `ops_ambit_delivery(order)` adds a completed order's items (not guns, parts or tools) to the first shop by
  the lots in `inventory_lines` (ISO-COVESTRO → `ISO` / Covestro), once per order. `/ops/stock`, and the stock check
  `/ops/stock/check?trip=<id>` or `?from=&to=` (`materialNeeds` on the trips' job lines vs rig, shop and open AMBIT
  orders; "Order what's short" fills the cart).
- **Material order** (`/ops/materials?quote=<id>&option=<id>` or `?takeoff=<id>`, `lib/ops/materials.ts`): foam →
  whole sets of ISO + resin drums from `ambit_skus`, other AMBIT products by SKU, the rest listed as "buy elsewhere";
  the button adds them to the Order cart (merged with anything already there).

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

Contractors in an AMBIT-OPS workspace (owner, office, dispatcher, sales) use the same Takeoff for their own jobs
(`lib/takeoff/access.ts`; `takeoffs.ops_company_id` walls them to the workspace, null = AMBIT staff takeoffs; staff
see a workspace's takeoffs only with `?ops=1` while inside it). "Quote it" starts a quote from a takeoff.

- **Undo / Redo**: up to 60 steps back and forward (`hist` in `components/takeoff/workspace.tsx`): add or delete a
  shape, move or add or remove corners, add / change / delete an item (its shapes come back with it), set the scale.
  Each step is a list of changes with its inverse; the screen changes at once and the database follows.
  Ctrl/⌘ Z, Ctrl/⌘ Shift Z or Ctrl Y.
- **Corner editing**: with Select, a selected shape shows its corners; drag one to move it, click its edge to add a
  corner there (and drag it), double-click a corner to remove it (areas keep at least 3, lines 2).
- **Work areas and gables**: items have an `area_code` (EW, CL, RL…, for the quote). A linear item with
  `shape = 'gable'` is an attic demising wall: area = base² × pitch / 48 per traced run (`gableSqft` in
  `lib/takeoff/calc.ts`).
- **AI pre-scan** (`components/takeoff/prescan.tsx`, `app/(app)/takeoff/prescan-actions.ts`, `lib/takeoff/prescan*.ts`):
  each chosen sheet (A sheets first, up to 20) goes to Claude as images (whole page at 1568 px plus halves on big
  sheets) and the PDF's text, with a strict schema: insulation callouts with the exact words, roof pitches, wall
  heights, framing, garage, porch, attic. `mergeScans` combines them, a few questions follow (garage conditioned?
  sealed or vented attic? porch/garage attics walled off? pitch, framing, heights) and `proposeItems` lists the items
  (one exterior-wall item per height, roof deck or ceiling, demising gables, garage wall, floor over garage, knee
  walls, rim joist). Foam depth from R: open cell R/3.7, closed cell R/6.9, rounded up to ½". The result is saved in
  `takeoffs.ai_scan`. Model from Ask AMBIT settings.

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

### Home widgets, spot checks, reconciliation, incoming deliveries

`components/home-widgets.tsx` (data in `lib/widgets.ts`, `widgetsFor()` decides who gets what) puts a few cards under
the greeting, each in its own `Suspense` so Home never waits on them: warehouse (`job_role = warehouse`): Daily spot
check + This week (`components/week-calendar.tsx`: pickups, deliveries, incoming trucks for 7 days, late ones on
today); order desk: queue + This week; credit approvals: credit / hold / tax; sales reps (`deskAccess = mine`): Your
month vs. last month and `profiles.monthly_goal` (Admin → Accounts); admins: Waiting on you, Sales (this month by
location and top products, app orders at list price) and Inventory movement (units ordered last 30 days vs. the 30
before, spot checks per location).

`0027_home_widgets_counts_incoming.sql`:
- **Spot checks** (`inventory_counts.kind = 'spot'`): `spot_check_ensure(branch)` assigns one random stocked item per
  weekday per location (none repeats within a `cycle`; then the next cycle starts), back-filling missed weekdays (up to
  21 days). `count_line_save` saves a blind count; a match closes it (`matched`), a difference makes it `submitted`.
- **Reconciliation** (`kind = 'reconcile'`, `/inventory/counts`): `count_start_reconcile` lists every item (foam by
  lot), counts save as typed, `count_submit`, then an admin `count_review`s. Approving adds each difference (counted − what
  the app had when it was counted, so pickups since then still count) to `inventory.on_hand` (+ Last Counted / Counted
  By) or to the lot's `adj_unsynced`, which the sync adds to Adj on FOAM LOTS.
- **Expected deliveries** (`inbound_deliveries` / `inbound_lines`, `/inventory/incoming`): `inbound_receive` adds
  non-lot items to `on_hand`; foam needs a lot #: an existing lot gets `in_unsynced` (→ Shipped In), a new lot is
  inserted with `add_to_sheet` and the sync inserts its FOAM LOTS row at the end of that SKU's block (`addReceivedLots`).

### Sales reps, invoice prices and sales goals

`0028_sales_reps_prices_goals.sql`:
- **Sales rep per customer** (`companies.sales_rep_id`, Admin → Customers: pick one per customer, or tick several and
  "Assign"; the customer import takes a "Sales Rep" column, name or email). `orders.sales_rep_id` is set from the
  customer when the order is placed (`orders_set_rep` trigger; a customer getting a rep fills in their orders that had
  none). No foreign keys to `profiles` on purpose. Sales reps' "mine" on the Order desk = placed by them or their
  customers' orders.
- **Invoice prices**: `order_set_numbers(order, po, invoice, prices)` saves the price each for every line with the
  Sales Order # and Invoice # (required for customer-priced lines: spray foam, fiberglass), recomputes
  `est_subtotal`, and stamps `priced_at` / `priced_by_name`. The order page, the PDF and the Sales card use them.
- **COD Only / No Checks Allowed** (`0035_cod_no_checks.sql`): `orders.pay_cod` / `pay_no_checks`, set by
  `order_credit_decision(..., p_cod, p_no_checks)` at the release and copied to `companies` so the customer's next
  release starts the same way. Shown on the order desk card (red pills, a red alert on the Picked up / Delivered
  step), the Order desk list and the staff PDF. `renderOrderPdf(doc, { audience })`: the customer's copy says
  "THIS IS NOT AN ORDER OR A QUOTATION" with the fine print (`lib/order-doc/wording.ts`, also on the approval page
  and customer emails); the staff copy keeps "THIS IS NOT AN INVOICE" and shows the payment rules. Prices are no
  longer carried over from the customer's last orders, and the invoice file upload was removed from the Sales
  Order # step (invoices live in QuickBooks).
- **Deleted orders log** (`0034_order_delete_log.sql`): `order_delete` saves the whole order (`orders` row,
  `order_items`, `inventory_lines` with their lots and sheet rows, `order_variances`, `order_files`, linked
  `order_drafts`) as JSON in `orders_deleted`, then deletes it. Only the people in `order_keepers` (Jeremiah; no
  policies, so nobody can change that list from the app) can read the log (`is_order_keeper()`) and call
  `order_restore(log, reopen)`, which re-inserts the rows with the same ids and order # (`restore_rows()`), then by
  default reopens it to `status_before_cancel` (saved by `order_cancel`) so the inventory trigger reserves its stock
  again and the sheet rows go back to Pending Pickup. Page: `/orders/deleted` (button on Orders for keepers).
- **ISO priced per foam set** (`0030_iso_set_prices.sql`): foam is sold by the set, so ISO going with a closed-cell
  resin can cost more than ISO going with an open-cell resin on the same order. When an ISO line is split across
  resins (`foamLoads`), the price form shows one box per set (`priceLines()` in `lib/order-doc/loads.ts`) and sends
  `{ id, parts: [{ with: resin item id | null, qty, price }] }`. `order_items.price_parts` keeps the sets;
  `line_total` is their sum and `unit_price` the average, so goals and reports are unchanged. `rowPrice()` gives each
  printed row its own price on the order page, PDF, emails and approval page.
- **Last prices**: until an order is priced, the price step starts from what the same customer was invoiced on their
  orders placed in the last 30 days (`customerLastPrices()` in `lib/order-doc/load.ts`, `lastPricesFrom()` in
  `loads.ts`): newest price per SKU, ISO per foam set (the resin SKU it went with; a pre-0030 ISO line that covered
  several resins with one price is skipped). Each box shows "From ORD-…" or "Last price … · Use it"; a note asks the
  desk to check them against the invoice. No database change.
- **Sales goals**: `categories.goal_group` (foam, fiberglass, ppe, roof, guns, intumescent, sealants, supplies;
  Admin → Products → Categories), `sales_goals` (person × group, monthly dollars; Admin → Sales goals,
  `admin_set_sales_goals`). `sales_goal_board(month, person)` returns each person's sales by group for the month (orders
  placed that month, not cancelled, priced lines only): sales reps by `orders.sales_rep_id`, warehouse managers
  (`job_role = warehouse`) by `orders.branch_id`. Home: "Your sales goals" (reps, warehouse) and "Sales goals"
  (admins); `/sales-goals` has the month-by-month table.

Home "Jump back in" checks remembered orders with `openOrders()` and drops deleted, cancelled and completed ones.

### Home board (Customize) and Outlook

Everything below the greeting on Home is one board (`components/home-board.tsx`): the job cards (`roleCards()` in
`components/home-widgets.tsx`), Outlook calendar and inbox, News & sales (banner), Your apps, Place an order, Jump back
in, Tech bulletins, AMBIT products and Keep learning. On a computer it's a masonry wall: CSS grid with 8px rows, each
card spanning as many rows as it is tall (measured with a ResizeObserver), so cards tuck up under each other; on a
phone it's one column. "Customize" (the grid button in the Home header, or "Customize Home" under the board): drag
(mouse) or press-and-hold then drag (touch) to move a card, arrows for keyboard, the eye hides it; saved to
`profiles.home_layout` (`saveHomeLayout`, 0029) and merged with the cards a person has by `arrangeBoard()`
(`lib/home-board.ts`). Hidden cards aren't loaded.

Outlook (`lib/outlook.ts`, `components/outlook-widgets.tsx`): each staff member taps "Connect Outlook"
(`/api/microsoft/outlook`), signs in with their Microsoft 365 account and allows `Mail.Read Calendars.Read`
(read only); Microsoft returns to the already-registered `/api/microsoft/callback`, which sees the `ms_oauth_for=outlook`
cookie and stores that person's tokens in `user_ms_tokens` (RLS, no policies: server key only). The cards read the
inbox (unread count + newest 6) and the next 7 days of calendar (`calendarView`, Central time; Jacksonville Eastern).
Setup (once, Microsoft Entra → App registrations → AMBIT Intelligence → API permissions): add Microsoft Graph delegated
`Mail.Read` and `Calendars.Read`, then "Grant admin consent".

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
app/(app)/         signed-in screens (home, order, orders, takeoff, inventory, docs, academy, directory, profile, admin, ops)
app/p/, app/lead/  public pages: a customer's proposal (sign online) and the website lead form
app/api/           Ask AMBIT answers, inventory sync timer, Microsoft connect / callback, version check
app/auth/          OAuth/email-link callback and sign out
components/        UI pieces (order builder, tab bar, CSV import, doc upload)
lib/               Supabase clients, session/role helpers, email, formatting, assistant/ (Ask AMBIT rules, app guide, Claude loop)
supabase/          database schema, starter data and storage rules
```
