-- =====================================================================
-- AMBITION update 0005
-- * Branch codes match the Inventory Control Workbook: OKC, ATX, SMX, JAX, MOB
--   (customers, staff and past orders follow automatically).
-- * Removes the sample products and any category left with no products.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

update public.branches set id = 'atx' where id = 'arl' and not exists (select 1 from public.branches where id = 'atx');
update public.branches set id = 'smx' where id = 'smt' and not exists (select 1 from public.branches where id = 'smx');

delete from public.products where sku like 'SAMPLE-%';
delete from public.categories c where not exists (select 1 from public.products p where p.category_id = c.id);
