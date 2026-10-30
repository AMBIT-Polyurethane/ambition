export type Role = "customer" | "employee" | "admin";
export type Status = "pending" | "active" | "disabled";
export type Audience = "all" | "customer" | "employee";
export type OrderStatus = "new" | "processing" | "completed" | "cancelled";

export type Company = {
  id: string;
  name: string;
  account_no: string | null;
  default_branch_id: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
  active?: boolean;
  contact_name?: string | null;
  bill_address?: string | null;
  ship_address?: string | null;
  qb_id?: string | null;
  source?: "admin" | "quickbooks" | "app";
  needs_qb_setup?: boolean;
  sales_rep_id?: string | null; // 0028: the customer's sales rep (credited with their orders)
  created_by?: string | null;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  title: string | null;
  role: Role;
  status: Status;
  company_id: string | null;
  branch_id: string | null;
  requested_company: string | null;
  requested_account_no: string | null;
  created_at: string;
  approved_at: string | null;
  company?: (Pick<Company, "id" | "name" | "account_no" | "default_branch_id"> & { ops_enabled?: boolean }) | null;
  // Staff roles (migration 0011; missing until it's run)
  job_role?: string | null;
  perms?: string[] | null;
  /** The person's own home-screen app layout (migration 0014). */
  home_apps?: unknown;
  monthly_goal?: number | null;
  home_layout?: unknown; // 0029: {"order": [...], "hidden": [...]} for the Home board // Sales widget goal, set by an admin (0027)
  // AMBIT-OPS (0031): their role in their company's workspace; AMBIT admins: the workspace they're helping in
  ops_role?: string | null;
  ops_location_id?: string | null;
  ops_workspace?: string | null;
};

export type Branch = {
  id: string;
  name: string;
  state: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  sort: number;
  active: boolean;
};

export type Category = { id: string; name: string; customer_priced: boolean; sort: number; goal_group?: string | null };

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  unit: string;
  list_price: number | null;
  customer_priced: boolean | null;
  image_url: string | null;
  /** Fiberglass batts: square feet one bag covers (lets people order by square feet). */
  sqft_per_unit?: number | null;
  /** On sale: charged this instead of the list price, through sale_ends (blank = until it's removed). */
  sale_price?: number | null;
  sale_ends?: string | null;
  active: boolean;
  sort: number;
};

export type Order = {
  id: string;
  tax_note?: string | null;
  /** Accounting, at the credit release: collect payment at pickup / delivery; no checks taken. */
  pay_cod?: boolean;
  pay_no_checks?: boolean;
  order_no: number;
  placed_by: string | null;
  company_id: string | null;
  company_name: string;
  account_no: string | null;
  placed_by_name: string | null;
  placed_by_email: string | null;
  placed_by_phone: string | null;
  placed_by_role: Role;
  delivery_method: "pickup" | "jobsite" | "dropship";
  branch_id: string | null;
  ship_address: string | null;
  po_number: string | null;
  needed_by: string | null;
  notes: string | null;
  est_subtotal: number;
  has_customer_pricing: boolean;
  status: OrderStatus;
  email_status: string;
  email_error: string | null;
  created_at: string;
  // Customer approval (added in migration 0010; missing on databases that haven't run it yet)
  approval_status?: ApprovalStatus;
  approval_method?: "email_link" | "in_app" | "staff_recorded" | null;
  approval_email?: string | null;
  approval_sent_at?: string | null;
  approval_expires_at?: string | null;
  approval_email_status?: string | null;
  approval_email_error?: string | null;
  approved_at?: string | null;
  approved_by_name?: string | null;
  approval_note?: string | null;
  approval_ref?: string | null;
  // Order desk (migration 0011)
  stage?: OrderStage;
  ambit_po?: string | null;
  cancel_reason?: string | null;
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
  po_by_name?: string | null;
  po_at?: string | null;
  credit_status?: "pending" | "approved" | "hold" | null;
  credit_by_name?: string | null;
  credit_at?: string | null;
  credit_note?: string | null;
  scheduled_for?: string | null;
  schedule_note?: string | null;
  scheduled_by_name?: string | null;
  scheduled_at?: string | null;
  notify_status?: string | null;
  notify_error?: string | null;
  completed_at?: string | null;
  // Invoice # and the scheduled-email override (migration 0025)
  invoice_no?: string | null;
  sales_rep_id?: string | null; // 0028: the customer's rep when it was placed
  priced_at?: string | null; // 0028: invoice prices entered by the order desk
  priced_by_name?: string | null;
  notify_override_by?: string | null;
  notify_override_at?: string | null;
};

export type OrderStage = "customer" | "needs_po" | "credit" | "hold" | "schedule" | "scheduled" | "completed" | "cancelled";

export type ApprovalStatus = "not_required" | "pending" | "approved" | "changes_requested";

export type OrderItem = {
  id: number;
  order_id: string;
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number | null;
  customer_priced: boolean;
  line_total: number | null;
  /** ISO priced per foam set (0030): [{ with: resin order item id or null, qty, price }]. */
  price_parts?: { with: number | null; qty: number; price: number }[] | null;
  // Item variance (0025): what the customer ordered, when a different type is loaded
  ordered_product_id?: string | null;
  ordered_sku?: string | null;
  ordered_name?: string | null;
};

export type LinkRow = {
  id: string;
  title: string;
  subtitle: string | null;
  url: string | null;
  icon: string;
  section: "forms" | "resources";
  audience: Audience;
  open_in_app: boolean;
  sort: number;
  active: boolean;
  perm?: string | null; // staff need this permission to see it (0011)
  folder?: string | null; // staff home screen folder: main | sales | forms | learn | admin (0026); empty = by kind
};

export type DocumentRow = {
  id: string;
  title: string;
  doc_type: string;
  product: string | null; // older single-product field; "products" replaces it
  products?: string[];
  category?: string | null; // SPFA library shelf
  code: string | null;
  description: string | null;
  revision?: string | null;
  renewal_on?: string | null;
  url: string | null; // where the file came from / lives on the web
  storage_path: string | null; // copy kept in the app (preferred when opening)
  audience: Audience;
  published_on: string | null;
  sort: number;
  active: boolean;
};

export type Course = {
  id: string;
  title: string;
  subtitle: string | null;
  minutes: number | null;
  lessons: number | null;
  audience: Audience;
  status: "coming_soon" | "live";
  url: string | null;
  sort: number;
};
