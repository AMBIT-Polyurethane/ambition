-- 0103: text-message (SMS) consent. Every time someone ticks or unticks "Text me order updates" (ADC checkout,
-- ADC sign-up, ADC account, or their A.I. profile) we keep a dated record: carriers require proof of consent.
-- The app writes these rows from the server only. Staff can read them. Safe to run again.

create table if not exists public.sms_consents (
  id bigserial primary key,
  phone text not null,                 -- 10-digit US number, digits only
  opted_in boolean not null,
  source text not null,                -- adc_checkout, adc_signup, adc_account, app_profile, reply
  user_id uuid references auth.users (id) on delete set null,
  name text,
  company text,
  ref text,                            -- e.g. the ADC order number
  consent_text text,                   -- the exact words next to the box
  lang text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists sms_consents_phone_idx on public.sms_consents (phone, created_at desc);
alter table public.sms_consents enable row level security;
drop policy if exists sms_consents_staff_read on public.sms_consents;
create policy sms_consents_staff_read on public.sms_consents for select to authenticated using (public.is_employee());

-- The latest answer for each number: texts go only to numbers whose latest row says yes.
create or replace view public.sms_status with (security_invoker = true) as
  select distinct on (phone) phone, opted_in, source, created_at
  from public.sms_consents
  order by phone, created_at desc;

alter table public.profiles add column if not exists sms_opt_in boolean not null default false;
alter table public.adc_accounts add column if not exists sms_opt_in boolean not null default false;
alter table public.adc_orders add column if not exists sms_opt_in boolean not null default false;
