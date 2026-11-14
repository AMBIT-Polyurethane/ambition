import { filled, is, num, str, starts, type Data, type Field, type Score, type Spec, type Step } from "@/lib/forms/engine";

// Every AMBIT form that used to live in Jotform, rebuilt in the app. Same questions, smarter: they're split into
// short steps, things that don't apply stay hidden, numbers add themselves up, and private numbers are encrypted.

const BRANCHES = ["Oklahoma City, OK", "Arlington, TX", "San Marcos, TX", "Jacksonville, FL", "Mobile, AL", "Field / remote"];
const DEPTS = ["Sales", "Technical Services", "Customer Service", "Manufacturing", "Lab / R&D", "Warehouse & Logistics", "Accounting & Admin", "Leadership"];
const YN = ["Yes", "No"];
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// A full address in four boxes.
const addr = (p: string, label: string, req: boolean | ((d: Data) => boolean) = true, show?: (d: Data) => boolean): Field[] => [
  { t: "text", k: `${p}_street`, label: `${label}: street`, req, w: 6, show },
  { t: "text", k: `${p}_city`, label: "City", req, w: 3, show },
  { t: "state", k: `${p}_state`, label: "State", req, w: 1, show },
  { t: "zip", k: `${p}_zip`, label: "ZIP", req, w: 2, show },
];

// ── Credit Application ───────────────────────────────────────────────────────────────────────────────────────────
const ref = (n: number, req: boolean): Field[] => [
  { t: "head", k: `ref${n}_h`, text: `Trade reference #${n}`, sub: req ? undefined : "Optional" },
  { t: "text", k: `ref${n}_name`, label: "Company name", req, w: 3 },
  { t: "text", k: `ref${n}_acct`, label: "Your account # with them", w: 3 },
  { t: "tel", k: `ref${n}_phone`, label: "Phone", req, w: 3 },
  { t: "email", k: `ref${n}_email`, label: "Email", w: 3 },
  ...addr(`ref${n}`, "Address", false),
];
const signer = (n: number, show?: (d: Data) => boolean): Field[] => [
  { t: "signature", k: `sign${n}`, label: `Authorized signer #${n}`, req: true, show },
  { t: "text", k: `sign${n}_name`, label: "Printed name", req: true, w: 3, show },
  { t: "text", k: `sign${n}_title`, label: "Title", req: true, w: 3, show },
  { t: "date", k: `sign${n}_date`, label: "Date", req: true, w: 2, show },
  { t: "text", k: `sign${n}_street`, label: "Street address", req: true, w: 4, show },
  { t: "text", k: `sign${n}_csz`, label: "City, state, ZIP", req: true, w: 6, show },
];

export const creditApp: Spec = {
  key: "credit_app", title: "Credit Application", short: "Credit app", icon: "card", group: "customer", publicLink: true, decide: true,
  desc: "A customer applies for terms. Accounting checks the bank and references, then sets the line.",
  summary: (d) => [str(d.company_name), num(d.credit_requested) !== null ? `${usd(num(d.credit_requested)!)} requested` : ""].filter(Boolean).join(" · "),
  steps: [
    { key: "biz", title: "Your business", sub: "Who we're extending credit to and who pays the bills.", fields: [
      { t: "text", k: "company_name", label: "Company legal name", req: true, w: 6 },
      { t: "text", k: "ap_contact", label: "Accounts payable contact", req: true, w: 3 },
      { t: "tel", k: "ap_phone", label: "A/P phone", req: true, w: 3 },
      { t: "email", k: "ap_email", label: "A/P email (invoices go here)", req: true, w: 3 },
      { t: "money", k: "credit_requested", label: "Credit limit requested", req: true, w: 3, min: 1 },
      { t: "text", k: "duns", label: "D-U-N-S number", hint: "If you have one", w: 3 },
    ] },
    { key: "owners", title: "Owners & officers", fields: [
      { t: "text", k: "own1_name", label: "Primary owner / officer", req: true, w: 3 },
      { t: "text", k: "own1_title", label: "Title", req: true, w: 3 },
      { t: "tel", k: "own1_phone", label: "Phone", req: true, w: 3 },
      { t: "email", k: "own1_email", label: "Email", req: true, w: 3 },
      { t: "choice", k: "own2", label: "Is there a second owner or officer?", opts: YN, style: "pills", req: true },
      { t: "text", k: "own2_name", label: "Second owner / officer", req: true, w: 3, show: is("own2", "Yes") },
      { t: "text", k: "own2_title", label: "Title", req: true, w: 3, show: is("own2", "Yes") },
      { t: "tel", k: "own2_phone", label: "Phone", req: true, w: 3, show: is("own2", "Yes") },
      { t: "email", k: "own2_email", label: "Email", w: 3, show: is("own2", "Yes") },
    ] },
    { key: "bank", title: "Bank", sub: "Signing this application lets your bank share account information with AMBIT.", fields: [
      { t: "text", k: "bank_name", label: "Bank name", req: true, w: 3 },
      { t: "secret", k: "bank_account", label: "Account number", kind: "bank", req: true, w: 3, hint: "Encrypted. Only Accounting can see it." },
      { t: "text", k: "bank_officer", label: "Bank officer", w: 3 },
      { t: "tel", k: "bank_phone", label: "Bank phone", req: true, w: 3 },
      { t: "email", k: "bank_email", label: "Bank email", w: 6 },
      ...addr("bank", "Bank address", false),
    ] },
    { key: "refs", title: "Trade references", sub: "Two suppliers you buy from on terms (a third if you have one).", fields: [...ref(1, true), ...ref(2, true), ...ref(3, false)] },
    { key: "sign", title: "Sign", fields: [
      { t: "note", k: "cert", tone: "legal", text: "By signing, the undersigned, for the Purchaser and Guarantors, certify that the Purchaser is solvent and able to meet its obligations, that everything in this application is true, and authorize AMBIT Polyurethane to check the bank and trade references above and the Purchaser's credit." },
      ...signer(1),
      { t: "choice", k: "sign2_add", label: "Add a second signer?", opts: YN, style: "pills", req: true },
      ...signer(2, is("sign2_add", "Yes")),
    ] },
    { key: "docs", title: "Documents", sub: "Photos from your phone are fine.", fields: [
      { t: "file", k: "photo_id", label: "Photo ID (front and back)", req: true, multi: true, accept: "image/*,application/pdf" },
      { t: "file", k: "ein_docs", label: "EIN letter or incorporation documents", req: true, multi: true, accept: "image/*,application/pdf" },
    ] },
    { key: "ambit", title: "AMBIT verification", sub: "Accounting fills this in. The customer never sees it.", staffOnly: true, fields: [
      { t: "secret", k: "v_dl", label: "Driver's license #", kind: "dl", w: 3 },
      { t: "date", k: "v_dl_date", label: "Checked on", w: 3 },
      { t: "ein", k: "v_ein", label: "EIN / Tax ID", w: 3 },
      { t: "date", k: "v_ein_date", label: "Checked on", w: 3 },
      { t: "textarea", k: "v_refs", label: "References checked: what they said", w: 6 },
      { t: "date", k: "v_refs_date", label: "Checked on", w: 3 },
      { t: "signature", k: "v_sign", label: "AMBIT team member" },
    ] },
  ],
};

// ── Customer Account Setup ───────────────────────────────────────────────────────────────────────────────────────
const guarantor = (n: number, show?: (d: Data) => boolean): Field[] => [
  { t: "signature", k: `g${n}_sign`, label: n === 1 ? "Primary guarantor signature" : "Second guarantor signature", req: true, show },
  { t: "text", k: `g${n}_name`, label: "Printed name", req: true, w: 3, show },
  { t: "secret", k: `g${n}_ssn`, label: "Social Security number", kind: "ssn", req: true, w: 3, show, hint: "Encrypted. Only Accounting can see it." },
  { t: "tel", k: `g${n}_phone`, label: "Phone", req: true, w: 3, show },
  { t: "date", k: `g${n}_date`, label: "Date", req: true, w: 3, show },
  ...addr(`g${n}`, "Home address", true, show),
];
export const accountSetup: Spec = {
  key: "account_setup", title: "Customer Account Setup", short: "Account setup", icon: "building", group: "customer", publicLink: true, decide: true,
  desc: "Everything we need to open the account: company, shipping, tax and the personal guarantee.",
  summary: (d) => [str(d.company_name), str(d.company_city) && str(d.company_state) ? `${str(d.company_city)}, ${str(d.company_state)}` : ""].filter(Boolean).join(" · "),
  steps: [
    { key: "co", title: "Company", fields: [
      { t: "text", k: "company_name", label: "Company legal name", req: true, w: 6 },
      { t: "text", k: "purchaser", label: "Purchaser (who orders)", req: true, w: 3 },
      { t: "tel", k: "company_phone", label: "Company phone", req: true, w: 3 },
      { t: "email", k: "company_email", label: "Company email", req: true, w: 3 },
      { t: "text", k: "county", label: "County", w: 3 },
      ...addr("company", "Company address"),
      { t: "staff", k: "rep", label: "AMBIT sales rep", req: true, w: 3 },
    ] },
    { key: "tax", title: "Tax & business type", fields: [
      { t: "ein", k: "fein", label: "Federal Tax ID (FEIN)", req: true, w: 3, ph: "12-3456789" },
      { t: "choice", k: "tax_exempt", label: "Sales tax exempt?", opts: YN, style: "pills", req: true },
      { t: "file", k: "tax_cert", label: "Resale / exemption certificate", show: is("tax_exempt", "Yes"), req: is("tax_exempt", "Yes"), multi: true, accept: "image/*,application/pdf" },
      { t: "choice", k: "company_type", label: "Company type", req: true, style: "select",
        opts: ["Sole Proprietorship", "Partnership", "Corporation", "Joint Venture", "Limited Partnership (LP)", "Limited Liability Partnership (LLP)", "Limited Liability Corporation (LLC)"] },
      { t: "choice", k: "acc_training", label: "American Chemistry Council (ACC) training completed?", opts: YN, style: "pills", req: true },
    ] },
    { key: "ship", title: "Shipping", sub: "Where and how we deliver.", fields: [
      { t: "text", k: "ship_contact", label: "Shipping contact", req: true, w: 3 },
      { t: "tel", k: "ship_phone", label: "Shipping contact phone", req: true, w: 3 },
      { t: "email", k: "ship_email", label: "Shipping email", req: true, w: 6 },
      { t: "choice", k: "ship_same", label: "Ship to the company address?", opts: YN, style: "pills", req: true },
      ...addr("ship", "Ship-to address", true, is("ship_same", "No")),
      { t: "choice", k: "address_type", label: "Delivery address type", opts: ["Commercial", "Residential"], style: "pills", req: true },
      { t: "choice", k: "delivery", label: "Delivery needs", multi: true, style: "pills", opts: ["Lift Gate Required", "Pallet Jack Required", "Driver Assist Needed"], hint: "Pick any that apply" },
      { t: "note", k: "resi", tone: "warn", text: "Residential deliveries need a lift gate and may cost more.", show: is("address_type", "Residential") },
    ] },
    { key: "guar", title: "Personal guarantee", sub: "The owner personally guarantees the account.", fields: [
      ...guarantor(1),
      { t: "choice", k: "g2_add", label: "Add a second guarantor?", opts: YN, style: "pills", req: true },
      ...guarantor(2, is("g2_add", "Yes")),
    ] },
    { key: "dl", title: "Driver's license", fields: [
      { t: "file", k: "dl_file", label: "Photo of the guarantor's driver's license", req: true, multi: true, accept: "image/*,application/pdf" },
    ] },
  ],
};

// ── RMA ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const rma: Spec = {
  key: "rma", title: "Return Material Authorization", short: "RMA", icon: "box", group: "customer", decide: true,
  desc: "A customer wants to send material back. The order desk approves it and gives the RMA number.",
  summary: (d) => [str(d.company_name), str(d.reason)].filter(Boolean).join(" · "),
  steps: [
    { key: "who", title: "Customer", fields: [
      { t: "customer", k: "company_id", label: "Customer", w: 6, hint: "Pick them, or type the name below if they're not in the list" },
      { t: "text", k: "company_name", label: "Company name", req: true, w: 6 },
      { t: "text", k: "contact", label: "Contact name", req: true, w: 3 },
      { t: "tel", k: "phone", label: "Phone", req: true, w: 3 },
      { t: "email", k: "email", label: "Email", req: true, w: 6 },
      ...addr("cust", "Address"),
    ] },
    { key: "what", title: "What's coming back", fields: [
      { t: "text", k: "order_ref", label: "Original order or invoice #", req: true, w: 3 },
      { t: "date", k: "ship_date", label: "Date it shipped", w: 3 },
      { t: "textarea", k: "items", label: "Products, quantities and lot #s", req: true, hint: "One per line: AMBI-SEAL 5.0, 2 drums, lot 24-1187", w: 6 },
      { t: "choice", k: "condition", label: "Condition", multi: true, req: true, style: "pills",
        opts: ["Unopened / Sealed", "Opened but Unused", "Damaged in Transit", "Defective / Quality Issue", "Incorrect Product Shipped"] },
      { t: "choice", k: "reason", label: "Main reason", req: true, style: "select",
        opts: ["Ordered too much", "Wrong product shipped", "Damaged in transit", "Quality / spray problem", "Job cancelled", "Other"] },
      { t: "textarea", k: "reason_detail", label: "What happened?", req: (d) => ["Quality / spray problem", "Other", "Damaged in transit"].includes(str(d.reason)), w: 6 },
      { t: "file", k: "photos", label: "Photos (labels, damage)", multi: true, accept: "image/*,application/pdf", req: (d) => ["Damaged in transit", "Quality / spray problem"].includes(str(d.reason)) },
      { t: "choice", k: "want", label: "They'd like", req: true, style: "pills", opts: ["Credit to account", "Replacement", "Refund"] },
    ] },
    { key: "ship", title: "Getting it back", fields: [
      { t: "choice", k: "pickup", label: "How does it come back?", req: true, style: "cards",
        opts: [{ v: "AMBIT picks it up", hint: "We schedule a truck" }, { v: "Customer drops it off", hint: "At a branch" }, { v: "Customer ships it", hint: "Freight on them" }] },
      { t: "combo", k: "branch", label: "Which branch?", opts: BRANCHES.slice(0, 5), req: true, w: 3, show: is("pickup", "Customer drops it off") },
      { t: "date", k: "ready_on", label: "Ready on", req: true, w: 3 },
      { t: "number", k: "pallets", label: "Pallets / drums", w: 3, min: 0 },
      { t: "textarea", k: "notes", label: "Anything else", w: 6 },
      { t: "note", k: "inst", tone: "info", text: "Everything coming back needs this RMA number on it. Returns without one may be refused. Opened material may get a restocking fee." },
    ] },
  ],
};

// ── Travel Request ───────────────────────────────────────────────────────────────────────────────────────────────
const travelTotal = (d: Data) => ["air", "lodging", "car", "mileage_amt", "meals", "other_cost"].reduce((s, k) => s + (num(d[k]) ?? 0), 0);
export const travel: Spec = {
  key: "travel", title: "Travel Request", short: "Travel", icon: "plane", group: "team", decide: true,
  desc: "Ask before you book. Your manager approves it, and the estimate rolls up for you.",
  summary: (d) => [str(d.destination), str(d.depart) ? `${str(d.depart)} → ${str(d.return)}` : "", travelTotal(d) ? usd(travelTotal(d)) : ""].filter(Boolean).join(" · "),
  steps: [
    { key: "you", title: "You", fields: [
      { t: "text", k: "name", label: "Your name", req: true, w: 3 },
      { t: "email", k: "email", label: "Work email", req: true, w: 3 },
      { t: "choice", k: "branch", label: "Home branch", req: true, style: "select", opts: BRANCHES, w: 3 },
      { t: "choice", k: "dept", label: "Department", style: "select", opts: DEPTS, w: 3 },
      { t: "staff", k: "manager", label: "Manager", req: true, w: 3 },
    ] },
    { key: "trip", title: "The trip", fields: [
      { t: "choice", k: "purpose", label: "Why are you going?", req: true, style: "pills",
        opts: ["Customer visit", "Jobsite / technical support", "Trade show / event", "Training / AMBIT Academy", "Sales meeting", "Supplier / vendor visit", "Other"] },
      { t: "text", k: "visiting", label: "Customer or company you're visiting", w: 3, req: (d) => ["Customer visit", "Jobsite / technical support", "Supplier / vendor visit"].includes(str(d.purpose)) },
      { t: "text", k: "destination", label: "Destination (city, state)", req: true, w: 3 },
      { t: "date", k: "depart", label: "Leaving", req: true, w: 3 },
      { t: "date", k: "return", label: "Back", req: true, w: 3 },
      { t: "textarea", k: "goal", label: "What's the goal of the trip?", req: true, w: 6 },
    ] },
    { key: "how", title: "Getting there", fields: [
      { t: "choice", k: "modes", label: "How are you traveling?", multi: true, req: true, style: "pills", opts: ["Company vehicle", "Personal vehicle (mileage)", "Flight", "Rental car", "Other"] },
      { t: "number", k: "miles", label: "Round-trip miles", w: 3, min: 0, show: (d) => is("modes", "Personal vehicle (mileage)")(d) || is("modes", "Company vehicle")(d), req: is("modes", "Personal vehicle (mileage)") },
      { t: "textarea", k: "flights", label: "Flight preferences (airports, times, airline)", w: 6, show: is("modes", "Flight") },
      { t: "choice", k: "lodging_need", label: "Need a hotel?", opts: ["No", "Yes"], style: "pills", req: true },
      { t: "number", k: "nights", label: "Nights", w: 2, min: 1, req: true, show: is("lodging_need", "Yes") },
      { t: "text", k: "hotel", label: "Hotel or area you'd like", w: 4, show: is("lodging_need", "Yes") },
    ] },
    { key: "cost", title: "Estimated cost", sub: "Your best guess. It adds itself up.", fields: [
      { t: "money", k: "air", label: "Airfare", w: 2, show: is("modes", "Flight") },
      { t: "money", k: "lodging", label: "Hotel", w: 2, show: is("lodging_need", "Yes") },
      { t: "money", k: "car", label: "Rental car / fuel", w: 2 },
      { t: "money", k: "mileage_amt", label: "Mileage reimbursement", w: 2, show: is("modes", "Personal vehicle (mileage)"), hint: "Miles × the IRS rate" },
      { t: "money", k: "meals", label: "Meals", w: 2 },
      { t: "money", k: "other_cost", label: "Registration / other", w: 2 },
      { t: "calc", k: "total", label: "Estimated total", calc: (d) => usd(travelTotal(d)) },
      { t: "choice", k: "pay", label: "How will it be paid?", opts: ["Company card", "Reimbursement", "Both"], style: "pills", req: true },
      { t: "textarea", k: "notes", label: "Notes for your manager", w: 6 },
      { t: "choice", k: "ack", label: "", multi: true, req: true, opts: ["I'll keep receipts and turn them in with my expenses after the trip."] },
    ] },
  ],
};

// ── Time Off ─────────────────────────────────────────────────────────────────────────────────────────────────────
const days = (a: string, b: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) return 0;
  let n = 0;
  for (let t = new Date(`${a}T12:00:00Z`); t <= new Date(`${b}T12:00:00Z`); t = new Date(t.getTime() + 864e5)) if (t.getUTCDay() % 6) n++;
  return n;
};
export const timeOff: Spec = {
  key: "time_off", title: "Time Off Request", short: "Time off", icon: "calendar", group: "team", decide: true,
  desc: "Vacation, sick, personal and the rest. It's not approved until your manager says so.",
  summary: (d) => [str(d.kind), str(d.first) ? `${str(d.first)} → ${str(d.last)}` : "", num(d.hours) ? `${num(d.hours)} h` : ""].filter(Boolean).join(" · "),
  steps: [
    { key: "you", title: "You", fields: [
      { t: "text", k: "name", label: "Your name", req: true, w: 3 },
      { t: "email", k: "email", label: "Work email", req: true, w: 3 },
      { t: "choice", k: "branch", label: "Branch", req: true, style: "select", opts: BRANCHES, w: 3 },
      { t: "choice", k: "dept", label: "Department", style: "select", opts: DEPTS, w: 3 },
      { t: "staff", k: "manager", label: "Manager", req: true, w: 3 },
    ] },
    { key: "when", title: "Time off", fields: [
      { t: "choice", k: "kind", label: "Type", req: true, style: "pills", opts: ["Vacation / PTO", "Sick", "Personal", "Bereavement", "Jury duty", "Unpaid leave", "Other"] },
      { t: "date", k: "first", label: "First day off", req: true, w: 3 },
      { t: "date", k: "last", label: "Last day off", req: true, w: 3 },
      { t: "calc", k: "workdays", label: "Workdays", calc: (d) => { const n = days(str(d.first), str(d.last)); return n ? `${n} workday${n === 1 ? "" : "s"} (${n * 8} h)` : null; } },
      { t: "choice", k: "partial", label: "Is any of it a partial day?", opts: ["No", "Yes"], style: "pills", req: true },
      { t: "number", k: "partial_hours", label: "Partial-day hours", w: 2, min: 0, show: is("partial", "Yes"), req: is("partial", "Yes") },
      { t: "number", k: "hours", label: "Total hours", req: true, w: 2, min: 0, hint: "8 per full day" },
    ] },
    { key: "cover", title: "While you're out", fields: [
      { t: "textarea", k: "coverage", label: "Who's covering your customers and work?", req: (d) => !["Sick", "Bereavement"].includes(str(d.kind)), w: 6 },
      { t: "textarea", k: "notes", label: "Notes for your manager", w: 6 },
      { t: "choice", k: "ack", label: "", multi: true, req: true, opts: ["I understand this isn't approved until my manager confirms it."] },
    ] },
  ],
};

// ── Spray Data Collection ────────────────────────────────────────────────────────────────────────────────────────
// Equipment lists from the Jotform (it cut the long lists short, so you can also type any model).
const PROPORTIONERS = ["(GRACO) GUSMER GH-2", "(GRACO) GUSMER GH-4", "(GRACO) E-10", "(GRACO) E-20 Reactor 1", "(GRACO) E-20 Reactor 2", "(GRACO) E-30 Reactor 2",
  "(GRACO) E-30 Reactor 3", "(GRACO) H-30 Reactor 2", "(GRACO) H-30 Reactor 3", "(GRACO) H-40"];
const GUNS = ["(GRACO) Fusion AP", "(GRACO) Probler P2", "(GRACO) FX", "(GRACO) Pro Connect", "(GRACO) Clear Shot", "(GRACO) GX-7", "(PMC) Xtreme", "(PMC) AP-2", "(BINKS) ST1"];
const CHAMBERS = ["(GRACO AP) AR2020 (0.020)", "(GRACO AP) AR2929 (0.029)", "(GRACO AP) AR3737 (0.037)", "(GRACO AP) AR4242 (0.042)", "(GRACO AP) AR5252 (0.052)",
  "(GRACO AP) AR6060 (0.060)", "(GRACO AP) AR7070 (0.070)", "(GRACO AP) AR8686 (0.086)"];
const conditions = (p: string, label: string): Field[] => [
  { t: "head", k: `${p}_h`, text: label },
  { t: "time", k: `${p}_time`, label: "Time", w: 2 },
  { t: "number", k: `${p}_temp`, label: "Ambient temp", unit: "°F", w: 2 },
  { t: "number", k: `${p}_rh`, label: "Humidity", unit: "%", w: 2 },
  { t: "number", k: `${p}_dew`, label: "Dew point", unit: "°F", w: 2 },
  { t: "number", k: `${p}_a`, label: "A drum temp", unit: "°F", w: 2 },
  { t: "number", k: `${p}_b`, label: "B drum temp", unit: "°F", w: 2 },
  { t: "number", k: `${p}_hose`, label: "Hose heat", unit: "°F", w: 3 },
  { t: "number", k: `${p}_psi`, label: "Pressure", unit: "PSI", w: 3 },
];
const density = (d: Data) => { const w = num(d.s_w), h = num(d.s_h), dp = num(d.s_d), g = num(d.s_g); if (!w || !h || !dp || !g) return null; return (g / 453.592) / ((w * h * dp) / 1728); };
const boardFt = (d: Data) => { const a = num(d.y_sqft), dp = num(d.y_depth); return a && dp ? a * dp : null; };
const gallons = (d: Data) => { const s = num(d.y_strokes), spg = num(d.y_spg); return s && spg ? s / spg : null; };
export const sprayData: Spec = {
  key: "spray_data", title: "Spray Data Collection", short: "Spray data", icon: "droplet", group: "field",
  desc: "On the jobsite: lots, equipment, conditions at the start and end of the day, density and yield.",
  summary: (d) => [str(d.contractor), str(d.site_city) && str(d.site_state) ? `${str(d.site_city)}, ${str(d.site_state)}` : "", density(d) ? `${density(d)!.toFixed(2)} lb/ft³` : ""].filter(Boolean).join(" · "),
  steps: [
    { key: "site", title: "Customer & site", fields: [
      { t: "staff", k: "tech", label: "AMBIT tech / rep on site", req: true, w: 3 },
      { t: "date", k: "date", label: "Date", req: true, w: 3 },
      { t: "customer", k: "company_id", label: "Contractor (customer)", w: 6 },
      { t: "text", k: "contractor", label: "Contractor name", req: true, w: 3 },
      { t: "text", k: "sprayer", label: "Sprayer", req: true, w: 3 },
      ...addr("site", "Project address", false),
    ] },
    { key: "mat", title: "Material & equipment", fields: [
      { t: "text", k: "a_lot", label: "A-side lot #", req: true, w: 3 },
      { t: "text", k: "a_batch", label: "A-side batch #", w: 3 },
      { t: "text", k: "b_lot", label: "B-side lot #", req: true, w: 3 },
      { t: "text", k: "b_batch", label: "B-side batch #", w: 3 },
      { t: "combo", k: "proportioner", label: "Proportioner", opts: PROPORTIONERS, w: 2, ph: "Pick or type" },
      { t: "combo", k: "gun", label: "Gun", opts: GUNS, w: 2, ph: "Pick or type" },
      { t: "combo", k: "chamber", label: "Mix chamber", opts: CHAMBERS, w: 2, ph: "Pick or type" },
    ] },
    { key: "cond", title: "Conditions", sub: "At the start and the end of the day.", fields: [...conditions("start", "Start of day"), ...conditions("end", "End of day")] },
    { key: "results", title: "Density & yield", fields: [
      { t: "head", k: "dens_h", text: "Density", sub: "Cut a sample, measure it (inches) and weigh it (grams)." },
      { t: "number", k: "s_w", label: "Width", unit: "in", w: 2 }, { t: "number", k: "s_h", label: "Height", unit: "in", w: 2 }, { t: "number", k: "s_d", label: "Depth", unit: "in", w: 2 },
      { t: "number", k: "s_g", label: "Weight", unit: "g", w: 2 },
      { t: "calc", k: "density", label: "Density", calc: (d) => (density(d) ? `${density(d)!.toFixed(2)} lb/ft³` : null) },
      { t: "head", k: "yield_h", text: "Yield" },
      { t: "number", k: "y_sqft", label: "Area sprayed", unit: "sq ft", w: 3 }, { t: "number", k: "y_depth", label: "Depth sprayed", unit: "in", w: 3 },
      { t: "number", k: "y_spg", label: "Strokes per gallon", w: 3 }, { t: "number", k: "y_strokes", label: "Total strokes", w: 3 },
      { t: "calc", k: "board_ft", label: "Board feet", calc: (d) => (boardFt(d) ? `${Math.round(boardFt(d)!).toLocaleString()} bd ft` : null) },
      { t: "calc", k: "yield", label: "Yield", calc: (d) => (boardFt(d) && gallons(d) ? `${(boardFt(d)! / gallons(d)!).toFixed(1)} bd ft per gallon · ${Math.round((boardFt(d)! / gallons(d)!) * 110).toLocaleString()} per set (110 gal)` : null) },
      { t: "textarea", k: "notes", label: "Notes", w: 6 },
    ] },
  ],
};

// ── Contact Information ──────────────────────────────────────────────────────────────────────────────────────────
export const contactInfo: Spec = {
  key: "contact_info", title: "Contact Information", short: "Contact info", icon: "phone", group: "field",
  desc: "Grab a new contact at a show or a jobsite. It goes to the team right away.",
  summary: (d) => [str(d.name), str(d.company)].filter(Boolean).join(" · "),
  steps: [{ key: "c", title: "Contact", fields: [
    { t: "text", k: "name", label: "Name", req: true, w: 3 },
    { t: "text", k: "company", label: "Company", w: 3 },
    { t: "tel", k: "phone", label: "Phone", req: (d) => !filled("email")(d), w: 3 },
    { t: "email", k: "email", label: "Email", req: (d) => !filled("phone")(d), w: 3 },
    ...addr("c", "Address", false),
    { t: "choice", k: "interest", label: "Interested in", multi: true, style: "pills", opts: ["Insulation Foam", "Roofing Foam", "Lifting Foam", "Fiberglass", "Intumescent", "Coatings", "Equipment / parts", "Training"] },
    { t: "textarea", k: "comment", label: "Comment", w: 6 },
  ] }],
};

// ── Daily Pulse ──────────────────────────────────────────────────────────────────────────────────────────────────
const BLOCK = [{ v: "No Blockers - Clear to Execute", label: "Clear to execute", pts: 20 }, { v: "Minor Blockers - I can work around blockers.", label: "Minor: I can work around them", pts: 10 }, { v: "Blocked - I need help to move", label: "Blocked: I need help", pts: 0 }];
const pts = (f: Field, d: Data) => (f.t === "choice" ? (f.opts.map((o) => (typeof o === "string" ? null : o)).find((o) => o && o.v === str(d[f.k]))?.pts ?? 0) : 0);
const maxPts = (f: Field) => (f.t === "choice" ? Math.max(0, ...f.opts.map((o) => (typeof o === "string" ? 0 : o.pts ?? 0))) : 0);
const pulseTop: Step = { key: "top", title: "Today's top 3", sub: "What moved or got finished today.", fields: [
  { t: "textarea", k: "item1", label: "1", req: true, w: 6 }, { t: "textarea", k: "item2", label: "2", req: true, w: 6 }, { t: "textarea", k: "item3", label: "3", req: true, w: 6 },
] };
const blocker: Field[] = [
  { t: "choice", k: "blocker", label: "Blockers on anything else?", req: true, style: "cards", opts: BLOCK },
  { t: "textarea", k: "blocker_why", label: "What's blocked, what's held up, and what would fix it?", req: (d) => !starts("blocker", "No")(d) && filled("blocker")(d), show: (d) => filled("blocker")(d) && !starts("blocker", "No")(d), w: 6 },
];
const lead: Field[] = [
  { t: "choice", k: "lead", label: "Does leadership need to know something?", req: true, style: "pills", opts: ["No - Nothing Urgent", "Yes - Leadership Needs to Know Something"].map((v) => ({ v, label: v.startsWith("No") ? "No, nothing urgent" : "Yes" })) },
  { t: "textarea", k: "lead_why", label: "What should leadership know?", req: is("lead", "Yes - Leadership Needs to Know Something"), show: is("lead", "Yes - Leadership Needs to Know Something"), w: 6 },
];
const safety = (pt: number, word = "Safety"): Field[] => [
  { t: "choice", k: "safety", label: `${word}, quality or compliance issue to report?`, req: true, style: "pills", opts: [{ v: "No - Nothing To Report", label: "No, nothing to report", pts: pt }, { v: `Yes - I need to report a ${word}, Quality, or Compliance Issue`, label: "Yes, I need to report one", pts: 0 }] },
  { t: "textarea", k: "safety_why", label: "Describe it in detail. Leadership is told right away.", req: starts("safety", "Yes"), show: starts("safety", "Yes"), w: 6 },
  { t: "note", k: "safety_n", tone: "warn", text: "This goes to leadership the moment you submit.", show: starts("safety", "Yes") },
];
const equipment = (good: number, minor: number, word = "Equipment"): Field[] => [
  { t: "choice", k: "equip", label: `${word} status`, req: true, style: "cards", opts: [
    { v: "All Systems Good - No Overdue Repairs / Maintenance", label: "All good, nothing overdue", pts: good },
    { v: "Minor issue: Not affecting output", label: "Minor issue, not affecting output", pts: minor },
    { v: "Equipment down or significantly impaired", label: "Down or badly impaired", pts: 0 }] },
  { t: "textarea", k: "equip_why", label: "What's wrong with it?", req: (d) => filled("equip")(d) && !starts("equip", "All")(d), show: (d) => filled("equip")(d) && !starts("equip", "All")(d), w: 6 },
];
function pulseScore(steps: Step[], extra?: (d: Data) => { label: string; pts: number; max: number }[]) {
  return (d: Data): Score => {
    const parts: Score["parts"] = [];
    for (const s of steps) for (const f of s.fields) if (f.t === "choice" && maxPts(f) > 0) parts.push({ label: f.label.replace(/\?$/, ""), pts: pts(f, d), max: maxPts(f) });
    if (extra) parts.push(...extra(d));
    const total = parts.reduce((t, p) => t + p.pts, 0);
    const max = parts.reduce((t, p) => t + p.max, 0);
    const flags = [starts("safety", "Yes")(d) && "Safety / quality issue", is("lead", "Yes - Leadership Needs to Know Something")(d) && "Leadership alert", starts("blocker", "Blocked")(d) && "Blocked",
      starts("equip", "Equipment down")(d) && "Equipment down", starts("resolution", "Unresolved")(d) && "Customer down", starts("lost", "Yes")(d) && "Lost deal / complaint"].filter(Boolean) as string[];
    return { total, max, pct: max ? Math.round((total / max) * 100) : 0, parts, flags };
  };
}
const ratio = (a: string, b: string, full: number, part: number, label: string) => (d: Data) => {
  const done = num(d[a]), plan = num(d[b]);
  return [{ label, pts: done === null || plan === null ? 0 : done >= plan ? full : part, max: full }];
};
const pulse = (dept: Spec["dept"], title: string, steps: Step[], extra?: (d: Data) => { label: string; pts: number; max: number }[]): Spec => {
  const all = [pulseTop, ...steps];
  return {
    key: `pulse_${dept}`, title: `Daily Pulse: ${title}`, short: title, icon: "target", group: "pulse", dept,
    desc: `Two minutes at the end of the day. ${title}.`,
    summary: (d) => [str(d.item1).slice(0, 80)].filter(Boolean).join(" · "),
    steps: all, score: pulseScore(all, extra),
  };
};
export const pulseMfg = pulse("mfg", "Manufacturing", [
  { key: "checks", title: "Status", fields: [...blocker, ...safety(25), ...lead] },
  { key: "prod", title: "Production", fields: [
    { t: "number", k: "made", label: "Batches / drums made today", req: true, w: 3, min: 0 },
    { t: "number", k: "planned", label: "Planned for today", req: true, w: 3, min: 0 },
    { t: "calc", k: "delta", label: "Made vs. planned", calc: (d) => { const a = num(d.made), b = num(d.planned); return a !== null && b ? `${Math.round((a / b) * 100)}%` : null; } },
    { t: "choice", k: "qc", label: "Did every tested batch pass QC?", req: true, style: "pills", opts: [{ v: "Yes", pts: 15 }, { v: "No", pts: 0 }] },
    { t: "textarea", k: "qc_why", label: "QC failure details", req: is("qc", "No"), show: is("qc", "No"), w: 6 },
    { t: "choice", k: "supply", label: "Raw material / supply concerns?", req: true, style: "pills", opts: [{ v: "No", pts: 3 }, { v: "Yes", pts: 0 }] },
    { t: "choice", k: "supply_which", label: "Which materials?", multi: true, style: "pills", opts: ["ISO", "Polyols", "Blowing Agent", "Catalyst"], req: is("supply", "Yes"), show: is("supply", "Yes") },
    { t: "textarea", k: "supply_why", label: "How soon will we run out?", req: is("supply", "Yes"), show: is("supply", "Yes"), w: 6 },
    ...equipment(7, 3),
  ] },
], ratio("made", "planned", 30, 10, "Production vs. plan"));
export const pulseLab = pulse("lab", "Lab", [
  { key: "checks", title: "Status", fields: [...blocker, ...safety(25), ...lead] },
  { key: "tests", title: "Testing", fields: [
    { t: "number", k: "tests_done", label: "Product tests completed today", req: true, w: 3, min: 0 },
    { t: "number", k: "tests_planned", label: "Planned for today", req: true, w: 3, min: 0 },
    { t: "choice", k: "results", label: "Did every test come out right?", req: true, style: "pills", opts: [{ v: "Yes", pts: 15 }, { v: "No", pts: 0 }] },
    { t: "textarea", k: "results_why", label: "What came out wrong?", req: is("results", "No"), show: is("results", "No"), w: 6 },
    ...equipment(5, 3, "Lab equipment"),
  ] },
], ratio("tests_done", "tests_planned", 30, 10, "Tests vs. plan"));
export const pulseSales = pulse("sales", "Sales", [
  { key: "checks", title: "Status", fields: [...blocker, ...lead] },
  { key: "sell", title: "Selling", fields: [
    { t: "choice", k: "contacts", label: "Customers contacted today", req: true, style: "pills", opts: [{ v: "10+", pts: 25 }, { v: "7-9", pts: 15 }, { v: "4-6", pts: 10 }, { v: "1-3", pts: 5 }, { v: "0", label: "None", pts: 0 }] },
    { t: "textarea", k: "contacts_why", label: "Who, and how did it go? Complaints, praise, new commitments?", req: true, w: 6 },
    { t: "choice", k: "orders", label: "Quotes or orders today?", req: true, style: "cards", opts: [
      { v: "Yes Order(s) Taken", label: "Took order(s)", pts: 25 }, { v: "Yes Quote(s) Submitted", label: "Sent quote(s)", pts: 15 },
      { v: "No But Pipeline is Strong and Order(s) Are Coming.", label: "Not today, but orders are coming", pts: 8 }, { v: "No Activity Today", label: "No activity", pts: 0 }] },
    { t: "textarea", k: "orders_why", label: "Orders / quotes notes", w: 6, show: (d) => filled("orders")(d) && !is("orders", "No Activity Today")(d) },
    { t: "choice", k: "prospects", label: "New prospects added?", req: true, style: "pills", opts: [{ v: "Yes", pts: 15 }, { v: "No", pts: 0 }] },
    { t: "textarea", k: "prospects_why", label: "Who?", req: is("prospects", "Yes"), show: is("prospects", "Yes"), w: 6 },
    { t: "choice", k: "lost", label: "Lost a deal or took a complaint?", req: true, style: "pills", opts: [{ v: "No Customer Complaints or Lost Deals to Report", label: "No", pts: 15 }, { v: "Yes - Lost Deal or Fielded Complaint from Customer", label: "Yes", pts: 0 }] },
    { t: "textarea", k: "lost_why", label: "Who, what was the issue, who won it and why (price, speed, relationship, product)?", req: starts("lost", "Yes"), show: starts("lost", "Yes"), w: 6 },
  ] },
]);
export const pulseTech = pulse("tech", "Tech team", [
  { key: "checks", title: "Status", fields: [...blocker, ...safety(20), ...lead] },
  { key: "field", title: "In the field", fields: [
    { t: "choice", k: "site", label: "Did you work with a customer today?", req: true, style: "cards", opts: [
      { v: "Yes. On-site visit or active job support", label: "Yes, on site", pts: 10 }, { v: "Yes. Remote support (phone or video)", label: "Yes, remote", pts: 10 },
      { v: "No. Travel day or internal work only", label: "Travel / internal day", pts: 5 }, { v: "No customer contact today", label: "No customer contact", pts: 0 }] },
    { t: "text", k: "site_who", label: "Customer and location", req: starts("site", "Yes"), show: starts("site", "Yes"), w: 6 },
    { t: "choice", k: "resolution", label: "Customer issue", req: true, style: "cards", opts: [
      { v: "Fully resolved: Customer is Good to Go", label: "Fully resolved", pts: 20 }, { v: "Partially resolved: Follow-up needed but customer can operate", label: "Partly: they can run, follow-up needed", pts: 15 },
      { v: "Unresolved: Customer is down or significantly impaired", label: "Unresolved: customer is down", pts: 0 }, { v: "N/A: No active issue, proactive visit or training", label: "No active issue", pts: 20 }] },
    { t: "textarea", k: "resolution_why", label: "The issue, what you tried, and what it needs", req: (d) => starts("resolution", "Partially")(d) || starts("resolution", "Unresolved")(d), show: (d) => starts("resolution", "Partially")(d) || starts("resolution", "Unresolved")(d), w: 6 },
    { t: "choice", k: "repair", label: "Equipment repair", req: true, style: "pills", opts: [{ v: "Yes: Repair or service completed", label: "Repair done", pts: 10 }, { v: "N/A: Not applicable today", label: "None today", pts: 10 }, { v: "Repair needed but not yet completed", label: "Still needs repair", pts: 0 }] },
    { t: "textarea", k: "repair_why", label: "What still needs fixing?", req: starts("repair", "Repair needed"), show: starts("repair", "Repair needed"), w: 6 },
  ] },
]);
export const pulseAdmin = pulse("admin", "Admin / Customer Service", [
  { key: "checks", title: "Status", fields: [...blocker, ...safety(25, "Service"), ...lead] },
  { key: "desk", title: "The desk", fields: [
    { t: "choice", k: "orders", label: "Orders processed today (entered, confirmed, handed to logistics)", req: true, style: "pills", opts: [{ v: "10 or More", label: "10+", pts: 25 }, { v: "6-9", pts: 18 }, { v: "3-5", pts: 10 }, { v: "1-2", pts: 5 }, { v: "0", label: "None", pts: 0 }] },
    { t: "textarea", k: "orders_why", label: "Order details", w: 6 },
    { t: "choice", k: "escalations", label: "Open customer escalations?", req: true, style: "pills", opts: [{ v: "No: All issues resolved or no issues today", label: "No" }, { v: "Yes: Still open", label: "Yes, still open" }] },
    { t: "textarea", k: "escalations_why", label: "What's open and with whom?", req: starts("escalations", "Yes"), show: starts("escalations", "Yes"), w: 6 },
    ...equipment(7, 3),
  ] },
]);

export const SPECS: Record<string, Spec> = Object.fromEntries(
  [creditApp, accountSetup, rma, travel, timeOff, sprayData, contactInfo, pulseMfg, pulseLab, pulseSales, pulseTech, pulseAdmin].map((s) => [s.key, s]),
);
export const PULSE_DEPTS: Record<NonNullable<Spec["dept"]>, string> = { mfg: "Manufacturing", lab: "Lab", sales: "Sales", tech: "Tech team", admin: "Admin / Customer Service" };
export const GROUPS: { key: Spec["group"]; label: string }[] = [
  { key: "customer", label: "Customers & credit" }, { key: "team", label: "For you" }, { key: "field", label: "In the field" }, { key: "pulse", label: "Daily Pulse" },
];
export { today };
