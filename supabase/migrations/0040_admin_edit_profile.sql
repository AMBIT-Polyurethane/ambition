-- =====================================================================
-- AMBIT Intelligence update 0040 - Admins edit a person's name, phone and email
-- * Admin > Accounts: an admin can fix someone's name, cell phone or login email after they've
--   joined (the app changes the login itself on the server; this saves the account's copy).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.admin_update_profile(p_user uuid, p_full_name text, p_phone text, p_email text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change accounts.';
  end if;
  if p_email is not null and exists (select 1 from public.profiles where lower(email) = lower(btrim(p_email)) and id <> p_user) then
    raise exception 'Another account already uses %.', lower(btrim(p_email));
  end if;
  update public.profiles
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         phone     = nullif(btrim(p_phone), ''),
         email     = coalesce(nullif(lower(btrim(p_email)), ''), email)
   where id = p_user;
  if not found then
    raise exception 'That account no longer exists.';
  end if;
end $$;
revoke all on function public.admin_update_profile(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_profile(uuid, text, text, text) to authenticated;

select 'admin profile edits ready' as status;
