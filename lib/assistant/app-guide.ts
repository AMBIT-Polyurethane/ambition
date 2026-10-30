import { can, type Perm } from "@/lib/access";
import type { Profile } from "@/lib/types";

// How to use AMBIT Intelligence, written for the assistant. Each section says who it's for, and the
// assistant only ever gets the sections the person asking can use: contractors never see staff screens.
// Keep this in step with the app when screens change (README.md has the same features in more detail).

// ops: "crm" = contractors in an AMBIT-OPS workspace who work leads (not crews); "field" = crews and subs.
type Section = { who: "all" | "staff" | "customer" | "admin"; perm?: Perm; anyPerm?: Perm[]; ops?: "crm" | "field"; title: string; body: string };

// Takeoff works the same for AMBIT staff and for contractors, so both sections share these steps.
const TAKEOFF = `1. "New takeoff": job name and customer, then Create.
2. Drag the plan PDFs onto the screen (or "Upload plans"). Each page becomes a sheet; sheet numbers (A2.1) and the scale written on the sheet (1/4" = 1'-0", 1" = 20') are read automatically when the PDF has text.
3. Check the scale. If a sheet has no scale, a yellow bar says so: "Set scale", then either pick the scale from the list or draw a line over a dimension you know and type its length (e.g. 24'-6"). Always check one known dimension before measuring.
4. AI pre-scan (optional): "AI pre-scan" (or "Let AI read the plans first"), tick the sheets to read (floor plans, sections and energy notes help most; about 20 seconds a sheet), then "Read". It lists the insulation called out (with the plans' exact words), roof pitches, wall heights, framing, garage, porch and attic, then asks a few questions: is the garage part of the conditioned house, is the attic sealed (foam at the roof deck) or vented, are the porch and garage attics walled off, the pitch, framing and wall heights. It then lists the items to set up: one exterior-wall item per wall height, roof deck or attic floor, attic demising walls (the gable walls between a sealed attic and a vented porch or garage attic, sized from the pitch), garage common wall, knee walls, rim joist. Untick any you don't want, rename them, "Set up N items". You still trace every shape, and check depths and R-values: AI can misread small print.
5. Or "New item" and pick a preset (Exterior walls, Attic floor/ceiling, Roof deck, Vaulted ceiling, Knee walls, Attic demising wall, Rim joist, Garage common wall, Can lights) or make your own with material, thickness and R-value. Items can have a work area (for the quote). Areas can have a roof pitch (rise per 12); walls have a wall height and openings to subtract, or the "Gable (attic demising wall)" shape: trace the bottom of the wall and its triangle is worked out from the pitch.
6. Measure: Area: click each corner, click the first point to close. Walls / lengths: click along the wall, double-click or Enter to finish. Count: click each one. Cutout (X) takes an opening out of an area.
7. Fix a shape: with Select (V), click a shape to select it; drag a corner dot to move it; click anywhere on its edge to add a new corner there (and drag it); double-click a corner to remove it.
8. Undo and Redo (buttons at the top, or Ctrl/⌘ Z and Ctrl/⌘ Shift Z): go back or forward up to 60 steps (adding or deleting a shape, moving corners, adding, changing or deleting an item, setting the scale). Hover a button to see what it will undo or redo.
9. Totals (square feet, feet, board feet for spray foam, counts) update on the right. "Report" gives totals by item, material and sheet; "Print / Save PDF" and "Excel". "Material order" turns it into an AMBIT order.
Keys: V select, H move, S scale, A area, L linear, C count, X cutout, Enter finish, Esc cancel, Backspace removes the last point, Shift for straight lines, Space or scroll to move and zoom, Ctrl/⌘ Z undo, Ctrl/⌘ Shift Z or Ctrl Y redo.
Reading plans: sheet numbers start with a letter for the discipline (A architectural, S structural, M mechanical, E electrical, P plumbing); floor plans and roof plans give areas, building sections and wall sections show assemblies and ceiling heights, and energy or general notes list required R-values. The scale applies to the drawing it's written under; details on the same sheet can have their own scale.`;

const SECTIONS: Section[] = [
  {
    who: "all",
    title: "The app",
    body: `AMBIT Intelligence ("AMBIT A.I.") is AMBIT Polyurethane's app for AMBIT staff and contractor customers. It runs in any browser at https://ambition-pi.vercel.app and works the same on phones and computers. On a phone the main screens are in the tabs along the bottom; on a computer they're in the menu down the left side.
- Put it on a phone's home screen: iPhone: open it in Safari, tap the Share button, then "Add to Home Screen". Android: in Chrome tap the ⋮ menu, then "Install app" or "Add to Home screen".
- On a computer: Chrome or Edge show "Install on this computer" at the bottom of the left menu (its own icon and window). On a Mac in Safari: File → Add to Dock.
- Home ([Home](/)) has "Your apps" (colored tiles). For AMBIT staff the everyday apps (Ask AMBIT, Order, Order desk, Inventory, AMBIT-OPS) sit right on the home screen and the rest are in folders: "Sales tools" (Paste an order, Due to order, My price requests), "Employee forms" (Expenses, Time off, Travel and the other forms), "Learn & resources" (Bulletins, Product docs, Academy, Directory, Branches) and, for admins, "Admin tools". Tap a folder to open it. AMBIT staff also get a few cards for their job under the greeting (see "Home screen cards"). Everyone can rearrange Home: tap the grid button at the top of Home (or "Customize Home" at the bottom), then drag a card to move it (on a phone, press and hold a card for a moment, then drag; or use the up/down arrows) and tap the eye to hide or show a card; tap Done. The layout is saved to your account, so it follows you to every phone and computer; Reset puts it back. On a computer the cards sit in columns and tuck up under each other. AMBIT staff can add their Outlook: the "Outlook calendar" and "Outlook inbox" cards have "Connect Outlook"; sign in with your AMBIT Microsoft account once and the cards show your next 7 days of meetings and your newest emails with the unread count (the app can only read them; tap one to open it in Outlook; "Disconnect" at the bottom of the card removes the connection). Tap "Edit" next to Your apps ([Edit apps](/profile/apps)) to reorder or hide tiles. Admins choose which folder a form from Admin > Links goes in.
- Screens show a grey outline the moment a link is tapped, then fill in.
- Light or dark look: [Profile](/profile) → Appearance (Dark, Light or Auto).
- When AMBIT updates the app, it updates itself; sometimes a bar at the top says "A new version of AMBIT A.I. is ready" with an Update button.
- Forgot password: on the sign-in screen tap "Forgot password?".`,
  },
  {
    who: "customer",
    title: "Placing an order (contractors)",
    body: `[Order](/order): search or browse products, set quantities, then "Review order".
- Fiberglass batts can be ordered by bags or by square feet (square feet round up to whole bags).
- Spray foam and fiberglass show "Based on customer pricing": your price is confirmed on the invoice. Other items show list price (or a sale price).
- Locations with live inventory show In stock / Low stock / Ships from supplier on each item.
- On the review screen choose pickup at an AMBIT location, delivery to a job site, or drop ship; add a "Needed by" date, your PO number and "Notes for AMBIT"; then send it. You'll be asked to approve the order in the app ("Approve order") so AMBIT knows it's final.
- Home has "Reorder", which starts a new order with the same items as your last one.
- Smart reorder: once you've ordered something a few times, Home shows a "Time to reorder?" card, e.g. "You usually order 4 drums of AMBI-SEAL 5.0 every 3 weeks. Reorder for Thursday?". "Reorder for …" opens an order with just the items that are due and the Needed-by date filled in; "Everything I usually order" adds all your regular items. Check the quantities, then send it as usual.
- There's no online payment; AMBIT invoices as usual.`,
  },
  {
    who: "customer",
    title: "Sales-tax exemption certificate (contractors)",
    body: `If your company buys tax-exempt, AMBIT needs a current exemption or resale certificate on file. [Profile](/profile#tax) → "Sales-tax exemption": upload a photo or PDF of the certificate, pick the state and type, and enter its expiration date ("Doesn't expire" if it has none). AMBIT Accounting verifies it; until then it shows "Waiting for Accounting to verify".
- Home shows a reminder 60 and 30 days before it expires, and AMBIT emails a reminder too (once app email is set up). Upload the renewed one before the date.
- If the certificate has expired or isn't on file, new orders wait at AMBIT's credit check until a current one is verified, or Accounting can charge sales tax on that order instead.`,
  },
  {
    who: "customer",
    title: "My orders (contractors)",
    body: `[My orders](/orders) lists every order with its status (Waiting for your approval, Submitted, Processing, scheduled, Completed, Cancelled). Open one to see items, dates and notes, approve it, or use "Something not right? Request changes". When AMBIT schedules a delivery or pickup you get an email.`,
  },
  {
    who: "staff",
    perm: "ordering",
    title: "Ordering for a customer (staff)",
    body: `[Order](/order) → "Order for a customer":
1. "Which location?": pick the AMBIT location it ships from or is picked up at.
2. "Who's it for?": pick the customer next, before any items (type part of the name, account # or city to search AMBIT's customer list, imported from QuickBooks). Their ship-to address, contact and email fill in for you. New customer? Use "Add new customer"; accounting is emailed to set them up in QuickBooks. The customer shows at the top of the item list ("For …", tap Change to switch).
3. Add items ("Filter available products" under the search box shows only what's in stock and not reserved at that location; it appears for locations with live inventory). The shipping address can be changed ("Use address on file" or type a new one). Staff see the exact number available at locations with live inventory.
4. Review and send. The customer gets an email to approve the order (once app email is set up). If they approved by phone or in person, use "Customer approved by phone or in person?" and record who approved it and how. "Resend approval email" sends it again.
5. After approval the order and its PDF ("THIS IS NOT AN INVOICE") go to orders@ambitpu.com.`,
  },
  {
    who: "staff",
    perm: "ordering",
    title: "Paste an order: AI order intake (staff)",
    body: `[Paste an order](/order/intake) (also the "Paste an order" Home tile, and the "Got the order in a text, email or note?" link at the top of Order): paste a customer's texted or emailed order, or tap "Take photo" / "Add photos" for a handwritten one or a screenshot, then "Read the order".
- AMBIT Intelligence reads it, matches each line to an AMBIT product, guesses the customer and location, and builds a draft. Each line shows how sure it is (green = sure, amber = check it, red = no match). Tap a product to pick a different one; change quantities; pick the customer, location, delivery, PO and dates.
- Questions it couldn't settle (e.g. "Which gun cleaner?") show at the top.
- "Open in Order to finish" carries everything into the normal order review screen; send it there exactly like any order (the customer still approves it). "Save draft" keeps it for later in "Recent drafts"; "Discard" throws it away.
- Always check the draft against the original before sending: the AI can misread handwriting.`,
  },
  {
    who: "staff",
    perm: "ordering",
    title: "Customers due to order (sales reps and CRM)",
    body: `[Due to order](/orders/due) (Home tile, and a "customers are overdue to order" card on Home) lists customers with at least 3 orders whose usual time between orders has passed by a good margin, most overdue first: how often they usually order, their last order, and how many days past usual they are. Tap the phone icon to call, or "Start order" to open an order for them with their usual items already in it.`,
  },
  {
    who: "staff",
    anyPerm: ["ordering", "order_desk", "credit_check", "inventory"],
    title: "Orders and the order desk (staff)",
    body: `For AMBIT staff, orders live in the [Order desk](/orders/desk) (one item in the menu). Its "View orders" button opens the full list ([Orders](/orders)) with search and filters. Sales reps see the Order desk for the orders they placed. Every number and chart on the Order desk dashboard is tappable and opens those orders: the tiles (open orders, waiting over a day, placed, picked up or delivered), a bar on "Orders placed per day" (that day's orders), a slice or status, a location bar, or a step in "Where orders get stuck" (the orders at that step now). The list says what it's filtered to, with "Clear" to see everything. [Orders](/orders) lists orders. Spray foam is ordered by the drum (ISO A-side and each resin B-side separately). The store has one "ISO A-Side": when the order is placed the app picks the brand and lot (Covestro first, then the lot that expires soonest; a lot with no Exp date counts as 12 months after its Mfg date; expired lots are never picked automatically). AMBI-SEAL 5.0 and AMBI-TITE 204 HFO come as Summer and Winter; each takes the lot that expires soonest. AMBIT staff see the brand and lot under each spray foam line on the order page and on the warehouse PDF (customers never see them; "Customer copy" prints without them). Changing what's loaded is done in the "Item variance table" on the order page (admins, and anyone given the "Item variance" box in Admin > Accounts, e.g. the Warehouse Manager): it sits before the Sales Order # step and again before Delivered / Picked up, and lets them "Change lot" (a different lot or ISO brand) or "Load a different type" (Summer ↔ Winter resin, or another product in the same category; a reason is required). Every change is listed on the order with who, when and why; the price stays as ordered, so fix it on the invoice if needed. A line short on stock says "no lot picked yet" until a lot is chosen there. On the order and the printed order form, each resin is shown with the ISO drums that go with it, with a dark line between those groups (e.g. 6 ISO + 4 AMBI-SEAL 5.0 + 2 AMBI-TITE 204 shows as 4 ISO with the 5.0, then 2 ISO with the 204). To cancel an order: open it, then "Cancel this order" at the bottom and give a reason (admins and the order desk; whoever placed it can cancel until it has a Sales Order #); its stock is released. Admins can then "Delete this order": it leaves the app but is saved in the Deleted orders log, where only Jeremiah can see it and put it back (same order #, lines and lots; open again or as cancelled). Jeremiah opens the log from the "Deleted orders" button at the top of [Orders](/orders). Each order moves: customer approval → CRM enters the Sales Order # and the Invoice # (both required, two boxes side by side) and the price of each item from the invoice (required for spray foam and fiberglass; the invoice itself can be uploaded there as a PDF or photo, optional) → Accounting releases it (or puts it on credit hold) → CRM sets the delivery or pickup date and the customer is emailed → marked delivered / picked up, which needs a photo or scan of the signed BOL (tap "Take photo or choose file", then Mark delivered / Mark picked up). Each step shows on the order page for whoever's job it is; the invoice and signed BOL open from "View" links (AMBIT staff only). Until email is set up, "Customer Approved without Email" moves an order past customer approval, and on a scheduled order it records that the customer was told without the email. [Order desk](/orders/desk) opens with a dashboard (admins, the order desk, credit approvals and the warehouse see every order; sales reps see theirs): time range (7 / 30 / 90 days, this year) and location filters at the top, then tiles (open orders now, waiting over a day, orders placed, picked up or delivered, typical order time), a donut of open orders by status (tap a status to list those orders), orders placed per day or week, open orders by location split by status, and "Where orders get stuck" (typical hours for customer approval, Sales Order #, credit check and scheduling, plus the orders waiting longest). Every chart has "Show the numbers". Below it, the order lists by status follow the same filters.`,
  },
  {
    who: "staff",
    perm: "credit_check",
    title: "Sales-tax exemption certificates (Accounting)",
    body: `[Tax certificates](/tax) (Home tile and left menu) lists every customer marked tax-exempt with the state of their certificate: Certificate current, Expires soon (within 60 days), Certificate expired, No certificate on file, or Waiting for Accounting to verify. Filters and search at the top; Home shows a card when any need attention.
- Open a customer to mark them tax-exempt (or not), add a certificate (photo or PDF, state, type, number, expiration date) or verify / turn down one the contractor uploaded. Certificates Accounting adds are verified right away.
- Reminder emails go to the customer 60 and 30 days before expiry and when it expires, with Accounting copied (once app email is set up).
- An order from a tax-exempt customer whose certificate is expired, missing or unverified is held at credit check: "Release" is blocked unless you tick "Charge sales tax on this order instead", which is noted on the order.`,
  },
  {
    who: "staff",
    perm: "price_requests",
    title: "Price requests (sales reps)",
    body: `Open the "Price Request Form" tile on Home (a Jotform form), pick the products to quote and submit. [My price requests](/price-requests) shows each request, its status and the approved prices; you get an email when prices are approved.`,
  },
  {
    who: "staff",
    perm: "prf_approve",
    title: "Approving price requests",
    body: `[Price approvals](/price-requests/approvals): waiting requests are first. Open one, enter the approved price for each line (requested vs approved side by side), and save: the prices are written back into the Jotform submission and the rep is emailed.`,
  },
  {
    who: "staff",
    title: "Expenses (AMBIT staff)",
    body: `[Expenses](/expenses): snap every receipt when you use the company card.
1. "Add a receipt" opens the AMBIT Expense Receipt form (already filled in with your name): date, store, amount, category, what it was for, company card or personal, and a photo of the receipt.
2. The Expenses screen shows the month's total, categories and receipts.
3. At month end, "Send to Corporate" emails your report (a PDF with every receipt photo) to Jeremiah, Kim and Kevin. "Download PDF" works any time.`,
  },
  {
    who: "staff",
    perm: "inventory",
    title: "Inventory (staff)",
    body: `[Inventory](/inventory): enter counts, stock received, and damaged / used stock for your location. Oklahoma City's numbers stay in step with the OKC inventory spreadsheet in OneDrive (the sheet's COUNT SHEET and PENDING ORDERS tabs): orders reserve stock as soon as they're placed, and pickup or delivery takes it out of TOTAL IN STOCK. Spray foam (ISO brands, AMBI-SEAL 5.0 and AMBI-TITE 204, Summer and Winter) is counted by lot on the sheet's FOAM LOTS tab, laid out like the old inventory sheet: Starting Qty, Shipped Out, Shipped In, Adj, Remaining, Pending Pickup, Available and Use By for each lot, with Total ISO / Open Cell / Closed-Cell. Keep Starting Qty, Shipped In and Adj up to date there (a new lot = a new row with its SKU, Lot #, Mfg and Exp dates and Starting Qty); the app adds pickups to Shipped Out, and those items' TOTAL IN STOCK on the COUNT SHEET adds up their lots. On the Inventory screen, tap a foam item to see its lots. Damaged drums: take them off their lot with Adj and list them under DAMAGED DRUMS.`,
  },
  {
    who: "staff",
    title: "Home screen cards (AMBIT staff)",
    body: `Under the greeting on [Home](/), AMBIT staff get a few cards for their job (tap any line to open those orders or that screen):
- Warehouse manager: "Daily spot check" (one item a day to count, see below; a red alert when a day was missed) and "This week" (a 7-day calendar for their location: blue dots = pickups, orange = deliveries, green = incoming trucks; tap a day to see them; anything late shows on today in red; "+ Expected delivery" adds an incoming truck).
- Order desk (CRM): "Your order desk" (orders needing a Sales Order # and Invoice #, released and needing a date, picking up or delivering today, past their date, waiting on the customer) and "This week".
- Accounting / credit approvals: "Credit approvals" (credit checks waiting, credit holds, tax certificates to verify or expiring).
- Sales reps and warehouse managers: "Your sales goals" (this month's sales in dollars against their monthly goal, in total and for each product group, with a line on each bar for where the month is: reach it and you're on pace; reps also see customers overdue to order). See "Sales goals".
- Admins: "Sales goals" (each rep and warehouse manager against their goal), "Waiting on you" (inventory counts to approve, credit applications, access requests, staff needing a job role, tax certificates), "Sales" (orders placed this month against the same point last month, by location, and the top 3 products by how many orders had them) and "Inventory movement" (what's ordered more or less than the 30 days before, and each location's spot check today).
Sales numbers are orders placed in the app at list price; QuickBooks invoiced sales come later.`,
  },
  {
    who: "staff",
    title: "Sales goals and sales reps (AMBIT staff)",
    body: `Every customer has a sales rep (Admin > Customers: open a customer and pick the Sales rep, or tap "No sales rep", tick several customers, pick the rep and tap Assign; the customer spreadsheet import also takes a "Sales Rep" column). Every order from that customer counts toward that rep's goals, whoever typed it in; the order page shows the Sales rep. Sales reps see their customers' orders on the Order desk too.
Prices: when the order desk enters the Sales Order # and Invoice #, they also type the price of each item from the invoice. Spray foam, fiberglass and anything else priced per customer must have a price; other items start at list price and can be changed to match the invoice. Those prices are what sales goals count. Spray foam is priced by the set, so when the ISO (A side) on an order goes with more than one resin (for example 12 drums with AMBI-TITE 204 closed cell and 3 drums with AMBI-SEAL 5.0 open cell), the ISO gets a separate price box for each set ("ISO for the AMBI-TITE 204 HFO set", "ISO for the AMBI-SEAL 5.0 set"). Enter each as a price per drum: the invoice amount for that line divided by its drums (a per-pound invoice line of 6,000 lb at $2.17 = $13,020, ÷ 12 drums = $1,085). The order page and PDF then show each set's ISO at its own price. If the same customer had an order priced in the last 30 days, the price boxes start filled in with the price from their most recent order for each SKU (and for the ISO, the price for the same foam set), marked "From ORD-…": check each against the new invoice and change any that differ. On an order that's already priced, each box shows the customer's last price with "Use it" to copy it in.
Goals: admins set them in Admin > Sales goals: for each sales rep and warehouse manager, a monthly dollar goal for each group: Foam Products, Fiberglass, Personal Protective Equipment, Roof Coatings & Sealants, Gun & Parts, Intumescent Coatings, Sealants / Adhesives, and Tools, Accessories & Supplies (everything else). Each product category belongs to one group (Admin > Products & pricing > Categories). Sales reps are measured on their customers' orders; warehouse managers on every order from their location. Orders count in the month they were placed (cancelled ones don't). Progress: the Home card, or [Sales goals](/sales-goals) (admins see everyone in a table and can go back month by month).`,
  },
  {
    who: "staff",
    perm: "inventory",
    title: "Spot checks, inventory reconciliation and expected deliveries (staff)",
    body: `Daily spot check: every weekday the app picks one item at each location (never the same item twice until every item has had its turn, then it starts over). The warehouse manager counts it from the Home card (or [Inventory](/inventory) > Spot check): type what's on the shelf (spray foam lot by lot) and "Save count". The app's number isn't shown, so it's a real count. If it matches, it's done. If not, it goes to an admin to approve before stock changes. A weekday that isn't counted stays on the list with a red alert until it's done.
Inventory reconciliation (the quarterly count): [Inventory](/inventory) > "Perform Inventory Reconciliation" > Start. Every item (spray foam by lot) is listed by category; type each count, it saves as you go (stop and come back any time), "Not counted yet" shows what's left, and a blank item isn't changed. Then "Send for approval". An admin opens it (Home > Waiting on you, or [Counts](/inventory/counts)), checks the differences ("App had", "Counted", "Difference") and taps Approve or "Don't approve". Approved differences go onto the spreadsheet: TOTAL IN STOCK on the COUNT SHEET, or Adj on FOAM LOTS for spray foam, with who counted it. Anything picked up after the count is already taken into account.
Expected deliveries: [Incoming deliveries](/inventory/incoming) > "+ Expected delivery": who it's from, the day it's expected, PO # / BOL # (optional) and the items and quantities. It shows on the warehouse calendar. When the truck arrives, open it, enter what actually came (spray foam needs the lot #, and the Mfg and Exp dates if you have them) and tap "Received: add to stock". Everything else is added to TOTAL IN STOCK; spray foam goes onto FOAM LOTS (a new lot gets its own row, a lot already there gets Shipped In).`,
  },
  {
    who: "staff",
    perm: "takeoff",
    title: "Takeoff: measuring plans (staff)",
    body: `[Takeoff](/takeoff) replaces STACK for measuring plans. It lives under [AMBIT-OPS](/ops) (Home tile and left menu). Contractors with AMBIT-OPS have the same Takeoff for their own jobs. Works best on a computer.
${TAKEOFF}`,
  },
  {
    who: "customer",
    ops: "crm",
    title: "AMBIT-OPS: leads, customers and settings (contractors)",
    body: `[AMBIT-OPS](/ops) is the contractor's own business software inside the app: the work in order, left to right: Leads, Customers, Quotes (with Takeoff for measuring plans), Schedule (jobs, the rig board and stock), then Work orders and Invoices (coming Nov 26) and Job costing (Dec 1). Home shows a "Get set up" checklist, your tasks for today and the latest leads.
Leads ([Leads](/ops/pipeline)): a board with a column per stage (New lead, Contacted, Appointment set, Quote sent, Follow-up, Won, Lost). Drag a card to another column, or use its "Move to…" menu; on a phone pick the stage at the top and use "Move to…" on the card. Moving a lead to Lost always asks why (Price, Timing, Went with someone else…) so you can see later why jobs were lost. "+ New lead": type a name and phone (or pick an existing customer), the job address, what they need, where the lead came from, a rough value and a follow-up date. If the phone or email already belongs to a customer, it offers to use that customer instead of making a duplicate.
A lead's page: the stage path across the top (tap a stage to move it), "Next step" button, a box to log a Note, Call, Text or Email to the timeline, Tasks ("Add a task" with a due date and who it's for; tick it when done), the customer's call / text / map buttons, Details (job name, services, rep, source, value, follow-up, job address), "Mark lost" and "Delete this lead".
Sales reps see only their own leads (the ones assigned to them or that they added). Crews don't see leads, customers or prices.
Customers ([Customers](/ops/customers)): search by name, phone or email; filter Homeowners or Builders & companies. A customer's page has their jobs and leads, addresses (with gate codes) and notes. "Import" brings in a spreadsheet (Excel or CSV from QuickBooks, Jobber, an old CRM): match the columns, check every row, and repeats (same phone or email) are skipped unless you tick "Import them anyway". "Undo that import" on the Customers page removes the whole import for 3 days.
Website lead form: Settings > Website lead form gives a link (and a QR code and website code) that customers fill in to ask for a quote; each request lands on the Leads board as a New lead with the customer, address and what they need filled in. "Make a new link" stops the old one.
Settings ([Settings](/ops/settings), owners and office managers): Company and logo (shows on everything customers see); Team (invite people by email and give each a role: Owner, Office manager, Scheduler/Dispatcher, Sales/estimator, Crew lead, Crew member, Accounting, Subcontractor); Pricing, margins and labor (target margin for homeowners and for builders, lowest margin, tax, deposit, how long quotes are good for, labor burden; labor defaults: open cell $500 a set, closed cell $450 a set, blown attic $0.05 a sq ft, BIBS mesh $0.05 plus blowing $0.05 (2x4) or $0.07 (2x6) a sq ft, batts $0.04 to $0.06 a sq ft by R-value, intumescent $0.05 a sq ft; all can be changed); Products and AMBIT costs (foam sets and fiberglass with your AMBIT invoice prices; yields default to 16,500 board feet a set open cell, 3,700 closed cell and 2,800 for AMBI-ROOF, and changing one asks you to confirm; blown fiberglass uses the maker's coverage chart, picked on the product: Knauf Jet Stream Ultra, Johns Manville Climate Pro, Owens Corning L77 or CertainTeed InsulSafe SP; brands AMBIT doesn't stock start turned off with no cost until you type yours); Pipeline and lists (stages, lead sources, lost reasons, work areas, services); Locations; Let AMBIT help (owners only: lets AMBIT open your workspace for 1, 7 or 30 days to help; every visit is listed there).`,
  },
  {
    who: "customer",
    ops: "crm",
    title: "AMBIT-OPS: quotes, proposals and e-sign (contractors)",
    body: `[Quotes](/ops/quotes) (owners, office managers, schedulers and sales/estimators; sales reps see their own). Start one from a lead ("Build the quote" on the lead's page), from a takeoff ("Quote it"), or Quotes > "New quote" (pick the lead or find the customer, and optionally a takeoff to pull the measurements from).
The quote screen saves as you type. "Add work" picks a product from your library (foam sets, fiberglass, coatings) or labor, something else, or a credit; each line has its work area (Exterior walls, Attic…), square feet and depth or R-value, and the app works out board feet and sets (spray foam), bags from the maker's coverage chart (blown fiberglass: attic by R-value, walls by framing), bags of batts, the labor from your labor rates, your cost and the price at your target margin. You can type your own price on any line. "From a takeoff" pulls every measured item in as lines. Packages: save a set of lines ("Save package") and drop it into any quote.
Options: a quote can have several options (the + tab copies the current one so you only change what's different); "Name them Good, Better, Best" names them for you. The customer picks one when they sign. Add-ons are extras the customer can tick (air sealing, removal…).
Totals on the right: price, your cost, margin (green at or above target, red under your lowest margin), tax and deposit. An option under the lowest margin needs the owner or office to "OK it" before a sales rep can send it.
Sending: "Send to the customer": "Email it" (the customer gets a link; replies go to you) or "Just get the link" to copy it and text or email it yourself. "PDF" downloads the proposal. The quote moves to Sent and the lead to Quote sent; when the customer opens the link it shows Opened and a note goes on the lead's timeline.
The customer's proposal page (works on a phone, no login): their options and add-ons, the totals, your terms, product documents (data sheets, code reports, warranty), then "Accept and sign": type their name, draw a signature with a finger or mouse, tick to agree and "Sign for $…". The quote becomes Signed with the option, add-ons, total, time and IP saved; the lead moves to Won. They can also decline with a reason. Signed quotes can't be changed: "Make a copy" for a new version.
"Create material order" (on a quote or a takeoff) turns the work into an AMBIT order: whole sets of foam (ISO and resin drums), bags of fiberglass; change the counts, then it goes into your Order cart to place like any order. Products you don't buy from AMBIT are listed separately.`,
  },
  {
    who: "customer",
    ops: "crm",
    title: "AMBIT-OPS: jobs, the rig board and stock (contractors)",
    body: `Jobs: when a customer signs a quote online, the job is made by itself with all the signed work (the option and add-ons they picked) in one trip. If the customer said yes another way (a signed paper proposal, in person, by phone), open the quote and tap "Customer said yes another way": pick the option and add-ons, say how they said yes, "Mark it sold". [Jobs](/ops/jobs) lists them ("Not scheduled" first); a job's page has the customer, address and gate code, the trips, "Notes for the crew" (shown on every trip), and "Cancel this job".
Trips: one job can need more than one visit (foam at rough-in, blown attic after drywall). On the job page tick the work that goes later and "Move" it to "A new trip" (or another trip). Each trip goes on the board on its own.
Rigs and crews ([Rigs and crews](/ops/schedule/rigs), owner, office and dispatcher): add each rig with its name, home shop, what it does (open cell, closed cell, roofing foam, blown-in, batts, coatings) and "A day's work": open cell sets, closed cell sets and square feet of blown or batts it usually does in a day (they start at 1 open cell set, 2 closed cell sets, 4,000 sq ft). Pick its color and its regular crew (tick people, pick the lead). Crew list: people with a crew login (crew lead, crew member or sub on the Team page) are added by themselves; add helpers by name with "Add someone by name".
The rig board ([Schedule](/ops/schedule)): rigs down the side, the week across (arrows for other weeks). "Not scheduled" on the left lists sold trips with their work and about how many days they take. Drag one onto a rig and day (on a phone, tap it): it takes the suggested number of days for that rig, and the rig's regular crew goes on it. Tap any trip to change the rig, first day, how many days ("Use it" puts back the suggested days), start time, crew and lead, and a note for the crew; "Take off the board" puts it back in Not scheduled. A small number on a day means that rig has more than one trip that day. Phones show the week day by day.
Stock ([Stock](/ops/stock)): the shop and every rig hold stock: ISO drums by maker (Covestro, Wanhua) and lot, resin drums by lot, bags and supplies. AMBIT orders are added to the first shop by themselves when AMBIT marks them picked up or delivered, with the lots AMBIT loaded. "Add stock" is for a starting count or anything bought elsewhere (where, what, how many: half a drum is 0.5, ISO maker, lot #). "Count or move" on any line: save what's really there, or move drums to a rig. "Reorder at" sets a reorder point; anything below it shows under "Running low" with "Order what's low from AMBIT". "On the way from AMBIT" lists open AMBIT orders.
Stock check: "Stock check" on a trip (or "Stock check for this week" on the board) compares what the work needs (foam in whole sets: one ISO drum and one resin drum each; bags) with what's on the rig, in the shop and on the way, shows what's short and what to load onto the rig first, and "Order what's short from AMBIT" puts it in the order cart.
Crews see their own next 7 days on their AMBIT-OPS home (no prices). The OPS Home "Schedule" card counts trips to schedule and trips in the next 7 days.`,
  },
  {
    who: "customer",
    ops: "crm",
    title: "Takeoff: measuring plans (contractors)",
    body: `[Takeoff](/takeoff) measures plans for your quotes (Quotes > "Takeoffs"). Works best on a computer. "Quote it" at the top of a takeoff starts a quote with every item already in it.
${TAKEOFF}`,
  },
  {
    who: "customer",
    ops: "field",
    title: "AMBIT-OPS for crews",
    body: `Crew members, crew leads and subs open to their AMBIT-OPS home. "Your next 7 days" lists every trip they're on: the day(s) and start time, the rig, the customer, the address (tap for the map), the gate code, the work by area (square feet, depth or R-value, sets or bags), who else is on the crew, the office's notes and a button to call the customer. Starting Nov 26 they'll also clock in and out, log the sets sprayed with their lots, and take the job photos there. Crews never see prices, leads or customer lists.`,
  },
  {
    who: "admin",
    title: "Turning on AMBIT-OPS for a contractor (admins)",
    body: `Admin > AMBIT-OPS workspaces ([AMBIT-OPS workspaces](/admin/ops)). "Turn on AMBIT-OPS for a customer": search the customer, pick who the owner is (one of their logins, or "Someone else: send them an invite" with email, name and cell), then "Turn on AMBIT-OPS". Their product library starts with AMBIT foam sets and fiberglass priced from their own AMBIT invoices. The owner then invites their own team. "Turn off" hides it (nothing is deleted); "Turn back on" restores it. "Demo workspace": name it and "Create and open" to try everything with made-up data. AMBIT staff can open a contractor's workspace only when the owner has turned on "Let AMBIT help" in their settings (or it's a demo); each visit is logged for the owner to see. A yellow bar shows while you're inside a workspace; "Leave" takes you back.`,
  },
  {
    who: "all",
    title: "Product docs and bulletins",
    body: `[Product docs](/docs) has AMBIT's technical data sheets, safety data sheets (SDS), code reports (ICC-ES ESR, CCRR), application guides, warranties and brochures, grouped by product, with filter chips (Data sheets, Safety (SDS), Code reports, Guides & warranties, Brochures, Bulletins). [Bulletins](/docs?type=tsb) are AMBIT's technical service bulletins (TSBs). Tap any document to open it.`,
  },
  {
    who: "all",
    title: "AMBIT Academy",
    body: `[Academy](/academy) lists AMBIT Academy's building-science courses for AMBIT staff and contractor crews. Lessons, quizzes and certificates are being built; courses marked "Soon" aren't open yet.`,
  },
  {
    who: "all",
    title: "Branches",
    body: `[Branches](/branches) lists AMBIT's locations with addresses, phone numbers and directions: Oklahoma City OK (4708 S Council Rd), Arlington TX, San Marcos TX, Jacksonville FL and Mobile AL.`,
  },
  {
    who: "staff",
    title: "Directory and staff forms",
    body: `[Directory](/directory) is the AMBIT company directory (tap to call or email). Home also has tiles for AMBIT forms you have access to, such as Time Off, Travel Request, Customer Complaint and the Spray Job Data Log; they open the Jotform forms, already linked to your account.`,
  },
  {
    who: "all",
    title: "Profile and account",
    body: `[Profile](/profile): your name, phone and title, Appearance (Dark, Light, Auto), sign out, and "Delete my account" (removes your login; orders you placed stay on file).`,
  },
  {
    who: "admin",
    title: "Admin (admins only)",
    body: `[Admin](/admin) has:
- Accounts: create an account (contractor with company, or AMBIT employee with job role and boxes for what they can use); the person gets a private invite link. "Needs a role" tab for staff without a job role. Turn anyone off instantly.
- Customers (companies), Products (CSV import, sale prices with an end date, square feet per bag for batts), Docs & bulletins, Links (Home-screen form tiles), Home banner (promo slides), Branches, Academy.
- Forms hub: every Jotform form; credit applications and account setup forms wait for approval with credit limit, terms and a note; any submission prints as a PDF.
- Expense reports: every employee's month. Inventory: the Microsoft connection and each location's spreadsheet.
- Ask AMBIT: teach the assistant (TSBs, teaching notes, documents), answer questions sent to AMBIT's expert, review conversations, and settings (who can use it, model, approved websites, daily limits).
- Tax certificates and Complaint reports also have their own tiles and menu items.`,
  },
  {
    who: "all",
    title: "Ask AMBIT (this assistant)",
    body: `[Ask AMBIT](/assistant) answers questions about AMBIT products, building science as AMBIT teaches it, building codes (IECC, IRC, IBC), HVAC design (ACCA, ASHRAE) and how to use this app. Numbered sources under each answer open the document or website it came from. Thumbs up / down tells AMBIT whether an answer helped. When there's no approved source for a question, "Send to AMBIT's expert" sends it to AMBIT; the answer comes back in the same conversation. There's a daily question limit.
- Photos: tap the camera button left of the question box to take a photo or pick up to 4 from the phone. Good for foam problems (shrinkage, cracking, separation, voids, discoloration): Ask AMBIT compares what it sees with AMBIT's TSBs and asks for whatever details are missing (product, lot numbers, temperatures, thickness).
- When it looks like a product problem, the answer shows "Start a complaint report": it opens a complaint report with the photos and details from the conversation already filled in.`,
  },
  {
    who: "all",
    title: "Complaint reports",
    body: `[Complaint reports](/complaints) (shows on Home once you've started one; AMBIT's complaints team always sees it). The quickest way to start one is photos in Ask AMBIT, then "Start a complaint report"; or tap "New report by hand".
- Fill in who and where, product and lot numbers (A and B), date sprayed, where and how thick, substrate and conditions, rig settings, what's wrong (tick the symptoms) and a description. Add more photos with "Take photo" or "Add photos". "Save" keeps the draft.
- "Submit to AMBIT" sends it: it gets a number (CCR-2026-###) and AMBIT is notified. Product and what's wrong are required.
- AMBIT reviews it; the status changes to "AMBIT is reviewing" then "Closed", and AMBIT's review shows on the report.
- "Print" opens a printable copy; use "Print / save PDF".`,
  },
  {
    who: "all",
    title: "Getting help from a person",
    body: `For pricing, credit, delivery problems or anything the app can't do, contact your AMBIT rep or the nearest [branch](/branches). Orders can be emailed to orders@ambitpu.com.`,
  },
];

export function appGuideFor(p: Pick<Profile, "role" | "status"> & { perms?: string[] | null; ops_role?: string | null }): string {
  const staff = p.role === "employee" || p.role === "admin";
  const field = ["crew", "crew_lead", "sub"].includes(p.ops_role ?? "");
  const keep = SECTIONS.filter((s) => {
    if (s.ops === "crm" && (!p.ops_role || field)) return false;
    if (s.ops === "field" && !field) return false;
    if (s.who === "admin") return p.role === "admin";
    if (s.who === "staff" && !staff) return false;
    if (s.who === "customer" && staff) return false;
    if (s.perm && !can(p, s.perm)) return false;
    if (s.anyPerm && !s.anyPerm.some((k) => can(p, k))) return false;
    return true;
  });
  return keep.map((s) => `### ${s.title}\n${s.body}`).join("\n\n");
}
