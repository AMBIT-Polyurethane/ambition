-- 0061: "How To Use A.I." walkthrough videos are for AMBIT employees only.
-- They live in the private "academy" storage bucket under how-to/. Everyone signed in can still watch
-- Academy lesson videos; only employees (and admins) can open anything in how-to/.
-- Safe to run more than once.

drop policy if exists academy_files_read on storage.objects;
create policy academy_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'academy'
    and public.is_active()
    and (name not like 'how-to/%' or public.is_employee())
  );

-- Check: should say 1 (the read rule above is in place).
select count(*) as "How-to rule in place"
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname = 'academy_files_read'
   and qual like '%how-to/%';
