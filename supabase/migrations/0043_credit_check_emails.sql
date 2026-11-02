-- =====================================================================
-- AMBIT Intelligence update 0043 - Who gets the credit check emails
-- * Admin > Email alerts: tick the people who get "Credit check needed" emails (when the CRM enters the Sales Order #,
--   and "check again" after an edit raises the total). Admins can be on the list too.
-- * The first time: Kevin Lall, Melinda Gunn, Jeremiah Bryant and Al Rearick.
-- Run once in Supabase > SQL Editor. Safe to run again (it never changes the list once someone is on it).
-- =====================================================================

alter table public.profiles add column if not exists notify_credit boolean not null default false;

do $$ begin
  if not exists (select 1 from public.profiles where notify_credit) then
    update public.profiles set notify_credit = true
     where status = 'active' and role in ('admin', 'employee')
       and lower(email) in ('kevin.lall@ambitpu.com', 'melinda.gunn@ambitpu.com', 'jeremiah.bryant@ambitpu.com', 'al.rearick@ambitpu.com');
  end if;
end $$;

-- Admin: the whole list at once (everyone else comes off it).
create or replace function public.set_credit_emails(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can change who gets the credit check emails.'; end if;
  update public.profiles set notify_credit = (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'))
   where notify_credit is distinct from (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'));
  select count(*) into n from public.profiles where notify_credit and status = 'active';
  if n = 0 then raise exception 'Pick at least one person, or nobody will be told when an order needs a credit check.'; end if;
  return n;
end $$;
revoke all on function public.set_credit_emails(uuid[]) from public, anon;
grant execute on function public.set_credit_emails(uuid[]) to authenticated;

select 'credit check emails: ' || string_agg(full_name, ', ' order by full_name) as status
  from public.profiles where notify_credit and status = 'active';
