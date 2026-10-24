-- =====================================================================
-- AMBITION - Admins create accounts (invites)
-- Admin → Accounts → Create an account: type the person's email, pick
-- Contractor (and their company) or AMBIT employee (and what they see).
-- The person gets a link to set their password. Their account is ready
-- the moment they do: no waiting for approval.
-- The link holds a secret code; only its sha256 is stored here. A link
-- works once, for that email only, for 30 days. Sending it again makes a
-- new link and the old one stops working.
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  full_name       text,
  phone           text,
  role            public.user_role not null default 'customer',
  company_id      uuid references public.companies(id) on delete set null,
  branch_id       text references public.branches(id) on update cascade on delete set null,
  job_role        text,
  perms           text[] not null default '{}',
  note            text,                       -- the admin's personal note in the email
  token_hash      text not null,
  expires_at      timestamptz not null default now() + interval '30 days',
  invited_by      uuid references public.profiles(id) on delete set null,
  invited_by_name text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  email_status    text,                       -- sent | failed | not_configured
  accepted_at     timestamptz,
  accepted_by     uuid references public.profiles(id) on delete set null,
  cancelled_at    timestamptz
);
create unique index if not exists invites_token_idx on public.invites(token_hash);
create index if not exists invites_email_idx on public.invites(lower(email));

alter table public.invites enable row level security;
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Use an invite: set up the person's account the way the admin chose ----------
-- Only for the email the invite was made for, and only while it's open.
create or replace function public.apply_invite(p_user uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  em  text;
begin
  if coalesce(p_user::text, '') = '' or coalesce(p_hash, '') = '' then return false; end if;
  select lower(email) into em from public.profiles where id = p_user;
  if em is null then return false; end if;
  select * into inv from public.invites
   where token_hash = p_hash and accepted_at is null and cancelled_at is null and expires_at > now()
   for update;
  if inv.id is null or lower(inv.email) <> em then return false; end if;

  update public.profiles
     set role        = inv.role,
         status      = 'active',
         company_id  = case when inv.role = 'customer' then inv.company_id end,
         branch_id   = coalesce(inv.branch_id, branch_id),
         job_role    = case when inv.role = 'admin' then 'admin' when inv.role = 'employee' then inv.job_role end,
         perms       = case when inv.role = 'admin' then public.all_perms() when inv.role = 'employee' then inv.perms else '{}'::text[] end,
         full_name   = coalesce(nullif(trim(full_name), ''), inv.full_name),
         phone       = coalesce(nullif(trim(phone), ''), inv.phone),
         approved_at = now(),
         approved_by = inv.invited_by
   where id = p_user;
  update public.invites set accepted_at = now(), accepted_by = p_user where id = inv.id;
  -- Any other open invites for the same email are done too.
  update public.invites set cancelled_at = now()
   where lower(email) = em and id <> inv.id and accepted_at is null and cancelled_at is null;
  return true;
end $$;
revoke execute on function public.apply_invite(uuid, text) from public, anon, authenticated;

-- The person signed in (or just made their password) on the invite page.
create or replace function public.accept_invite(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select public.apply_invite(auth.uid(), p_hash)
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- What the invite page shows before the person has a login.
create or replace function public.invite_lookup(p_hash text)
returns table (email text, full_name text, phone text, kind text, company_name text, invited_by_name text, state text, has_account boolean)
language sql stable security definer set search_path = public as $$
  select i.email, i.full_name, i.phone,
         case when i.role = 'customer' then 'contractor' else 'employee' end,
         c.name, i.invited_by_name,
         case when i.accepted_at is not null then 'used'
              when i.cancelled_at is not null then 'cancelled'
              when i.expires_at <= now() then 'expired'
              else 'open' end,
         exists (select 1 from public.profiles p where lower(p.email) = lower(i.email))
    from public.invites i
    left join public.companies c on c.id = i.company_id
   where coalesce(p_hash, '') <> '' and i.token_hash = p_hash
   limit 1
$$;
revoke execute on function public.invite_lookup(text) from public;
grant execute on function public.invite_lookup(text) to anon, authenticated;

-- ---------- New logins: also use the invite they signed up with ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, phone, requested_company, requested_account_no, branch_id)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(meta->>'full_name', meta->>'name', '')), ''),
    nullif(trim(coalesce(meta->>'phone', '')), ''),
    nullif(trim(coalesce(meta->>'company', '')), ''),
    nullif(trim(coalesce(meta->>'account_no', '')), ''),
    (select b.id from public.branches b where b.id = meta->>'branch_id')
  )
  on conflict (id) do nothing;

  if coalesce(meta->>'invite', '') <> '' then
    begin
      perform public.apply_invite(new.id, meta->>'invite');
    exception when others then
      null;  -- never block a sign-up; the invite page tries again right after
    end;
  end if;
  return new;
end $$;

select count(*) as open_invites from public.invites where accepted_at is null and cancelled_at is null;
