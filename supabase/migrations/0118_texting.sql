-- 0118: Text messages (Twilio). Customers get their approval link and order updates by text when they agreed to
-- texts; staff who turn text alerts on (Profile) get their order hand-offs and, for admins, approvals waiting on them.
-- Every text is logged; replies of STOP are honored right away (and START turns texts back on).
-- Run once in Supabase > SQL Editor, after the update with texting is live. Safe to run again.

-- US numbers as +1XXXXXXXXXX (null if it isn't a 10-digit US number).
create or replace function public.sms_e164(p text) returns text
language sql immutable as $fn$
  select case
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) = 10 then '+1' || regexp_replace(p, '\D', '', 'g')
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) = 11 and left(regexp_replace(p, '\D', '', 'g'), 1) = '1' then '+' || regexp_replace(p, '\D', '', 'g')
  end
$fn$;

alter table public.profiles add column if not exists sms_phone text;
alter table public.profiles add column if not exists sms_on boolean not null default false;
alter table public.profiles add column if not exists sms_on_at timestamptz;
alter table public.orders add column if not exists sms_phone text;

-- Who agreed to texts (the customer told us, or turned it on themselves).
create table if not exists public.sms_consent (
  phone         text primary key,
  company_id    uuid references public.companies(id) on delete set null,
  name          text,
  source        text not null default 'staff',   -- staff (customer told us) | self (they turned it on)
  by_id         uuid,
  by_name       text,
  consented_at  timestamptz not null default now()
);
create index if not exists sms_consent_company on public.sms_consent (company_id);
-- Replied STOP: never texted again until they reply START.
create table if not exists public.sms_optout (
  phone  text primary key,
  at     timestamptz not null default now(),
  said   text
);
create table if not exists public.sms_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  direction   text not null default 'out' check (direction in ('out', 'in')),
  to_phone    text,
  from_phone  text,
  kind        text,          -- approval | scheduled | done | handoff | waiting | test | reply
  ref         text,          -- order id, request id …
  user_id     uuid,
  body        text,
  status      text,          -- queued | sent | delivered | failed | undelivered | skipped | received
  sid         text,
  error       text,
  updated_at  timestamptz not null default now()
);
create index if not exists sms_log_at on public.sms_log (at desc);
create index if not exists sms_log_sid on public.sms_log (sid);

alter table public.sms_consent enable row level security;
alter table public.sms_optout enable row level security;
alter table public.sms_log enable row level security;
drop policy if exists sms_consent_read on public.sms_consent;
create policy sms_consent_read on public.sms_consent for select to authenticated using (public.my_role() in ('admin', 'employee'));
drop policy if exists sms_optout_read on public.sms_optout;
create policy sms_optout_read on public.sms_optout for select to authenticated using (public.my_role() in ('admin', 'employee'));
drop policy if exists sms_log_read on public.sms_log;
create policy sms_log_read on public.sms_log for select to authenticated using (public.is_admin());

-- Staff: the customer's mobile for this order's texts (they agreed to texts). Blank stops texts on this order.
create or replace function public.order_set_sms(p_order uuid, p_phone text, p_agreed boolean) returns text
language plpgsql security definer set search_path = public as $fn$
declare o public.orders; ph text := public.sms_e164(p_phone);
begin
  if public.my_role() not in ('admin', 'employee') then raise exception 'Staff only.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'That order is gone.'; end if;
  if coalesce(trim(p_phone), '') = '' then
    update public.orders set sms_phone = null where id = p_order;
    return 'No texts on this order.';
  end if;
  if ph is null then raise exception 'Type a 10-digit US mobile number.'; end if;
  if not coalesce(p_agreed, false) and not exists (select 1 from public.sms_consent where phone = ph) then
    raise exception 'Tick that the customer agreed to texts first.';
  end if;
  insert into public.sms_consent (phone, company_id, name, source, by_id, by_name)
  values (ph, o.company_id, o.company_name, 'staff', auth.uid(), public.my_name())
  on conflict (phone) do update set company_id = coalesce(public.sms_consent.company_id, excluded.company_id);
  update public.orders set sms_phone = ph where id = p_order;
  return case when exists (select 1 from public.sms_optout where phone = ph) then 'Saved, but that number replied STOP, so it won''t get texts until it replies START.' else 'Order texts go to ' || ph || '.' end;
end $fn$;
revoke all on function public.order_set_sms(uuid, text, boolean) from public, anon;
grant execute on function public.order_set_sms(uuid, text, boolean) to authenticated;

-- Anyone: their own mobile and whether they want texts (staff: alerts; contractors: their order updates).
create or replace function public.my_sms(p_phone text, p_on boolean) returns text
language plpgsql security definer set search_path = public as $fn$
declare ph text := public.sms_e164(p_phone); me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Sign in again.'; end if;
  if coalesce(p_on, false) and ph is null then raise exception 'Type a 10-digit US mobile number.'; end if;
  update public.profiles set sms_phone = coalesce(ph, case when coalesce(trim(p_phone), '') = '' then null else sms_phone end),
         sms_on = coalesce(p_on, false), sms_on_at = case when coalesce(p_on, false) then now() else sms_on_at end
   where id = auth.uid();
  if coalesce(p_on, false) then
    insert into public.sms_consent (phone, company_id, name, source, by_id, by_name)
    values (ph, me.company_id, coalesce(me.full_name, me.email), 'self', me.id, coalesce(me.full_name, me.email))
    on conflict (phone) do nothing;
    delete from public.sms_optout where phone = ph;
    return 'Texts are on for ' || ph || '.';
  end if;
  return 'Texts are off.';
end $fn$;
revoke all on function public.my_sms(text, boolean) from public, anon;
grant execute on function public.my_sms(text, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Check: should say 3.
select count(*) as "Texting tables (3)" from information_schema.tables where table_schema = 'public' and table_name in ('sms_consent', 'sms_optout', 'sms_log');
