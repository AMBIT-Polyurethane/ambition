import { can, type Perm } from "@/lib/access";
import type { Profile } from "@/lib/types";

// How to use AMBIT Intelligence, written for the assistant. Each section says who it's for, and the
// assistant only ever gets the sections the person asking can use: contractors never see staff screens.
// Keep this in step with the app when screens change (README.md has the same features in more detail).

type Section = { who: "all" | "staff" | "customer" | "admin"; perm?: Perm; anyPerm?: Perm[]; title: string; body: string };

const SECTIONS: Section[] = [
  {
    who: "all",
    title: "The app",
    body: `AMBIT Intelligence ("AMBIT A.I.") is AMBIT Polyurethane's app for AMBIT staff and contractor customers. It runs in any browser at https://ambition-pi.vercel.app and works the same on phones and computers. On a phone the main screens are in the tabs along the bottom; on a computer they're in the menu down the left side.
- Put it on a phone's home screen: iPhone: open it in Safari, tap the Share button, then "Add to Home Screen". Android: in Chrome tap the ⋮ menu, then "Install app" or "Add to Home screen".
- On a computer: Chrome or Edge show "Install on this computer" at the bottom of the left menu (its own icon and window). On a Mac in Safari: File → Add to Dock.
- Home ([Home](/)) has "Your apps" (colored tiles). Tap "Edit" next to Your apps ([Edit apps](/profile/apps)) to reorder or hide tiles.
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
- Smart reorder: once you've ordered something a few times, Home shows a "Time to reorder?" card, e.g. "You usually order 4 sets of AMBI-SEAL 5.0 every 3 weeks. Reorder for Thursday?". "Reorder for …" opens an order with just the items that are due and the Needed-by date filled in; "Everything I usually order" adds all your regular items. Check the quantities, then send it as usual.
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
2. Pick the customer: type part of the name to search AMBIT's customer list (imported from QuickBooks). New customer? Use "Add new customer"; accounting is emailed to set them up in QuickBooks.
3. Add items; the shipping address can be changed ("Use address on file" or type a new one). Staff see the exact number available at locations with live inventory.
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
    body: `[Orders](/orders) lists orders. Each order moves: customer approval → CRM enters the AMBIT PO # → Accounting releases it (or puts it on credit hold) → CRM sets the delivery or pickup date and the customer is emailed → marked delivered / picked up. Each step shows on the order page for whoever's job it is. [Order desk](/orders/desk) shows what's waiting on you, with counts.`,
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
    body: `[Inventory](/inventory): enter counts, stock received, and damaged / used stock for your location. Oklahoma City's numbers stay in step with the OKC inventory spreadsheet in OneDrive (the sheet's COUNT SHEET and PENDING ORDERS tabs): orders reserve stock as soon as they're placed, and pickup or delivery takes it out of TOTAL IN STOCK.`,
  },
  {
    who: "staff",
    perm: "takeoff",
    title: "Takeoff: measuring plans (staff)",
    body: `[Takeoff](/takeoff) replaces STACK for measuring plans. Works best on a computer.
1. "New takeoff": job name and customer, then Create.
2. Drag the plan PDFs onto the screen (or "Upload plans"). Each page becomes a sheet; sheet numbers (A2.1) and the scale written on the sheet (1/4" = 1'-0", 1" = 20') are read automatically when the PDF has text.
3. Check the scale. If a sheet has no scale, a yellow bar says so: "Set scale", then either pick the scale from the list or draw a line over a dimension you know and type its length (e.g. 24'-6"). Always check one known dimension before measuring.
4. "New item" and pick a preset (Exterior walls, Attic floor/ceiling, Roof deck, Vaulted ceiling, Rim joist, Garage common wall, Can lights) or make your own with material, thickness and R-value. Areas can have a roof pitch (rise per 12); walls have a wall height and openings to subtract.
5. Measure: Area: click each corner, click the first point to close. Walls / lengths: click along the wall, double-click or Enter to finish. Count: click each one. Cutout (X) takes an opening out of an area.
6. Totals (square feet, feet, board feet for spray foam, counts) update on the right. "Report" gives totals by item, material and sheet; "Print / Save PDF" and "Excel".
Keys: V select, H move, S scale, A area, L linear, C count, X cutout, Enter finish, Esc cancel, Backspace removes the last point, Shift for straight lines, Space or scroll to move and zoom, Ctrl/⌘ Z undo.
Reading plans: sheet numbers start with a letter for the discipline (A architectural, S structural, M mechanical, E electrical, P plumbing); floor plans and roof plans give areas, building sections and wall sections show assemblies and ceiling heights, and energy or general notes list required R-values. The scale applies to the drawing it's written under; details on the same sheet can have their own scale.`,
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

export function appGuideFor(p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }): string {
  const staff = p.role === "employee" || p.role === "admin";
  const keep = SECTIONS.filter((s) => {
    if (s.who === "admin") return p.role === "admin";
    if (s.who === "staff" && !staff) return false;
    if (s.who === "customer" && staff) return false;
    if (s.perm && !can(p, s.perm)) return false;
    if (s.anyPerm && !s.anyPerm.some((k) => can(p, k))) return false;
    return true;
  });
  return keep.map((s) => `### ${s.title}\n${s.body}`).join("\n\n");
}
