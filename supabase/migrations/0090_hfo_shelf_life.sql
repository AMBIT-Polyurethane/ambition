-- 0090: shelf life. HFO closed cell lasts 6 months from its Mfg date; open cell and ISO 12 (Jeremiah, Nov 18).
-- A lot with no Exp date is used up by (Use By) Mfg + that. The FOAM LOTS Use By column follows the same rule.
-- Receiving fills in the Exp date from each product's shelf life, so HFO products get 6 months there too.
-- Safe to run again.

update public.products set shelf_life_months = 6
 where (name ilike '%HFO%' or upper(sku) like 'AMB-TITE%') and shelf_life_months is distinct from 6;

-- use_by is worked out by the database from the lot's own row (nothing else depends on the column itself).
alter table public.inventory_lots drop column if exists use_by;
alter table public.inventory_lots add column use_by date generated always as (
  coalesce(exp, (mfg + case when upper(coalesce(label, '')) like '%HFO%' or upper(sku) like 'AMB-TITE%' then interval '6 months' else interval '12 months' end)::date)
) stored;

select 'Ready' as "Check",
  (select count(*) from public.products where shelf_life_months = 6) as "HFO products at 6 months",
  (select count(*) from public.inventory_lots where exp is null and mfg is not null and use_by = (mfg + interval '6 months')::date) as "Lots now using 6 months";
