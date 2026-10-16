-- =====================================================================
-- AMBITION update 0006 - product photos
-- * Public "product-images" storage bucket (photos load fast for everyone;
--   only admins can add, replace or remove them).
-- * admin_set_product_images(): attach many photos to products by SKU at once.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_update on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;

create policy product_images_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- p = [{"sku": "336508", "url": "https://..."}, ...]; url null removes the photo.
create or replace function public.admin_set_product_images(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change product photos.';
  end if;
  update public.products pr
     set image_url = x.url
    from jsonb_to_recordset(p) as x(sku text, url text)
   where lower(pr.sku) = lower(x.sku);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.admin_set_product_images(jsonb) from public, anon;
grant execute on function public.admin_set_product_images(jsonb) to authenticated;
