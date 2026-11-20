-- 0099: the ADC product page shows the product's documents (data sheet, SDS, code reports...) and can show more
-- photos (data sheet pages). Also puts the A + B drum set photos and the tote set photos on the AMBIT app.
-- Run this AFTER the push that adds the photos. Safe to run again.

-- ---------------------------------------------------------------- more photos for a product (data sheet pages)
alter table public.products add column if not exists adc_gallery text[] not null default '{}';

-- ---------------------------------------------------------------- what the ADC product page reads
-- Only public documents with a web link, never staff-only ones, and not the Flame Control sheets.
create or replace function public.adc_product_extras(p_sku text) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'gallery', coalesce(to_jsonb(pr.adc_gallery), '[]'::jsonb),
    'docs', coalesce((
      select jsonb_agg(jsonb_build_object('title', d.title, 'doc_type', d.doc_type, 'revision', d.revision, 'url', d.url)
                       order by d.sort, d.title)
        from public.documents d
       where d.active and d.audience <> 'employee' and d.url is not null
         and d.title not ilike 'Flame Control%'
         and d.doc_type in ('TDS', 'SDS', 'CCRR', 'ESR', 'Guide', 'Warranty', 'Certificate')
         and exists (select 1 from unnest(d.products) f where f <> '' and upper(pr.name) like '%' || upper(f) || '%')
    ), '[]'::jsonb))
    from public.products pr
   where upper(pr.sku) = upper(p_sku) and pr.active and not pr.adc_hide and not coalesce(pr.admin_only, false)
   limit 1
$fn$;
revoke execute on function public.adc_product_extras(text) from public;
grant execute on function public.adc_product_extras(text) to anon, authenticated;

-- ---------------------------------------------------------------- photos on the AMBIT app
-- The A + B drum set photo (AMBIT logo) for the spray foam sold as a set.
update public.products set image_url = '/products/sets/ambi-seal-50-set-ambit.jpg' where sku in ('AMB-SEAL-50', 'AMB-SEAL-50-W');
update public.products set image_url = '/products/sets/ambi-tite-204-set-ambit.jpg' where sku in ('AMB-TITE-20', 'AMB-TITE-20-W');
update public.products set image_url = '/products/sets/ambi-jack-40-set-ambit.jpg' where sku = 'AMB-JACK';
update public.products set image_url = '/products/sets/ambi-roof-28-set-ambit.jpg' where sku = 'AMB-ROOF-28';

-- The tote set photos, only where a tote has no photo yet (they're hidden on the ADC store for now).
update public.products set image_url = '/products/sets/ambi-jack-40-tote-set-ambit.jpg' where sku = 'AMBI-JACK-40-TOTE' and image_url is null;
update public.products set image_url = '/products/sets/ambi-slowjack-40-tote-set-ambit.jpg' where sku = 'AMBI-SLOWJACK-TOTE' and image_url is null;
update public.products set adc_image_url = '/adc/sets/ambi-jack-40-tote-set.jpg' where sku = 'AMBI-JACK-40-TOTE' and adc_image_url is null;
update public.products set adc_image_url = '/adc/sets/ambi-slowjack-40-tote-set.jpg' where sku = 'AMBI-SLOWJACK-TOTE' and adc_image_url is null;

-- Check: the foam items and the documents each one shows on the ADC store.
select pr.sku as "Item", pr.name as "Name",
       jsonb_array_length(public.adc_product_extras(pr.sku)->'docs') as "Documents shown"
  from public.products pr
 where pr.category_id = 'ambit-foam' and pr.active and not pr.adc_hide
 order by pr.sku;
