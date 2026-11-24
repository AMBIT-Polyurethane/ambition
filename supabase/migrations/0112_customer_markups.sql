-- 0112: A markup on our cost, set per customer and product group (admins only).
--  * On a customer's price sheet, an admin picks a group (Guns & Parts, Fiberglass...), types a markup % and applies it:
--    every item in the group with a purchase price gets cost x (1 + markup) as that customer's price.
--  * This table remembers the markup used for each customer and group, so the sheet shows it next time.
--  * Admins also see each item's purchase price, sell price and margin on that sheet (costs stay admins-only).
-- Run once in Supabase > SQL Editor. Safe to run again.

create table if not exists public.customer_category_markups (
  company_id   uuid not null references public.companies(id) on delete cascade,
  category_id  text not null,
  markup_pct   numeric(7,2) not null check (markup_pct > -100 and markup_pct < 10000),
  items        int,
  set_by_name  text,
  set_at       timestamptz not null default now(),
  primary key (company_id, category_id)
);
alter table public.customer_category_markups enable row level security;
drop policy if exists customer_category_markups_admin on public.customer_category_markups;
create policy customer_category_markups_admin on public.customer_category_markups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

-- Check: should say 1.
select count(*) as "Markup table (1)" from information_schema.tables where table_schema = 'public' and table_name = 'customer_category_markups';
