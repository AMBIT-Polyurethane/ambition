-- =====================================================================
-- AMBIT Intelligence update 0045 - Who can add new customers
-- * New customers need a credit application and credit approval first, so only admins and staff with the new
--   "Add new customers" box can create one. Everyone else (sales reps, warehouse, techs, CRM) taps
--   "Request a new customer": the details are emailed to the credit team, nothing is created.
-- * The Accounting job role gets the box by default; an admin can tick it for anyone in Admin > Accounts.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports', 'add_customers']
$$;

-- Accounting adds customers (they do the credit vetting).
update public.profiles
   set perms = perms || array['add_customers']
 where role = 'employee' and job_role = 'accounting' and perms is not null and not ('add_customers' = any(perms));

-- The database itself refuses a new customer from anyone else (not only the app's screens).
drop policy if exists companies_employee_insert on public.companies;
create policy companies_employee_insert on public.companies for insert to authenticated
  with check (public.is_employee() and public.has_perm('add_customers')
              and source = 'app' and needs_qb_setup and created_by = auth.uid());

select 'add customers: ' || coalesce(string_agg(full_name, ', ' order by full_name), 'admins only') as status
  from public.profiles where status = 'active' and role = 'employee' and 'add_customers' = any(perms);
