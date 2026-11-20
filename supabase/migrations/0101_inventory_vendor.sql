-- 0101: the inventory spreadsheets' Preferred Vendor and Lead Time columns come into A.I. on the next sync,
-- so the ADC Best Strategy knows who to order from when no AMBIT location has enough. Safe to run again.
alter table public.inventory add column if not exists vendor text;
alter table public.inventory add column if not exists lead_days int;

-- Check: (fills in within a few minutes, after the next spreadsheet sync)
select branch_id as "Location", count(*) as "Items", count(vendor) as "With a preferred vendor"
  from public.inventory where on_sheet group by branch_id order by branch_id;
