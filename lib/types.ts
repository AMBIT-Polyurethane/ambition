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
  company?: Pick<Company, "id" | "name" | "account_no" | "default_branch_id"> | null;
  // Staff roles (migration 0011; missing until it's run)
  job_role?: string | null;
  perms?: string[] | null;
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

export type Category = { id: string; name: string; customer_priced: boolean; sort: number };

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
  active: boolean;
  sort: number;
};

export type Order = {
  id: string;
  order_no: number;
  placed_by: string;
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
