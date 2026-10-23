-- =====================================================================
-- AMBITION - Delete my account, order batts by square foot, forms hub
-- * Anyone can delete their own login from Profile. Orders they placed
--   stay on file (the order keeps the name, email and phone it was sent
--   with); only the link to the deleted login is cleared.
--   The last active admin can't delete themselves.
-- * products.sqft_per_unit: square feet one bag covers. Filled in from the
--   batt names ("... 240.25 S/F ..."); editable in Admin > Products.
-- * form_reviews: an admin's decision on a Jotform submission (credit
--   applications, customer account setup and other forms), with credit
--   limit, terms and a note. Admins only.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------- delete my account
alter table public.orders alter column placed_by drop not null;
alter table public.orders drop constraint if exists orders_placed_by_fkey;
alter table public.orders add constraint orders_placed_by_fkey
  foreign key (placed_by) references public.profiles(id) on delete set null;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  my_role public.user_role;
  other_admins int;
begin
  if me is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select role into my_role from public.profiles where id = me;
  if my_role = 'admin' then
    select count(*) into other_admins from public.profiles
      where role = 'admin' and status = 'active' and id <> me;
    if other_admins = 0 then
      raise exception 'LAST_ADMIN';
    end if;
  end if;
  -- Removes the login; the profile goes with it (on delete cascade).
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- batts by square foot
alter table public.products add column if not exists sqft_per_unit numeric(10,2);

update public.products
   set sqft_per_unit = (regexp_match(name, '([0-9]+(?:\.[0-9]+)?)\s*S\s*/\s*F', 'i'))[1]::numeric
 where sqft_per_unit is null
   and category_id = 'fiberglass'
   and name ~* '^\s*R\s*-?\s*[0-9]{2}'                 -- batts are named by R-value (R11U, R38K ...)
   and name ~* '[0-9]+(\.[0-9]+)?\s*S\s*/\s*F';

-- ---------------------------------------------------------------- forms hub
create table if not exists public.form_reviews (
  submission_id    text primary key,                 -- Jotform submission id
  form_id          text not null,
  form_title       text,
  status           text not null check (status in ('approved', 'declined')),
  credit_limit     numeric(12,2),
  terms            text,
  note             text,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz not null default now()
);
create index if not exists form_reviews_form_idx on public.form_reviews(form_id);

alter table public.form_reviews enable row level security;
drop policy if exists form_reviews_admin on public.form_reviews;
create policy form_reviews_admin on public.form_reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

select
  (select count(*) from public.products where sqft_per_unit is not null) as batts_with_sqft,
  (select count(*) from public.form_reviews) as form_reviews,
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'placed_by') as placed_by_nullable;
