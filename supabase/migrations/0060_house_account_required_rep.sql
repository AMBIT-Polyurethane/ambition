-- =====================================================================
-- AMBIT Intelligence update 0060 - House Account, and a sales rep on every staff order
-- * A customer can be a House Account: their orders credit no sales rep (Admin > Customers, or the
--   Sales rep box on an order). Orders remember it too, so "House Account" and "nobody picked yet" differ.
-- * Staff must pick the sales rep (or House Account) before an order can be sent; the app fills it in from
--   the customer's account. The app saves that choice after the order is placed (no change to place_order).
-- * A customer who gets a sales rep also credits that rep with their earlier orders that had nobody,
--   but not the ones marked House Account.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.companies add column if not exists house_account boolean not null default false;
alter table public.orders    add column if not exists house_account boolean not null default false;

-- An order credits its customer's rep, or is a House Account order when the customer is one.
create or replace function public.orders_set_rep()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c_rep   uuid;
  c_house boolean;
begin
  if tg_op = 'INSERT' then
    if new.sales_rep_id is null and not coalesce(new.house_account, false) and new.company_id is not null then
      select c.sales_rep_id, coalesce(c.house_account, false) into c_rep, c_house from public.companies c where c.id = new.company_id;
      new.sales_rep_id := c_rep;
      new.house_account := c_rep is null and coalesce(c_house, false);
    end if;
  elsif new.company_id is distinct from old.company_id then
    select c.sales_rep_id, coalesce(c.house_account, false) into c_rep, c_house from public.companies c where c.id = new.company_id;
    new.sales_rep_id := c_rep;
    new.house_account := c_rep is null and coalesce(c_house, false);
  end if;
  return new;
end $$;
drop trigger if exists orders_set_rep on public.orders;
create trigger orders_set_rep before insert or update of company_id on public.orders
  for each row execute function public.orders_set_rep();

-- A customer gets a rep: their orders that had nobody (and weren't House Account orders) get that rep too.
create or replace function public.companies_rep_fill()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sales_rep_id is not null and new.sales_rep_id is distinct from old.sales_rep_id then
    update public.orders set sales_rep_id = new.sales_rep_id
     where company_id = new.id and sales_rep_id is null and not house_account;
  end if;
  return new;
end $$;
drop trigger if exists companies_rep_fill on public.companies;
create trigger companies_rep_fill after update of sales_rep_id on public.companies
  for each row execute function public.companies_rep_fill();

select 'House Account and required sales rep ready' as status;
