-- 0100: ADC order logistics. Run this AFTER the push that adds the new checkout. Safe to run again.
--  * where each location is (ZIP and map point), for shipping estimates and the closest stock
--  * for each product: who the vendor is, where they ship from, lead time, and a ship weight when the spreadsheet has none
--  * on each web order: current customer or new, the match to an A.I. customer, billing address, tax exempt,
--    delivery site, the shipping estimate and the Best Strategy sheet
--  * web customers can be added to A.I. as customers (source 'adc')

-- ---------------------------------------------------------------- locations on the map
alter table public.branches add column if not exists zip text;
alter table public.branches add column if not exists lat numeric(9,5);
alter table public.branches add column if not exists lng numeric(9,5);
update public.branches set zip = '73179', lat = 35.41690, lng = -97.64510 where id = 'okc' and zip is null;
update public.branches set zip = '76011', lat = 32.75610, lng = -97.07700 where id = 'atx' and zip is null;
update public.branches set zip = '78666', lat = 29.87850, lng = -98.02000 where id = 'smx' and zip is null;
update public.branches set zip = '32219', lat = 30.42950, lng = -81.82060 where id = 'jax' and zip is null;
update public.branches set zip = '36619', lat = 30.59360, lng = -88.18930 where id = 'mob' and zip is null;

-- ---------------------------------------------------------------- product shipping facts
alter table public.products add column if not exists ship_weight numeric(10,2);      -- lb each, when the spreadsheet has no weight
alter table public.products add column if not exists vendor_name text;               -- who we buy it from
alter table public.products add column if not exists vendor_zip text;                -- where the vendor ships from
alter table public.products add column if not exists vendor_lead_days int;           -- business days until the vendor ships

-- ---------------------------------------------------------------- what the web order knows now
alter table public.adc_orders add column if not exists customer_kind text;           -- account | new
alter table public.adc_orders add column if not exists account_check text;           -- the phone or account # they typed
alter table public.adc_orders add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.adc_orders add column if not exists match text;                   -- verified | unverified | new | added
alter table public.adc_orders add column if not exists bill_address jsonb;
alter table public.adc_orders add column if not exists tax_exempt boolean not null default false;
alter table public.adc_orders add column if not exists site text;                    -- business | home
alter table public.adc_orders add column if not exists unload text;                  -- dock | forklift | liftgate
alter table public.adc_orders add column if not exists ship_est numeric(12,2);
alter table public.adc_orders add column if not exists strategy jsonb;
alter table public.adc_orders add column if not exists alerts text[] not null default '{}';
create index if not exists adc_orders_company on public.adc_orders(company_id);

-- ---------------------------------------------------------------- customers added from the web store
alter table public.companies drop constraint if exists companies_source_check;
alter table public.companies add constraint companies_source_check check (source in ('admin', 'quickbooks', 'app', 'adc'));


-- ---------------------------------------------------------------- data sheet pages in the ADC product photos
alter table public.products add column if not exists adc_gallery text[] not null default '{}';
update public.products set adc_gallery = array['/adc/docs/ambi-seal-50-tds-1.jpg', '/adc/docs/ambi-seal-50-tds-2.jpg'] where sku in ('AMB-SEAL-50', 'AMB-SEAL-50-W');
update public.products set adc_gallery = array['/adc/docs/ambi-tite-204-tds-1.jpg', '/adc/docs/ambi-tite-204-tds-2.jpg'] where sku in ('AMB-TITE-20', 'AMB-TITE-20-W');
update public.products set adc_gallery = array['/adc/docs/ambi-jack-40-tds-1.jpg', '/adc/docs/ambi-jack-40-tds-2.jpg'] where sku = 'AMB-JACK';
update public.products set adc_gallery = array['/adc/docs/ambi-roof-28-tds-1.jpg', '/adc/docs/ambi-roof-28-tds-2.jpg'] where sku = 'AMB-ROOF-28';

-- Check: the five locations are on the map.
select id as "Location", name as "Name", zip as "ZIP", lat is not null as "On the map" from public.branches order by sort;
